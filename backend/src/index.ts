import "dotenv/config";
import "./observability/tracing.js";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth/betterAuth.js";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import apiRouter from "./routes/api.js";
import { applySecurityHeaders, createRateLimiter, requireTrustedOrigin } from "./middleware/security.js";
import { bindDashboardDomain, type AuthRequest } from "./middleware/auth.js";
import { verifiedDashboardOrigins } from "./services/dashboardDomainService.js";
import { dashboardDomainFromRequest, organizationForVerifiedDashboardDomain } from "./services/dashboardDomainService.js";
import { db } from "./db/index.js";
import { conversations, organizationMembers, organizations } from "./db/schema.js";
import { setDatabaseTenant } from "./db/tenantContext.js";
import { domainEventBus } from "./services/domainEventBus.js";
import { eq, and } from "drizzle-orm";
import { getCurrentUser } from "./auth/session.js";
import { logger, requestLogging, withLogContext } from "./observability/logger.js";
import { readiness, closeHealthDependencies } from "./services/healthService.js";
import { closeDatabasePool } from "./db/index.js";
import { closeQueues } from "./services/queueService.js";
import { shutdownTracing } from "./observability/tracing.js";
import { validateRuntimeConfiguration } from "./config/runtime.js";
import { httpMetrics, metrics } from "./observability/metrics.js";

validateRuntimeConfiguration();

const app = express();
const server = http.createServer(app);
server.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 65_000);
server.headersTimeout = Math.min(server.requestTimeout, 60_000);
server.keepAliveTimeout = 5_000;

const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map((value) => value.trim()).includes(origin)) return callback(null, true);
      void verifiedDashboardOrigins().then((origins) => callback(null, origins.includes(origin))).catch(() => callback(new Error("Dashboard domain lookup failed")));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const socketRedisUrl = process.env.REDIS_URL;
if (process.env.NODE_ENV === "production" && !socketRedisUrl) {
  throw new Error("REDIS_URL is required for horizontally scaled Socket.IO");
}
const socketRedisClients: Redis[] = [];
if (socketRedisUrl) {
  const pubClient = new Redis(socketRedisUrl, { maxRetriesPerRequest: 1, retryStrategy: () => null });
  const subClient = pubClient.duplicate();
  socketRedisClients.push(pubClient, subClient);
  pubClient.on("error", (error) => console.error("Socket.IO Redis publisher error:", error.message));
  subClient.on("error", (error) => console.error("Socket.IO Redis subscriber error:", error.message));
  io.adapter(createAdapter(pubClient, subClient));
}

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map((value) => value.trim()).filter(Boolean);
app.set("trust proxy", 1);
app.use(applySecurityHeaders);
app.use(requestLogging);
app.use(httpMetrics);
app.use(createRateLimiter({ keyPrefix: "global", limit: Number(process.env.GLOBAL_RATE_LIMIT_PER_MINUTE || 300), windowMs: 60_000, keyGenerator: (req) => req.ip }));
const dashboardCors = cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  void verifiedDashboardOrigins().then((origins) => callback(null, origins.includes(origin))).catch(() => callback(new Error("Dashboard domain lookup failed")));
}, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], credentials: true, allowedHeaders: ["Content-Type", "X-Organization-Id", "X-Organization-Slug", "X-API-Key", "X-Support-Session-Id"] });
const widgetCors = cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] });
app.use((req, res, next) => (req.path.startsWith("/api/v1/widget/") ? widgetCors : dashboardCors)(req, res, next));
app.use(bindDashboardDomain as (req: AuthRequest, res: express.Response, next: express.NextFunction) => void);
app.use(requireTrustedOrigin);
// Better Auth consumes request bodies itself. Mount it before Express parsers.
app.all("/api/auth/*", toNodeHandler(auth));
const defaultJsonParser = express.json({ limit: process.env.JSON_BODY_LIMIT || "128kb" });
// Manual knowledge-text ingestion intentionally uses a larger authenticated
// route-local parser. Skip the global parser here so unauthenticated callers do
// not get the larger allowance before auth/tenant/RBAC checks run.
app.use((req, res, next) => req.path === "/api/v1/knowledge/text" ? next() : defaultJsonParser(req, res, next));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || "64kb" }));

const publicDir = path.join(process.cwd(), "public");
app.use("/public", express.static(publicDir, {
  maxAge: "1h",
  setHeaders: (res, filePath) => {
    if (path.basename(filePath) === "widget.js") {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
    }
  },
}));

app.use("/api", apiRouter);

app.get("/health/live", (_req, res) => {
  res.json({ status: "ok", service: "ai-customer-support-backend" });
});
app.get(["/health", "/health/ready"], async (_req, res) => {
  const result = await readiness();
  res.status(result.ready ? 200 : 503).json({ status: result.ready ? "ok" : "degraded", service: "ai-customer-support-backend", ...result });
});
app.get("/metrics", (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (process.env.METRICS_TOKEN && token !== process.env.METRICS_TOKEN) return res.status(401).end();
  res.type("text/plain; version=0.0.4").send(metrics.render());
});

app.use((error: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  if (error.status === 413 || error.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the allowed size", requestId: res.getHeader("X-Request-Id") } });
  }
  logger.error("http.request.failed", { error: error.message });
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred", requestId: res.getHeader("X-Request-Id") } });
});

domainEventBus.subscribe("message.created", async (event) => {
  const recipients = await io.in(`conv:${event.conversationId}`).fetchSockets();
  await Promise.allSettled(recipients.map(async (recipient) => {
    try {
      const user = await getCurrentUser({ headers: recipient.handshake.headers as any });
      const [member] = user ? await db.select({ role: organizationMembers.role }).from(organizationMembers).where(and(eq(organizationMembers.organizationId, event.organizationId), eq(organizationMembers.userId, user.id))).limit(1) : [];
      if (!user || !member || !["owner", "admin", "agent"].includes(member.role)) {
        recipient.disconnect(true);
        return;
      }
      recipient.emit("new_message", event.payload);
    } catch { recipient.disconnect(true); }
  }));
});

let activeSockets = 0;
io.on("connection", (socket) => {
  activeSockets += 1;
  metrics.gauge("supportai_websocket_active", activeSockets);
  metrics.increment("supportai_websocket_connections_total");
  logger.info("socket.connected", { socketId: socket.id });

  let sessionUser: Awaited<ReturnType<typeof getCurrentUser>> = null;
  let dashboardOrganizationId: string | null = null;
  const dashboardDomainPromise = organizationForVerifiedDashboardDomain(dashboardDomainFromRequest(socket.handshake.headers.origin));
  void Promise.all([
    getCurrentUser({ headers: socket.handshake.headers as any }),
    dashboardDomainPromise,
  ]).then(([user, domainOrganizationId]) => {
    sessionUser = user;
    dashboardOrganizationId = domainOrganizationId;
    if (!user) socket.disconnect(true);
  }).catch(() => socket.disconnect(true));

  socket.on("join_room", async (data: { organizationId?: string; conversationId?: string } = {}) => withLogContext({}, async () => {
    try {
      const targetConvId = data?.conversationId;
      if (!targetConvId || typeof targetConvId !== "string" || !/^[0-9a-f-]{36}$/i.test(targetConvId) || typeof data.organizationId !== "string" || !/^[0-9a-f-]{36}$/i.test(data.organizationId)) {
        socket.emit("error", { message: "Invalid room request" });
        return;
      }

      const boundDashboardOrganizationId = dashboardOrganizationId ?? await dashboardDomainPromise;
      if (boundDashboardOrganizationId && data.organizationId !== boundDashboardOrganizationId) {
        socket.emit("error", { message: "DASHBOARD_DOMAIN_TENANT_MISMATCH" });
        return;
      }

      const user = sessionUser || await getCurrentUser({ headers: socket.handshake.headers as any });
      if (!user) throw new Error("Revoked session");
      const [member] = await db.select().from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, data.organizationId), eq(organizationMembers.userId, user.id))).limit(1);
      const [organization] = await db.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, data.organizationId)).limit(1);
      if (!member || member.status !== "active" || organization?.status !== "active" || !["owner", "admin", "agent"].includes(member.role)) throw new Error("Access denied");
      setDatabaseTenant(data.organizationId);
      const [conv] = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, targetConvId), eq(conversations.organizationId, data.organizationId)))
        .limit(1);

      if (!conv) {
        socket.emit("error", { message: "Access denied: Conversation not found" });
        return;
      }

      if (data.organizationId !== conv.organizationId) {
        socket.emit("error", { message: "Access denied: Cross-tenant room join attempt blocked" });
        return;
      }

      const [membership] = await db
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, conv.organizationId), eq(organizationMembers.userId, user.id)))
        .limit(1);
      if (!membership) {
        socket.emit("error", { message: "Access denied: You are not a member of this organization" });
        return;
      }
      const room = `conv:${targetConvId}`;
      socket.join(room);
      logger.info("socket.room.joined", { socketId: socket.id, room });
    } catch {
      logger.warn("socket.room.join_failed", { socketId: socket.id });
      socket.emit("error", { message: "Failed to authorize room join" });
    }
  }));

  socket.on("leave_room", (data: { conversationId?: string } = {}) => {
    if (typeof data?.conversationId === "string") socket.leave(`conv:${data.conversationId}`);
  });
  socket.on("claim_conversation", () => {
    socket.emit("error", { message: "Use the authenticated conversation API to claim a conversation" });
  });
  socket.on("send_message", () => {
    socket.emit("error", { message: "Use the authenticated conversation API to persist a message" });
  });

  socket.on("disconnect", () => {
    activeSockets = Math.max(0, activeSockets - 1);
    metrics.gauge("supportai_websocket_active", activeSockets);
    logger.info("socket.disconnected", { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  logger.info("server.started", { port: PORT });
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("server.shutdown_started", { signal });
  const forceTimer = setTimeout(() => {
    logger.error("server.shutdown_timeout", { timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS || 30_000) });
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 30_000));
  forceTimer.unref();
  try {
    const serverClosed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await serverClosed;
    await Promise.allSettled([closeQueues(), closeHealthDependencies(), Promise.all(socketRedisClients.map((client) => client.quit().catch(() => client.disconnect())))]);
    await closeDatabasePool();
    await shutdownTracing();
    logger.info("server.shutdown_complete", { signal });
    process.exitCode = 0;
  } catch (error) {
    logger.error("server.shutdown_failed", { error: (error as Error).message });
    process.exitCode = 1;
  } finally {
    clearTimeout(forceTimer);
  }
}
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });
