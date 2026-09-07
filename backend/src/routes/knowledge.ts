import { Router, type Response, type NextFunction } from "express";
import multer from "multer";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { knowledgeBases, knowledgeSources, knowledgeIngestionJobs, websites } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { queueService } from "../services/queueService.js";
import { FileSecurity } from "../services/fileSecurity.js";
import { CrawlerSecurity } from "../services/crawlerSecurity.js";
import { AuditService } from "../services/auditService.js";
import { IngestionJobService, IngestionInputError } from "../services/ingestionJobService.js";

const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 4,
    parts: 5,
    fieldNameSize: 100,
    fieldSize: 10_000,
    fieldNestingDepth: 2,
    // Multer 2.3.0 supports this runtime hardening option; the DefinitelyTyped
    // declaration has not exposed it yet, so keep it as a spread extension.
    ...{ fieldArrayIndexLimit: 10 },
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" && file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are supported"));
    }
  },
});

function pdfUpload(req: AuthRequest, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "PDF file exceeds the 10 MB upload limit" : "Invalid multipart PDF upload" });
    }
    return res.status(400).json({ error: "Invalid PDF upload" });
  });
}

const router = Router();
router.use(authenticate);
router.use(tenantContext);

async function ownsKnowledgeBase(organizationId: string, knowledgeBaseId: unknown) {
  if (typeof knowledgeBaseId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(knowledgeBaseId)) return false;
  const [base] = await db.select({ id: knowledgeBases.id }).from(knowledgeBases).where(and(eq(knowledgeBases.id, knowledgeBaseId), eq(knowledgeBases.organizationId, organizationId))).limit(1);
  return Boolean(base);
}

// --- Knowledge Bases ---

// GET /api/v1/knowledge/bases
router.get("/bases", async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.organizationId, req.organization!.id))
      .orderBy(desc(knowledgeBases.createdAt));

    return res.json(list);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/knowledge/bases
router.post("/bases", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const [kb] = await db
      .insert(knowledgeBases)
      .values({
        organizationId: req.organization!.id,
        name,
        description,
      })
      .returning();

    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "knowledge_base.create",
      resourceType: "knowledge_base",
      resourceId: kb.id,
      metadata: { name },
    });

    return res.status(201).json(kb);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// DELETE /api/v1/knowledge/bases/:id
router.delete("/bases/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    await db
      .delete(knowledgeBases)
      .where(and(eq(knowledgeBases.id, req.params.id), eq(knowledgeBases.organizationId, req.organization!.id)));

    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "knowledge_base.delete",
      resourceType: "knowledge_base",
      resourceId: req.params.id,
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// --- Knowledge Sources ---

// GET /api/v1/knowledge/sources
router.get("/sources", async (req: AuthRequest, res) => {
  try {
    const { knowledgeBaseId } = req.query;
    let whereClause = eq(knowledgeSources.organizationId, req.organization!.id);

    if (knowledgeBaseId) {
      whereClause = and(whereClause, eq(knowledgeSources.knowledgeBaseId, knowledgeBaseId as string))!;
    }

    const sources = await db
      .select({ source: knowledgeSources, job: { id: knowledgeIngestionJobs.id, status: knowledgeIngestionJobs.status, revision: knowledgeIngestionJobs.revision, attempts: knowledgeIngestionJobs.attempts, errorMessage: knowledgeIngestionJobs.errorMessage, startedAt: knowledgeIngestionJobs.startedAt, finishedAt: knowledgeIngestionJobs.finishedAt } })
      .from(knowledgeSources)
      .leftJoin(knowledgeIngestionJobs, and(eq(knowledgeIngestionJobs.sourceId, knowledgeSources.id), eq(knowledgeIngestionJobs.organizationId, req.organization!.id)))
      .where(whereClause)
      .orderBy(desc(knowledgeSources.createdAt));

    return res.json(sources.map(({ source, job }) => ({ ...source, job })));
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/knowledge/text (Manual text or FAQ upload)
router.post("/text", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { knowledgeBaseId, title, type, content, category, language } = req.body;
    if (typeof title !== "string" || !title.trim() || title.length > 300 || typeof content !== "string" || !content.trim() || content.length > 500_000) {
      return res.status(400).json({ error: "Missing required fields: knowledgeBaseId, title, content" });
    }
    if (!await ownsKnowledgeBase(req.organization!.id, knowledgeBaseId)) return res.status(404).json({ error: "Knowledge base not found" });

    // File/Text Poisoning Scan
    const scan = FileSecurity.scanForPoisoningPatterns(content);

    const job = await queueService.enqueueDocumentIngestion({
      organizationId: req.organization!.id,
      knowledgeBaseId,
      title,
      sourceType: type === "faq" ? "faq" : "document",
      content,
      category,
      language,
      securityStatus: scan.isSuspicious ? "SUSPICIOUS" : "SAFE",
    });
    return res.status(202).json({ jobId: job.id, sourceId: job.sourceId, status: "queued", securityStatus: scan.isSuspicious ? "SUSPICIOUS" : "SAFE" });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/knowledge/pdf (PDF Upload with Magic Byte & Poisoning Check)
router.post("/pdf", requireRole(["owner", "admin"]), pdfUpload, async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "PDF file is required" });
    }

    const { knowledgeBaseId, title } = req.body;
    if (!await ownsKnowledgeBase(req.organization!.id, knowledgeBaseId)) return res.status(404).json({ error: "Knowledge base not found" });
    if (!knowledgeBaseId) {
      return res.status(400).json({ error: "knowledgeBaseId is required" });
    }

    // Security Validation: Magic Bytes & Format Verification
    const validation = FileSecurity.validateUploadedFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    if (!validation.isValid) {
      return res.status(400).json({
        error: "File Security Validation Failed",
        issues: validation.detectedIssues,
      });
    }

    const docTitle = title || validation.sanitizedFilename;

    const job = await queueService.enqueuePdfIngestion({
      organizationId: req.organization!.id,
      knowledgeBaseId,
      title: docTitle,
      filePath: validation.sanitizedFilename,
      bufferBase64: req.file.buffer.toString("base64"),
      securityStatus: validation.securityStatus,
    });
    return res.status(202).json({ jobId: job.id, sourceId: job.sourceId, status: "queued", securityStatus: validation.securityStatus });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/knowledge/crawl (SSRF Protected Crawler)
router.post("/crawl", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { knowledgeBaseId, targetUrl, maxPages, maxDepth } = req.body;
    if (!await ownsKnowledgeBase(req.organization!.id, knowledgeBaseId)) return res.status(404).json({ error: "Knowledge base not found" });
    if (!knowledgeBaseId || !targetUrl) {
      return res.status(400).json({ error: "knowledgeBaseId and targetUrl are required" });
    }

    // SSRF & DNS Pre-resolution Validation
    const { safeUrl } = await CrawlerSecurity.validateAndResolveUrl(targetUrl);

    // Queue crawl task
    const job = await queueService.enqueueWebsiteCrawl({
      organizationId: req.organization!.id,
      knowledgeBaseId,
      targetUrl: safeUrl,
      maxPages,
      maxDepth,
    });

    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "website.crawl_requested",
      resourceType: "website",
      metadata: { targetUrl: safeUrl },
    });

    return res.status(202).json({ message: "Website crawl queued successfully", jobId: job.id, sourceId: job.sourceId, targetUrl: safeUrl });
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
});

// DELETE /api/v1/knowledge/sources/:id
router.post("/sources/:id/reprocess", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const input = await IngestionJobService.inputFor(req.organization!.id, req.params.id);
    const job = await queueService.submit(req.organization!.id, input, req.params.id);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge_source.reprocess", resourceType: "knowledge_source", resourceId: req.params.id });
    return res.status(202).json({ jobId: job.id, sourceId: job.sourceId, status: "queued" });
  } catch (error) { return res.status(error instanceof IngestionInputError ? 400 : 500).json({ error: error instanceof IngestionInputError ? error.message : "Unable to reprocess source" }); }
});

router.get("/sources/:id/content", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const input = await IngestionJobService.inputFor(req.organization!.id, req.params.id);
    if (input.type !== "document" && input.type !== "faq") return res.status(400).json({ error: "This source has no editable text input" });
    return res.json(input);
  } catch { return res.status(404).json({ error: "Original text unavailable" }); }
});

router.put("/sources/:id/content", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const [source] = await db.select().from(knowledgeSources).where(and(eq(knowledgeSources.id, req.params.id), eq(knowledgeSources.organizationId, req.organization!.id))).limit(1);
    if (!source) return res.status(404).json({ error: "Knowledge source not found" });
    if (source.type !== "document" && source.type !== "faq") return res.status(400).json({ error: "Only text and FAQ sources can be edited" });
    const job = await queueService.submit(req.organization!.id, { type: source.type, knowledgeBaseId: source.knowledgeBaseId, title: req.body.title, content: req.body.content, category: req.body.category, language: req.body.language }, source.id);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge_source.update", resourceType: "knowledge_source", resourceId: source.id });
    return res.status(202).json({ jobId: job.id, sourceId: source.id, status: "queued" });
  } catch (error) { return res.status(error instanceof IngestionInputError ? 400 : 500).json({ error: error instanceof IngestionInputError ? error.message : "Unable to update source" }); }
});

router.delete("/sources/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const deleted = await db
      .delete(knowledgeSources)
      .where(and(eq(knowledgeSources.id, req.params.id), eq(knowledgeSources.organizationId, req.organization!.id))).returning({ id: knowledgeSources.id });
    if (!deleted.length) return res.status(404).json({ error: "Knowledge source not found" });

    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "knowledge_source.delete",
      resourceType: "knowledge_source",
      resourceId: req.params.id,
    });

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/v1/knowledge/websites
router.get("/websites", async (req: AuthRequest, res) => {
  try {
    const list = await db.select().from(websites).where(eq(websites.organizationId, req.organization!.id));
    return res.json(list);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;