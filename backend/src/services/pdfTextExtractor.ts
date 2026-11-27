import { Worker, type WorkerOptions } from "node:worker_threads";
import { resolve } from "node:path";
import { FileSecurity } from "./fileSecurity.js";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PARSE_MS = 20_000;
export type PdfTextResult = { text: string; pageCount: number };
type WorkerResult =
  | { ok: true; text: string; pageCount: number }
  | { ok: false; code: string };

/**
 * Parse untrusted PDFs in a dedicated, memory-bounded Node worker.
 * A deadline terminates the worker instead of merely abandoning a promise.
 * The worker accepts bytes only (never URLs or local file paths).
 */
export function extractPdfText(
  bytes: Buffer,
  timeoutMs = MAX_PDF_PARSE_MS,
): Promise<PdfTextResult> {
  if (bytes.byteLength < 5 || !FileSecurity.isPdfMagicBytes(bytes)) {
    return Promise.reject(new Error("PDF_INVALID"));
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return Promise.reject(new Error("PDF_SIZE_LIMIT"));
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_PDF_PARSE_MS) {
    return Promise.reject(new Error("PDF_TIMEOUT_CONFIG_INVALID"));
  }

  // The backend compiles to CommonJS. Resolve relative to this module
  // both in tsx development and in compiled Node.js production.
  const isSource = __filename.endsWith(".ts");
  const workerPath = resolve(
    __dirname,
    "pdfTextWorker" + (isSource ? ".ts" : ".js"),
  );
  const workerOptions: WorkerOptions = {
    execArgv: isSource ? ["--import", "tsx"] : [],
    resourceLimits: {
      maxOldGenerationSizeMb: 192,
      maxYoungGenerationSizeMb: 32,
      stackSizeMb: 4,
    },
  };
  return new Promise<PdfTextResult>((resolve, reject) => {
    const worker = new Worker(workerPath, workerOptions);
    let settled = false;
    const finish = (error?: Error, result?: PdfTextResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate().catch(() => undefined);
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(
      () => finish(new Error("PDF_TIMEOUT")),
      timeoutMs,
    );
    worker.once("message", (message: WorkerResult) => {
      if (!message || !message.ok) {
        const code = message && !message.ok ? message.code : "PDF_INVALID";
        finish(new Error(code));
      } else if (
        !Number.isSafeInteger(message.pageCount) ||
        message.pageCount < 1 ||
        typeof message.text !== "string"
      ) {
        finish(new Error("PDF_INVALID"));
      } else {
        finish(undefined, { text: message.text, pageCount: message.pageCount });
      }
    });
    worker.once("error", () => finish(new Error("PDF_WORKER_FAILED")));
    worker.once("exit", () => finish(new Error("PDF_WORKER_EXIT")));
    try {
      worker.postMessage(new Uint8Array(bytes));
    } catch {
      finish(new Error("PDF_WORKER_FAILED"));
    }
  });
}
