import type { Request, Response } from "express";
import { OutputSanitizer } from "../services/outputSanitizer.js";

export class PublicRequestError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "INVALID_REQUEST",
  ) {
    super(message);
    this.name = "PublicRequestError";
  }
}

export function sendPublicError(res: Response, error: PublicRequestError) {
  return res.status(error.status).json({ error: error.message, code: error.code });
}

export function sendInternalError(
  req: Request,
  res: Response,
  error: unknown,
  options: { status?: number; code: string; message: string },
) {
  const err = error instanceof Error ? error : new Error("Unknown error");
  const databaseCode = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : undefined;
  const safeDiagnostic = OutputSanitizer.redactPIIAndSecrets(err.message || err.name).slice(0, 500);
  console.error(JSON.stringify({
    level: "error",
    event: "api.request_failed",
    method: req.method,
    path: req.path,
    errorName: err.name,
    errorCode: databaseCode,
    diagnostic: safeDiagnostic,
  }));
  return res.status(options.status ?? 500).json({ error: options.message, code: options.code });
}
