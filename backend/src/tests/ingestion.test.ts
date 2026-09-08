import assert from "node:assert/strict";
import { IngestionService } from "../services/ingestionService.js";
import { UniversalAIGateway } from "../services/aiGateway.js";
import { canCommitIngestion, ingestionQueueId } from "../services/ingestionTypes.js";
import { validateIngestionInput } from "../services/ingestionJobService.js";
import { CrawlerSecurity } from "../services/crawlerSecurity.js";

async function main() {
  const text = `${"a".repeat(4000)} END_OF_DOCUMENT`;
  const chunks = IngestionService.splitText(text);
  assert.ok(chunks.length > 1 && chunks.every((chunk) => chunk.length <= 1800));
  assert.ok(chunks.at(-1)?.endsWith("END_OF_DOCUMENT"), "Chunking must preserve the document tail");
  assert.equal(IngestionService.extractHtml('<nav>Navigation</nav><script>bad()</script><main>Useful &amp; correct</main><footer>Noise</footer>'), "Useful & correct");
  assert.equal(canCommitIngestion({ revision: 2, leaseToken: "new", status: "processing" }, 1, "old"), false, "Old revisions cannot publish");
  assert.equal(canCommitIngestion({ revision: 2, leaseToken: "new", status: "processing" }, 2, "old"), false, "Expired workers cannot publish");
  assert.equal(canCommitIngestion(undefined, 2, "new"), false, "Deleted jobs cannot publish");
  assert.equal(canCommitIngestion({ revision: 2, leaseToken: "new", status: "processing" }, 2, "new"), true);
  const ref = { organizationId: "tenant", jobId: "job", revision: 2, attempt: 0 };
  assert.equal(ingestionQueueId(ref), ingestionQueueId({ ...ref }));
  assert.notEqual(ingestionQueueId(ref), ingestionQueueId({ ...ref, attempt: 1 }));
  assert.throws(() => validateIngestionInput({ type: "website", title: "Docs", knowledgeBaseId: "base", targetUrl: "https://example.com", maxPages: 10000, maxDepth: 2 }));
  for (const ip of ["fd12:3456::1", "fcab::1", "febf::1", "::ffff:ac10:1", "0:0:0:0:0:ffff:a00:1", "::ffff:172.16.0.1", "ff02::1", "2001:db8::1", "2002:7f00:1::"]) assert.equal(CrawlerSecurity.isPrivateIP(ip), true, ip);
  assert.equal(CrawlerSecurity.isPrivateIP("2606:4700:4700::1111"), false);

  const originalEmbeddings = UniversalAIGateway.generateEmbeddings;
  const originalFetch = CrawlerSecurity.safeFetch;
  const key = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    await assert.rejects(UniversalAIGateway.generateEmbeddings({ provider: "openai", texts: ["No fake vectors"] }), /unavailable/);
    let embeddedTexts: string[] = [];
    UniversalAIGateway.generateEmbeddings = async (request) => {
      embeddedTexts.push(...request.texts);
      return request.texts.map(() => Array(1536).fill(0.01));
    };
    const prepared = await IngestionService.prepare({ type: "faq", knowledgeBaseId: "base", title: "How can I renew?", content: "Use the renewal page.", category: "billing", language: "en" });
    assert.match(embeddedTexts.join(" "), /How can I renew/);
    assert.equal(prepared.chunks[0].metadata.category, "billing");
    assert.equal(prepared.chunks[0].metadata.language, "en");
    assert.throws(() => validateIngestionInput({ type: "pdf", knowledgeBaseId: "base", title: "Invalid", filename: "invalid.pdf", objectId: "not-a-uuid" }), /PDF object reference/);
    const fetched: string[] = [];
    CrawlerSecurity.safeFetch = async (url) => { fetched.push(url); return url.endsWith("/next") ? "<main>Second useful page</main>" : '<main>First page</main><a href="/next">Next</a><a href="/next#section">Duplicate</a><a href="http://127.0.0.1/">Internal</a>'; };
    const crawl = await IngestionService.prepare({ type: "website", knowledgeBaseId: "base", title: "Docs", targetUrl: "https://example.com/", maxPages: 2, maxDepth: 1 });
    assert.deepEqual(fetched, ["https://example.com/", "https://example.com/next"]);
    assert.equal(crawl.pages.length, 2);
    UniversalAIGateway.generateEmbeddings = async () => [[1, 2]];
    await assert.rejects(IngestionService.prepare({ type: "document", title: "Wrong dimensions", knowledgeBaseId: "base", content: "Example content" }), /Invalid embedding/);
    console.log("Ingestion regression tests passed (chunking, replay fencing, FAQ, crawl bounds, SSRF, embedding failures).");
  } finally {
    UniversalAIGateway.generateEmbeddings = originalEmbeddings;
    CrawlerSecurity.safeFetch = originalFetch;
    if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
