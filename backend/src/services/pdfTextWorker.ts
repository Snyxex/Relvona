import { parentPort } from "node:worker_threads";
import { PDFParse } from "pdf-parse";

if (!parentPort) throw new Error("PDF parser worker must be started by its parent");

const MAX_PDF_PAGES = 100;
const MAX_PDF_TEXT_CHARS = 500_000;

// This worker receives only local bytes. No URL loading, filesystem paths,
// database credentials or application services are passed to the PDF parser.
parentPort.once("message", async (bytes: Uint8Array) => {
  let parser: PDFParse | undefined;
  let response:
    | { ok: true; text: string; pageCount: number }
    | { ok: false; code: string };
  try {
    parser = new PDFParse({
      data: bytes,
      isEvalSupported: false, // CVE-2024-4367 defense-in-depth
      stopAtErrors: true,
      maxImageSize: 4_000_000,
      useSystemFonts: false,
    });
    const info = await parser.getInfo();
    if (!Number.isSafeInteger(info.total) || info.total < 1) {
      throw new Error("PDF_INVALID");
    }
    if (info.total > MAX_PDF_PAGES) {
      throw new Error("PDF_PAGE_LIMIT");
    }
    const result = await parser.getText();
    if (result.total !== info.total || typeof result.text !== "string") {
      throw new Error("PDF_INVALID");
    }
    if (result.text.length > MAX_PDF_TEXT_CHARS) {
      throw new Error("PDF_TEXT_LIMIT");
    }
    response = { ok: true, text: result.text, pageCount: info.total };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    response = {
      ok: false,
      code: ["PDF_PAGE_LIMIT", "PDF_TEXT_LIMIT"].includes(message)
        ? message
        : "PDF_INVALID",
    };
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch {
        // A corrupted PDF may also disrupt cleanup; never expose raw errors.
      }
    }
  }
  parentPort!.postMessage(response);
});
