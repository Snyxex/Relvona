import puppeteer from "puppeteer";
import pdfParse from "pdf-parse";
import { chunkAndEmbedDocument } from "./ragService.js";
import { db } from "../db/index.js";
import { knowledgeSources } from "../db/schema.js";
import { eq } from "drizzle-orm";

export async function crawlWebsite(workspaceId: string, url: string, title: string) {
  // Create pending record
  const [source] = await db
    .insert(knowledgeSources)
    .values({
      workspaceId,
      title: title || url,
      type: "website",
      sourceUrl: url,
      status: "processing",
    })
    .returning();

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Extract main text content
    const pageText = await page.evaluate(() => {
      // Remove scripts, styles and nav elements
      const elementsToHide = document.querySelectorAll("script, style, nav, footer, iframe");
      elementsToHide.forEach((el) => el.remove());
      return document.body.innerText || "";
    });

    await browser.close();

    const chunkCount = await chunkAndEmbedDocument(workspaceId, source.id, pageText, { url });

    await db
      .update(knowledgeSources)
      .set({ status: "completed", chunkCount })
      .where(eq(knowledgeSources.id, source.id));

    return { success: true, sourceId: source.id, chunkCount };
  } catch (err: any) {
    console.error("Crawl error:", err);
    await db
      .update(knowledgeSources)
      .set({ status: "failed" })
      .where(eq(knowledgeSources.id, source.id));
    throw err;
  }
}

export async function parseAndIngestPdf(workspaceId: string, fileBuffer: Buffer, fileName: string) {
  const [source] = await db
    .insert(knowledgeSources)
    .values({
      workspaceId,
      title: fileName,
      type: "pdf",
      status: "processing",
    })
    .returning();

  try {
    const pdfData = await pdfParse(fileBuffer);
    const textContent = pdfData.text;

    const chunkCount = await chunkAndEmbedDocument(workspaceId, source.id, textContent, { fileName, numPages: pdfData.numpages });

    await db
      .update(knowledgeSources)
      .set({ status: "completed", chunkCount })
      .where(eq(knowledgeSources.id, source.id));

    return { success: true, sourceId: source.id, chunkCount };
  } catch (err: any) {
    console.error("PDF ingestion error:", err);
    await db
      .update(knowledgeSources)
      .set({ status: "failed" })
      .where(eq(knowledgeSources.id, source.id));
    throw err;
  }
}

export async function ingestFaq(workspaceId: string, title: string, content: string) {
  const [source] = await db
    .insert(knowledgeSources)
    .values({
      workspaceId,
      title,
      type: "faq",
      status: "processing",
    })
    .returning();

  try {
    const chunkCount = await chunkAndEmbedDocument(workspaceId, source.id, content, { title });

    await db
      .update(knowledgeSources)
      .set({ status: "completed", chunkCount })
      .where(eq(knowledgeSources.id, source.id));

    return { success: true, sourceId: source.id, chunkCount };
  } catch (err: any) {
    console.error("FAQ ingestion error:", err);
    await db
      .update(knowledgeSources)
      .set({ status: "failed" })
      .where(eq(knowledgeSources.id, source.id));
    throw err;
  }
}
