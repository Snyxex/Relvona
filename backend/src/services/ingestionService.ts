import pdfParse from "pdf-parse";
import { db } from "../db/index.js";
import { documentChunks, knowledgeSources, websitePages, websites, knowledgeBases } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import URL from "url";
import { UniversalAIGateway, AIProvider } from "./aiGateway.js";
import { CrawlerSecurity } from "./crawlerSecurity.js";
import { PiiRedactionService } from "./piiRedactionService.js";

// SSRF Protection Helper
export function validateUrlForSSRF(targetUrl: string): boolean {
  try {
    const parsed = new URL.URL(targetUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

// Generate Embeddings Helper via Universal AI Gateway
export async function generateEmbeddings(
  texts: string[],
  provider: AIProvider = "openai",
  apiKey?: string | null,
  baseUrl?: string | null
): Promise<number[][]> {
  return await UniversalAIGateway.generateEmbeddings({
    provider,
    texts,
    apiKey,
    baseUrl,
  });
}

export class IngestionService {
  /** Keep retrieval chunks in the 300–500 token range and remove indexing noise once. */
  private static readonly chunking = { chunkSize: 1800, chunkOverlap: 180 };

  private static cleanIndexText(text: string): string {
    return text
      .replace(/\r\n/g, "\n")
      .replace(/[\t ]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/(?:privacy policy|cookie policy|all rights reserved)\s*$/gim, "")
      .trim();
  }

  private static redactChunks(chunks: string[]) {
    return chunks.map((chunk) => PiiRedactionService.redact(chunk).text).filter(Boolean);
  }

  // We only need deterministic bounded chunking, not the LangChain runtime.
  // Keeping it local removes a large unused dependency tree from production.
  private static splitText(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + this.chunking.chunkSize);
      if (end < text.length) {
        const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(" ", end));
        if (boundary > start + Math.floor(this.chunking.chunkSize / 2)) end = boundary;
      }
      const chunk = text.slice(start, end).trim();
      if (chunk) chunks.push(chunk);
      if (end >= text.length) break;
      start = Math.max(start + 1, end - this.chunking.chunkOverlap);
    }
    return chunks;
  }

  private static async requireKnowledgeBase(organizationId: string, knowledgeBaseId: string) {
    const [knowledgeBase] = await db.select({ id: knowledgeBases.id }).from(knowledgeBases)
      .where(and(eq(knowledgeBases.id, knowledgeBaseId), eq(knowledgeBases.organizationId, organizationId))).limit(1);
    if (!knowledgeBase) throw new Error("Knowledge base not found");
  }

  // Process Manual Document / Text / FAQ
  static async processTextDocument(data: {
    organizationId: string;
    knowledgeBaseId: string;
    title: string;
    type: "faq" | "document";
    content: string;
    sourceUrl?: string;
  }) {
    await this.requireKnowledgeBase(data.organizationId, data.knowledgeBaseId);
    const [source] = await db
      .insert(knowledgeSources)
      .values({
        organizationId: data.organizationId,
        knowledgeBaseId: data.knowledgeBaseId,
        title: data.title,
        type: data.type,
        sourceUrl: data.sourceUrl,
        status: "processing",
      })
      .returning();

    try {
      const chunks = this.redactChunks(this.splitText(this.cleanIndexText(data.content)));
      if (chunks.length === 0) {
        throw new Error("No text content found to process");
      }

      const embeddings = await generateEmbeddings(chunks);

      const chunkRecords = chunks.map((chunkText, idx) => ({
        organizationId: data.organizationId,
        knowledgeBaseId: data.knowledgeBaseId,
        sourceId: source.id,
        chunkIndex: idx,
        content: chunkText,
        metadata: { title: data.title, type: data.type, sourceUrl: data.sourceUrl },
        embedding: embeddings[idx],
      }));

      await db.insert(documentChunks).values(chunkRecords);

      await db
        .update(knowledgeSources)
        .set({
          status: "completed",
          chunkCount: chunks.length,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeSources.id, source.id));

      return { sourceId: source.id, chunkCount: chunks.length };
    } catch (error) {
      await db
        .update(knowledgeSources)
        .set({
          status: "failed",
          errorMessage: (error as Error).message,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeSources.id, source.id));

      throw error;
    }
  }

  // Process PDF Upload
  static async processPdfBuffer(data: {
    organizationId: string;
    knowledgeBaseId: string;
    title: string;
    buffer: Buffer;
    filePath?: string;
  }) {
    await this.requireKnowledgeBase(data.organizationId, data.knowledgeBaseId);
    const [source] = await db
      .insert(knowledgeSources)
      .values({
        organizationId: data.organizationId,
        knowledgeBaseId: data.knowledgeBaseId,
        title: data.title,
        type: "pdf",
        filePath: data.filePath,
        status: "processing",
      })
      .returning();

    try {
      const pdfData = await pdfParse(data.buffer);
      const cleanedText = this.cleanIndexText(pdfData.text);

      if (!cleanedText.trim()) {
        throw new Error("Extracted text from PDF is empty");
      }

      const chunks = this.redactChunks(this.splitText(cleanedText));
      const embeddings = await generateEmbeddings(chunks);

      const chunkRecords = chunks.map((chunkText, idx) => ({
        organizationId: data.organizationId,
        knowledgeBaseId: data.knowledgeBaseId,
        sourceId: source.id,
        chunkIndex: idx,
        content: chunkText,
        metadata: { title: data.title, type: "pdf", pageCount: pdfData.numpages },
        embedding: embeddings[idx],
      }));

      await db.insert(documentChunks).values(chunkRecords);

      await db
        .update(knowledgeSources)
        .set({
          status: "completed",
          chunkCount: chunks.length,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeSources.id, source.id));

      return { sourceId: source.id, chunkCount: chunks.length, numPages: pdfData.numpages };
    } catch (error) {
      await db
        .update(knowledgeSources)
        .set({
          status: "failed",
          errorMessage: (error as Error).message,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeSources.id, source.id));

      throw error;
    }
  }

  // Process & Crawl Website URL
  static async crawlWebsite(data: {
    organizationId: string;
    knowledgeBaseId: string;
    targetUrl: string;
    maxPages?: number;
    maxDepth?: number;
  }) {
    await this.requireKnowledgeBase(data.organizationId, data.knowledgeBaseId);
    await CrawlerSecurity.validateAndResolveUrl(data.targetUrl);

    const maxPages = data.maxPages || 20;

    const [website] = await db
      .insert(websites)
      .values({
        organizationId: data.organizationId,
        knowledgeBaseId: data.knowledgeBaseId,
        rootUrl: data.targetUrl,
        maxPages,
        crawlStatus: "crawling",
      })
      .returning();

    const [source] = await db
      .insert(knowledgeSources)
      .values({
        organizationId: data.organizationId,
        knowledgeBaseId: data.knowledgeBaseId,
        title: `Website Crawl: ${data.targetUrl}`,
        type: "website",
        sourceUrl: data.targetUrl,
        status: "processing",
      })
      .returning();

    try {
      const html = await CrawlerSecurity.safeFetch(data.targetUrl);

      const pageTitleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const pageTitle = pageTitleMatch ? pageTitleMatch[1].trim() : data.targetUrl;

      const bodyText = html
        .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, " ")
        .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, " ")
        .replace(/<header\b[^<]*>([\s\S]*?)<\/header>/gi, " ")
        .replace(/<footer\b[^<]*>([\s\S]*?)<\/footer>/gi, " ")
        .replace(/<nav\b[^<]*>([\s\S]*?)<\/nav>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!bodyText) {
        throw new Error("No readable text found on website");
      }

      const contentHash = crypto.createHash("md5").update(bodyText).digest("hex");

      await db.insert(websitePages).values({
        websiteId: website.id,
        organizationId: data.organizationId,
        url: data.targetUrl,
        title: pageTitle,
        contentHash,
        status: "completed",
      });

      const chunks = this.redactChunks(this.splitText(bodyText));
      const embeddings = await generateEmbeddings(chunks);

      const chunkRecords = chunks.map((chunkText, idx) => ({
        organizationId: data.organizationId,
        knowledgeBaseId: data.knowledgeBaseId,
        sourceId: source.id,
        chunkIndex: idx,
        content: chunkText,
        metadata: { title: pageTitle, type: "website", url: data.targetUrl },
        embedding: embeddings[idx],
      }));

      await db.insert(documentChunks).values(chunkRecords);

      await db
        .update(knowledgeSources)
        .set({
          status: "completed",
          chunkCount: chunks.length,
          contentHash,
          lastCrawledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(knowledgeSources.id, source.id));

      await db
        .update(websites)
        .set({
          crawlStatus: "completed",
          lastCrawledAt: new Date(),
        })
        .where(eq(websites.id, website.id));

      return { sourceId: source.id, title: pageTitle, chunkCount: chunks.length };
    } catch (error) {
      await db
        .update(knowledgeSources)
        .set({
          status: "failed",
          errorMessage: (error as Error).message,
          updatedAt: new Date(),
        })
        .where(eq(knowledgeSources.id, source.id));

      await db
        .update(websites)
        .set({ crawlStatus: "failed" })
        .where(eq(websites.id, website.id));

      throw error;
    }
  }
}
