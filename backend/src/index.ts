import "./observability/tracing.js";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import dotenv from "dotenv";
import apiRouter from "./routes/api.js";
import { applySecurityHeaders } from "./middleware/security.js";
import { db } from "./db/index.js";
import { conversations, organizationMembers } from "./db/schema.js";
import { eq, and } from "drizzle-orm";
import { verifyToken } from "./middleware/auth.js";
import { logger, requestLogging, withLogContext } from "./observability/logger.js";
import { readiness } from "./services/healthService.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map((value) => value.trim()),
    methods: ["GET", "POST"],
  },
});

const socketRedisUrl = process.env.REDIS_URL;
if (process.env.NODE_ENV === "production" && !socketRedisUrl) {
  throw new Error("REDIS_URL is required for horizontally scaled Socket.IO");
}
if (socketRedisUrl) {
  const pubClient = new Redis(socketRedisUrl, { maxRetriesPerRequest: 1, retryStrategy: () => null });
  const subClient = pubClient.duplicate();
  pubClient.on("error", (error) => console.error("Socket.IO Redis publisher error:", error.message));
  subClient.on("error", (error) => console.error("Socket.IO Redis subscriber error:", error.message));
  io.adapter(createAdapter(pubClient, subClient));
}

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:3000").split(",").map((value) => value.trim()).filter(Boolean);
app.set("trust proxy", 1);
app.use(applySecurityHeaders);
app.use(requestLogging);
const dashboardCors = cors({ origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error("Origin is not allowed by CORS"));
}, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], allowedHeaders: ["Authorization", "Content-Type", "X-Organization-Id", "X-Organization-Slug", "X-API-Key"] });
// Customer websites are not known at process start. Widget routes perform a
// per-assistant origin check after validating the public integration key.
const widgetCors = cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], allowedHeaders: ["Content-Type"] });
app.use((req, res, next) => (req.path.startsWith("/api/v1/widget/") ? widgetCors : dashboardCors)(req, res, next));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Serve static widget JS files
const publicDir = path.join(process.cwd(), "public");
app.use("/public", express.static(publicDir, { maxAge: "1h", immutable: true }));

// API Routes
app.use("/api", apiRouter);

app.get("/health/live", (_req, res) => {
  res.json({ status: "ok", service: "ai-customer-support-backend" });
});
app.get(["/health", "/health/ready"], async (_req, res) => {
  const result = await readiness();
  res.status(result.ready ? 200 : 503).json({ status: result.ready ? "ok" : "degraded", service: "ai-customer-support-backend", ...result });
});

// Real-Time Socket.IO Server with Server-Side Room Authorization
io.on("connection", (socket) => {
  logger.info("socket.connected", { socketId: socket.id });

  // Authenticate socket handshake if token supplied
  const token = socket.handshake.auth?.token;
  let userPayload: any = null;
  if (token) {
    try {
      userPayload = verifyToken(token);
    } catch (e) {}
  }

  // Join Room with Server-Side Authorization Check
  socket.on("join_room", async (data: { room: string; organizationId: string; conversationId?: string }) => withLogContext({ conversationId: data.conversationId, organizationId: data.organizationId }, async () => {
    try {
      const room = data.room || `conv:${data.conversationId}`;
      if (!room) return;

      // Extract conversation ID if room is conv:xxx
      let targetConvId = data.conversationId;
      if (!targetConvId && room.startsWith("conv:")) {
        targetConvId = room.replace("conv:", "");
      }

      if (targetConvId) {
        if (!userPayload?.userId) {
          socket.emit("error", { message: "Authentication is required to join a conversation" });
          return;
        }
        // Validate conversation belongs to the requested organization
        const [conv] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, targetConvId))
          .limit(1);

        if (!conv) {
          socket.emit("error", { message: "Access denied: Conversation not found" });
          return;
        }

        if (data.organizationId && conv.organizationId !== data.organizationId) {
          socket.emit("error", { message: "Access denied: Cross-tenant room join attempt blocked" });
          return;
        }

        const [membership] = await db
          .select({ id: organizationMembers.id })
          .from(organizationMembers)
          .where(and(eq(organizationMembers.organizationId, conv.organizationId), eq(organizationMembers.userId, userPayload.userId)))
          .limit(1);
        if (!membership) {
          socket.emit("error", { message: "Access denied: You are not a member of this organization" });
          return;
        }
      }

      socket.join(room);
      logger.info("socket.room.joined", { socketId: socket.id, room });
    } catch (err) {
      logger.warn("socket.room.join_failed", { socketId: socket.id });
      socket.emit("error", { message: "Failed to authorize room join" });
    }
  }));

  // Agent claims conversation / handoff
  socket.on("claim_conversation", (data: { conversationId: string; agentId: string; agentName: string }) => {
    if (!userPayload?.userId || !socket.rooms.has(`conv:${data.conversationId}`)) {
      socket.emit("error", { message: "Access denied: Join the authorized conversation room first" });
      return;
    }
    io.to(`conv:${data.conversationId}`).emit("handoff_claimed", data);
  });

  // Send real-time chat message
  socket.on("send_message", (data: { conversationId: string; senderType: string; content: string }) => {
    if (!userPayload?.userId || !socket.rooms.has(`conv:${data.conversationId}`)) {
      socket.emit("error", { message: "Access denied: Join the authorized conversation room first" });
      return;
    }
    io.to(`conv:${data.conversationId}`).emit("new_message", data);
  });

  socket.on("disconnect", () => {
    logger.info("socket.disconnected", { socketId: socket.id });
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  logger.info("server.started", { port: PORT });
});
