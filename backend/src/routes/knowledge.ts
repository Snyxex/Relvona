import { Router } from "express";
import multer from "multer";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { knowledgeBases, knowledgeSources, websites } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { queueService } from "../services/queueService.js";
import { FileSecurity } from "../services/fileSecurity.js";
import { CrawlerSecurity } from "../services/crawlerSecurity.js";
import { AuditService } from "../services/auditService.js";

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are supported"));
    }
  },
});

const router = Router();
router.use(authenticate);
router.use(tenantContext);

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
      .select()
      .from(knowledgeSources)
      .where(whereClause)
      .orderBy(desc(knowledgeSources.createdAt));

    return res.json(sources);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/knowledge/text (Manual text or FAQ upload)
router.post("/text", requireRole(["owner", "admin", "agent"]), async (req: AuthRequest, res) => {
  try {
    const { knowledgeBaseId, title, type, content } = req.body;
    if (!knowledgeBaseId || !title || !content) {
      return res.status(400).json({ error: "Missing required fields: knowledgeBaseId, title, content" });
    }

    // File/Text Poisoning Scan
    const scan = FileSecurity.scanForPoisoningPatterns(content);

    const job = await queueService.enqueueDocumentIngestion({
      organizationId: req.organization!.id,
      knowledgeBaseId,
      title,
      sourceType: type === "faq" ? "faq" : "document",
      content,
      securityStatus: scan.isSuspicious ? "SUSPICIOUS" : "SAFE",
    });
    return res.status(202).json({ jobId: job.id, status: "queued", securityStatus: scan.isSuspicious ? "SUSPICIOUS" : "SAFE" });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/knowledge/pdf (PDF Upload with Magic Byte & Poisoning Check)
router.post("/pdf", requireRole(["owner", "admin", "agent"]), upload.single("file"), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "PDF file is required" });
    }

    const { knowledgeBaseId, title } = req.body;
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
    return res.status(202).json({ jobId: job.id, status: "queued", securityStatus: validation.securityStatus });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/v1/knowledge/crawl (SSRF Protected Crawler)
router.post("/crawl", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { knowledgeBaseId, targetUrl, maxPages } = req.body;
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
    });

    await AuditService.logAction({
      organizationId: req.organization!.id,
      actorUserId: req.user!.id,
      action: "website.crawl_requested",
      resourceType: "website",
      metadata: { targetUrl: safeUrl },
    });

    return res.status(202).json({ message: "Website crawl queued successfully", jobId: job.id, targetUrl: safeUrl });
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
});

// DELETE /api/v1/knowledge/sources/:id
router.delete("/sources/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    await db
      .delete(knowledgeSources)
      .where(and(eq(knowledgeSources.id, req.params.id), eq(knowledgeSources.organizationId, req.organization!.id)));

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
