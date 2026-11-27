import assert from "node:assert/strict";
import { extractPdfText, MAX_PDF_BYTES } from "../services/pdfTextExtractor.js";

// Pure ASCII, correctly cross-referenced PDF fixture; no network or third-party
// test fixture is needed. Distinct page objects exercise metadata page limits.
function createPdf(pageCount = 1): Buffer {
  const fontId = 3 + 2 * pageCount;
  const objects: string[] = Array(fontId).fill("");
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = Array.from(
    { length: pageCount },
    (_, i) => String(3 + 2 * i) + " 0 R",
  );
  objects[1] =
    "<< /Type /Pages /Count " + pageCount +
    " /Kids [ " + kids.join(" ") + " ] >>";
  for (let i = 0; i < pageCount; i++) {
    const pageId = 3 + 2 * i;
    const streamId = pageId + 1;
    const commands = "BT /F1 14 Tf 72 720 Td (Hello Relvona PDF) Tj ET\n";
    objects[pageId - 1] =
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 " + fontId + " 0 R >> >> " +
      "/Contents " + streamId + " 0 R >>";
    objects[streamId - 1] =
      "<< /Length " + Buffer.byteLength(commands) + " >>\nstream\n" +
      commands + "endstream";
  }
  objects[fontId - 1] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += String(i + 1) + " 0 obj\n" + objects[i] + "\nendobj\n";
  }
  const xref = Buffer.byteLength(pdf);
  pdf += "xref\n0 " + offsets.length + "\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += String(offset).padStart(10, "0") + " 00000 n \n";
  }
  pdf +=
    "trailer\n<< /Size " + offsets.length +
    " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(pdf, "ascii");
}

async function main() {
  // Exercise the actual maintained PDF.js dependency inside the bounded worker.
  const simple = await extractPdfText(createPdf());
  assert.equal(simple.pageCount, 1);
  assert.match(simple.text, /Hello Relvona PDF/);

  await assert.rejects(
    extractPdfText(Buffer.from("not a PDF")),
    /PDF_INVALID/,
  );
  await assert.rejects(
    extractPdfText(Buffer.from("%PDF-1.4\ncorrupt and truncated")),
    /PDF_INVALID/,
  );
  await assert.rejects(
    extractPdfText(Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(MAX_PDF_BYTES)])),
    /PDF_SIZE_LIMIT/,
  );
  await assert.rejects(
    extractPdfText(createPdf(101)),
    /PDF_PAGE_LIMIT/,
  );
  // A one-millisecond deadline must abort the worker, not leave an expensive
  // PDF parsing promise running in the ingestion process.
  await assert.rejects(
    extractPdfText(createPdf(), 1),
    /PDF_TIMEOUT/,
  );
  console.log("PDF parsing security regression tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
