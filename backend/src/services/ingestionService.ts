import pdfParse from "pdf-parse";
import crypto from "node:crypto";
import { UniversalAIGateway } from "./aiGateway.js";
import { CrawlerSecurity } from "./crawlerSecurity.js";
import { PiiRedactionService } from "./piiRedactionService.js";
import { FileSecurity } from "./fileSecurity.js";
import type { IngestionInput } from "./ingestionTypes.js";
import { FileObjectService } from "./fileObjectService.js";

export type PreparedSource = {
  title: string;
  contentHash: string;
  securityStatus: "SAFE" | "SUSPICIOUS";
  chunks: { content: string; embedding: number[]; metadata: Record<string, unknown> }[];
  pages: { url: string; title: string; contentHash: string; chunkCount: number }[];
  normalizedText: string;
};

export type EmbeddingConfig = {
  apiKey?: string | null;
};

export class IngestionService {
  // All tenant knowledge currently shares one pgvector index with a fixed
  // 1536-dimensional schema. Keep ingestion and retrieval in one embedding
  // space until per-index embedding profiles are introduced.
  static readonly embeddingProvider = "openai" as const;
  static readonly embeddingModel = "text-embedding-3-small";
  static readonly embeddingDimensions = 1536;

  // Reuse the existing bounded splitter; expensive work never holds a DB transaction.
  private static readonly chunking = { chunkSize: 1800, chunkOverlap: 180 };
  static cleanIndexText(text: string): string {
    return text.replace(/\r\n/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n")
      .replace(/(?:privacy policy|cookie policy|all rights reserved)\s*$/gim, "").trim();
  }
  static splitText(text: string): string[] {
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
  static extractHtml(html: string) {
    return html.replace(/<(script|style|header|footer|nav)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, " ").trim();
  }
  static async prepare(input: IngestionInput, embedding: EmbeddingConfig = {}, organizationId?: string): Promise<PreparedSource> {
    const documents: { text: string; title: string; url?: string }[] = [];
    let pageCount: number | undefined;
    if (input.type === "pdf") {
      if (!organizationId) throw new Error("Organization context required for storage-backed PDF");
      const stored = await FileObjectService.readForOrganization(organizationId, input.objectId);
      const buffers: Buffer[] = []; for await (const chunk of stored.body) buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const buffer = Buffer.concat(buffers);
      const validation = FileSecurity.validateUploadedFile(buffer, input.filename, "application/pdf");
      if (!validation.isValid) throw new Error("PDF validation failed");
      const pdf = await pdfParse(buffer);
      pageCount = pdf.numpages;
      documents.push({ text: pdf.text, title: input.title });
    } else if (input.type === "website") {
      const root = new URL(input.targetUrl);
      const pending = [{ url: root.href, depth: 0 }];
      const seen = new Set<string>();
      let totalChars = 0;
      while (pending.length && documents.length < input.maxPages) {
        const page = pending.shift()!;
        if (seen.has(page.url)) continue;
        seen.add(page.url);
        // Every URL and redirect is validated and DNS-pinned by the existing crawler.
        const html = await CrawlerSecurity.safeFetch(page.url);
        const title = this.extractHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || input.title);
        const text = this.extractHtml(html);
        if (!text) throw new Error("Website contains no readable text");
        totalChars += text.length;
        if (totalChars > 500_000) throw new Error("Crawl text exceeds the 500,000 character limit");
        documents.push({ text, title, url: page.url });
        if (page.depth >= input.maxDepth) continue;
        for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
          try {
            const link = new URL(match[1].replace(/&amp;/g, "&"), page.url);
            link.hash = "";
            if (link.origin !== root.origin || link.username || link.password || !["http:", "https:"].includes(link.protocol)) continue;
            if (/\.(pdf|zip|png|jpe?g|gif|svg|mp4|exe)$/i.test(link.pathname)) continue;
            if (!seen.has(link.href) && !pending.some((item) => item.url === link.href) && pending.length < input.maxPages * 10) pending.push({ url: link.href, depth: page.depth + 1 });
          } catch { /* Ignore malformed links; fetched links still pass SSRF checks. */ }
        }
      }
    } else documents.push({ text: input.type === "faq" ? `${input.title}\n\n${input.content}` : input.content, title: input.title });

    let suspicious = false;
    const chunks: PreparedSource["chunks"] = [];
    const pages: PreparedSource["pages"] = [];
    for (const document of documents) {
      const text = this.cleanIndexText(document.text);
      if (!text) throw new Error("Document contains no extractable text");
      suspicious ||= FileSecurity.scanForPoisoningPatterns(text).isSuspicious;
      const parts = this.splitText(text).map((part) => PiiRedactionService.redact(part).text).filter(Boolean);
      if (chunks.length + parts.length > 512) throw new Error("Document exceeds the 512 chunk limit");
      for (const content of parts) chunks.push({ content, embedding: [], metadata: { title: document.title, sourceType: input.type, sourceUrl: document.url, category: input.category || null, language: input.language || "und", pageCount, embeddingProvider: this.embeddingProvider, embeddingModel: this.embeddingModel } });
      if (document.url) pages.push({ url: document.url, title: document.title, contentHash: crypto.createHash("sha256").update(text).digest("hex"), chunkCount: parts.length });
    }
    if (!chunks.length) throw new Error("Document contains no indexable text");
    // Unsupported or unavailable embedding providers fail explicitly, never fabricate vectors.
    for (let offset = 0; offset < chunks.length; offset += 32) {
      const batch = chunks.slice(offset, offset + 32);
      const vectors = await UniversalAIGateway.generateEmbeddings({ provider: this.embeddingProvider, model: this.embeddingModel, texts: batch.map((chunk) => chunk.content), apiKey: embedding.apiKey });
      if (vectors.length !== batch.length || vectors.some((v) => !Array.isArray(v) || v.length !== this.embeddingDimensions || v.some((n) => !Number.isFinite(n)) || !v.some((n) => n !== 0))) throw new Error("Invalid embedding vector response");
      batch.forEach((chunk, index) => { chunk.embedding = vectors[index]; });
    }
    const normalizedText = documents.map((document) => this.cleanIndexText(document.text)).join("\n\n");
    return { title: input.title, chunks, pages, normalizedText, securityStatus: suspicious ? "SUSPICIOUS" : "SAFE", contentHash: crypto.createHash("sha256").update(chunks.map((chunk) => chunk.content).join("\n")).digest("hex") };
  }
}
