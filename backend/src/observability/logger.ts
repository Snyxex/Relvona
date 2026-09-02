import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { context, trace } from "@opentelemetry/api";
import type { NextFunction, Request, Response } from "express";
import { hasDatabaseTenantContext, setDatabaseTenant, tenantContextMiddleware, withDatabaseTenantContext } from "../db/tenantContext.js";

type LogContext = { requestId?: string; organizationId?: string; conversationId?: string; jobId?: string };
const storage = new AsyncLocalStorage<LogContext>();

function emit(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const active = storage.getStore() || {};
  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, service: process.env.OTEL_SERVICE_NAME || "ai-customer-support", traceId: spanContext?.traceId, spanId: spanContext?.spanId, ...active, ...fields }));
}

export const logger = { info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields), warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields), error: (event: string, fields?: Record<string, unknown>) => emit("error", event, fields) };

export function withLogContext<T>(values: LogContext, work: () => T): T {
  const run = () => storage.run({ ...(storage.getStore() || {}), ...values }, work);
  return hasDatabaseTenantContext() ? run() : withDatabaseTenantContext(run);
}

export function setLogContext(values: LogContext) {
  Object.assign(storage.getStore() || {}, values);
  if (values.organizationId) setDatabaseTenant(values.organizationId);
}

export function requestLogging(req: Request, res: Response, next: NextFunction) {
  const requestId = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : randomUUID();
  res.setHeader("X-Request-Id", requestId);
  const startedAt = performance.now();
  tenantContextMiddleware(req, res, () => withLogContext({ requestId }, () => {
    res.on("finish", () => logger.info("http.request.completed", { method: req.method, path: req.route?.path || req.path, statusCode: res.statusCode, durationMs: Math.round(performance.now() - startedAt) }));
    next();
  }));
}
