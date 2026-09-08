import { Router, json, type Response, type NextFunction } from "express";
import multer from "multer";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { knowledgeBases, knowledgeSources, knowledgeIngestionJobs, knowledgeSourceRevisions, websites } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { queueService } from "../services/queueService.js";
import { FileSecurity } from "../services/fileSecurity.js";
import { CrawlerSecurity } from "../services/crawlerSecurity.js";
import { AuditService } from "../services/auditService.js";
import { IngestionJobService, IngestionInputError } from "../services/ingestionJobService.js";
import { FileObjectService } from "../services/fileObjectService.js";
import { objectStorage } from "../services/objectStorage.js";
import { objectStorageConfig } from "../config/objectStorage.js";
import { sendInternalError } from "../utils/httpErrors.js";

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4, parts: 5, fieldNameSize: 100, fieldSize: 10_000 },
  fileFilter: (_req, file, cb) => file.mimetype === "application/pdf" && file.originalname.toLowerCase().endsWith(".pdf") ? cb(null, true) : cb(new Error("Only PDF files are supported")),
});
const knowledgeTextJson = json({ limit: "2mb" });

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

router.get("/bases", async (req: AuthRequest, res) => {
  try { return res.json(await db.select().from(knowledgeBases).where(eq(knowledgeBases.organizationId, req.organization!.id)).orderBy(desc(knowledgeBases.createdAt))); }
  catch (error) { return sendInternalError(req, res, error, { code: "KNOWLEDGE_BASES_LOAD_FAILED", message: "Unable to load knowledge bases" }); }
});

router.post("/bases", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const [kb] = await db.insert(knowledgeBases).values({ organizationId: req.organization!.id, name, description }).returning();
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge_base.create", resourceType: "knowledge_base", resourceId: kb.id, metadata: { name } });
    return res.status(201).json(kb);
  } catch (error) { return sendInternalError(req, res, error, { code: "KNOWLEDGE_BASE_CREATE_FAILED", message: "Unable to create knowledge base" }); }
});

router.delete("/bases/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    await db.delete(knowledgeBases).where(and(eq(knowledgeBases.id, req.params.id), eq(knowledgeBases.organizationId, req.organization!.id)));
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge_base.delete", resourceType: "knowledge_base", resourceId: req.params.id });
    return res.json({ success: true });
  } catch (error) { return sendInternalError(req, res, error, { code: "KNOWLEDGE_BASE_DELETE_FAILED", message: "Unable to delete knowledge base" }); }
});

router.get("/sources", async (req: AuthRequest, res) => {
  try {
    const { knowledgeBaseId } = req.query;
    let whereClause = eq(knowledgeSources.organizationId, req.organization!.id);
    if (knowledgeBaseId) whereClause = and(whereClause, eq(knowledgeSources.knowledgeBaseId, knowledgeBaseId as string))!;
    const sources = await db.select({ source: knowledgeSources, job: { id: knowledgeIngestionJobs.id, status: knowledgeIngestionJobs.status, revision: knowledgeIngestionJobs.revision, attempts: knowledgeIngestionJobs.attempts, errorMessage: knowledgeIngestionJobs.errorMessage, startedAt: knowledgeIngestionJobs.startedAt, finishedAt: knowledgeIngestionJobs.finishedAt } }).from(knowledgeSources).leftJoin(knowledgeIngestionJobs, and(eq(knowledgeIngestionJobs.sourceId, knowledgeSources.id), eq(knowledgeIngestionJobs.organizationId, req.organization!.id))).where(whereClause).orderBy(desc(knowledgeSources.createdAt));
    return res.json(sources.map(({ source, job }) => ({ ...source, job })));
  } catch (error) { return sendInternalError(req, res, error, { code: "KNOWLEDGE_SOURCES_LOAD_FAILED", message: "Unable to load knowledge sources" }); }
});

router.post("/text", requireRole(["owner", "admin"]), knowledgeTextJson, async (req: AuthRequest, res) => {
  try {
    const { knowledgeBaseId, title, type, content, category, language } = req.body;
    if (typeof title !== "string" || !title.trim() || title.length > 300 || typeof content !== "string" || !content.trim() || content.length > 500_000) return res.status(400).json({ error: "Missing required fields: knowledgeBaseId, title, content" });
    if (!await ownsKnowledgeBase(req.organization!.id, knowledgeBaseId)) return res.status(404).json({ error: "Knowledge base not found" });
    const scan = FileSecurity.scanForPoisoningPatterns(content);
    const job = await queueService.enqueueDocumentIngestion({ organizationId: req.organization!.id, knowledgeBaseId, title, sourceType: type === "faq" ? "faq" : "document", content, category, language, securityStatus: scan.isSuspicious ? "SUSPICIOUS" : "SAFE" });
    return res.status(202).json({ jobId: job.id, sourceId: job.sourceId, status: "queued", securityStatus: scan.isSuspicious ? "SUSPICIOUS" : "SAFE" });
  } catch (error) { return sendInternalError(req, res, error, { code: "KNOWLEDGE_TEXT_QUEUE_FAILED", message: "Unable to queue knowledge source" }); }
});

router.post("/pdf", requireRole(["owner", "admin"]), pdfUpload, async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "PDF file is required" });
    const { knowledgeBaseId, title } = req.body;
    if (!knowledgeBaseId) return res.status(400).json({ error: "knowledgeBaseId is required" });
    if (!await ownsKnowledgeBase(req.organization!.id, knowledgeBaseId)) return res.status(404).json({ error: "Knowledge base not found" });
    const validation = FileSecurity.validateUploadedFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    if (!validation.isValid) return res.status(400).json({ error: "File Security Validation Failed", issues: validation.detectedIssues });
    const object = await FileObjectService.stageKnowledgeUpload({ organizationId: req.organization!.id, originalFilename: req.file.originalname, mimeType: validation.mimeType, body: req.file.buffer });
    const job = await queueService.enqueuePdfIngestion({ organizationId: req.organization!.id, knowledgeBaseId, title: title || validation.sanitizedFilename, filePath: validation.sanitizedFilename, objectId: object.id, securityStatus: validation.securityStatus });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge_source.upload", resourceType: "file_object", resourceId: object.id, metadata: { sourceType: "pdf", fileSize: object.fileSize } });
    return res.status(202).json({ jobId: job.id, sourceId: job.sourceId, status: "queued", securityStatus: validation.securityStatus });
  } catch (error) { return sendInternalError(req, res, error, { code: "KNOWLEDGE_PDF_QUEUE_FAILED", message: "Unable to process PDF upload" }); }
});

router.post("/crawl", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { knowledgeBaseId, targetUrl, maxPages, maxDepth } = req.body;
    if (!knowledgeBaseId || !targetUrl) return res.status(400).json({ error: "knowledgeBaseId and targetUrl are required" });
    if (!await ownsKnowledgeBase(req.organization!.id, knowledgeBaseId)) return res.status(404).json({ error: "Knowledge base not found" });
    let safeUrl: string;
    try { ({ safeUrl } = await CrawlerSecurity.validateAndResolveUrl(targetUrl)); }
    catch { return res.status(400).json({ error: "Website URL is invalid or not allowed by the crawler security policy", code: "CRAWL_URL_BLOCKED" }); }
    const job = await queueService.enqueueWebsiteCrawl({ organizationId: req.organization!.id, knowledgeBaseId, targetUrl: safeUrl, maxPages, maxDepth });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "website.crawl_requested", resourceType: "website", metadata: { targetUrl: safeUrl } });
    return res.status(202).json({ message: "Website crawl queued successfully", jobId: job.id, sourceId: job.sourceId, targetUrl: safeUrl });
  } catch (error) { return sendInternalError(req, res, error, { code: "WEBSITE_CRAWL_QUEUE_FAILED", message: "Unable to queue website crawl" }); }
});

router.post("/sources/:id/reprocess", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const input = await IngestionJobService.inputFor(req.organization!.id, req.params.id);
    const job = await queueService.submit(req.organization!.id, input, req.params.id);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge_source.reprocess", resourceType: "knowledge_source", resourceId: req.params.id });
    return res.status(202).json({ jobId: job.id, sourceId: job.sourceId, status: "queued" });
  } catch (error) {
    if (error instanceof IngestionInputError) return res.status(400).json({ error: error.message, code: "INVALID_INGESTION_SOURCE" });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_REPROCESS_FAILED", message: "Unable to reprocess source" });
  }
});

router.post("/pdf/intent", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const { knowledgeBaseId, title, originalFilename, mimeType, maxSize } = req.body;
    if (!await ownsKnowledgeBase(req.organization!.id, knowledgeBaseId) || typeof title !== "string" || typeof originalFilename !== "string" || mimeType !== "application/pdf" || !Number.isInteger(maxSize) || maxSize < 1 || maxSize > 10 * 1024 * 1024) return res.status(400).json({ error: "UPLOAD_INVALID" });
    const intent = await FileObjectService.createKnowledgeUploadIntent({ organizationId: req.organization!.id, knowledgeBaseId, title, originalFilename, mimeType, maxSize });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "file.upload_intent_created", resourceType: "file_object", resourceId: intent.object.id });
    return res.status(201).json({ objectId: intent.object.id, uploadUrl: intent.uploadUrl, expiresInSeconds: objectStorageConfig().signedUrlTtlSeconds });
  } catch { return res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); }
});

router.post("/pdf/:objectId/finalize", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const result = await FileObjectService.finalizeKnowledgeUpload(req.organization!.id, req.params.objectId);
    if (result.alreadyFinalized) return res.json({ objectId: result.object.id, status: "UPLOADED", alreadyFinalized: true });
    const meta = result.object.metadata as { knowledgeBaseId: string; title: string };
    const job = await queueService.enqueuePdfIngestion({ organizationId: req.organization!.id, knowledgeBaseId: meta.knowledgeBaseId, title: meta.title, filePath: result.object.originalFilename, objectId: result.object.id, securityStatus: result.validation!.securityStatus });
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "file.upload_finalized", resourceType: "file_object", resourceId: result.object.id });
    return res.status(202).json({ objectId: result.object.id, sourceId: job.sourceId, jobId: job.id, status: "queued" });
  } catch (error) { const code = (error as Error).message; return res.status(code === "FILE_NOT_FOUND" ? 404 : code === "UPLOAD_INVALID" ? 400 : 409).json({ error: code }); }
});

router.get("/sources/:id/download", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const [revision] = await db.select({ rawObjectId: knowledgeSourceRevisions.rawObjectId }).from(knowledgeSourceRevisions).where(and(eq(knowledgeSourceRevisions.sourceId, req.params.id), eq(knowledgeSourceRevisions.organizationId, req.organization!.id))).orderBy(desc(knowledgeSourceRevisions.revision)).limit(1);
    if (!revision?.rawObjectId) return res.status(404).json({ error: "Download unavailable" });
    const file = await FileObjectService.readForOrganization(req.organization!.id, revision.rawObjectId);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge_source.download", resourceType: "file_object", resourceId: revision.rawObjectId });
    if (objectStorageConfig().provider === "s3") return res.json({ downloadUrl: await objectStorage().createSignedDownloadUrl(file.object.storageKey, objectStorageConfig().signedUrlTtlSeconds) });
    res.type(file.object.mimeType).setHeader("Content-Disposition", `attachment; filename="${file.object.originalFilename.replace(/[\\\"\r\n]/g, "_")}"`);
    file.body.pipe(res);
  } catch { return res.status(404).json({ error: "Download unavailable" }); }
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
  } catch (error) {
    if (error instanceof IngestionInputError) return res.status(400).json({ error: error.message, code: "INVALID_INGESTION_SOURCE" });
    return sendInternalError(req, res, error, { code: "KNOWLEDGE_SOURCE_UPDATE_FAILED", message: "Unable to update source" });
  }
});

router.delete("/sources/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const revisions = await db.select({ rawObjectId: knowledgeSourceRevisions.rawObjectId }).from(knowledgeSourceRevisions).where(and(eq(knowledgeSourceRevisions.sourceId, req.params.id), eq(knowledgeSourceRevisions.organizationId, req.organization!.id)));
    const deleted = await db.delete(knowledgeSources).where(and(eq(knowledgeSources.id, req.params.id), eq(knowledgeSources.organizationId, req.organization!.id))).returning({ id: knowledgeSources.id });
    if (!deleted.length) return res.status(404).json({ error: "Knowledge source not found" });
    for (const revision of revisions) if (revision.rawObjectId) await FileObjectService.deleteForOrganization(req.organization!.id, revision.rawObjectId);
    await AuditService.logAction({ organizationId: req.organization!.id, actorUserId: req.user!.id, action: "knowledge_source.delete", resourceType: "knowledge_source", resourceId: req.params.id });
    return res.json({ success: true });
  } catch (error) { return sendInternalError(req, res, error, { code: "KNOWLEDGE_SOURCE_DELETE_FAILED", message: "Unable to delete knowledge source" }); }
});

router.get("/websites", async (req: AuthRequest, res) => {
  try { return res.json(await db.select().from(websites).where(eq(websites.organizationId, req.organization!.id))); }
  catch (error) { return sendInternalError(req, res, error, { code: "WEBSITES_LOAD_FAILED", message: "Unable to load websites" }); }
});

export default router;
