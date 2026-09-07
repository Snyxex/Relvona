import { Router } from "express";
import { authenticate, tenantContext, requireRole, requirePlatformAdmin, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { assistants } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { encryptSecret } from "../utils/crypto.js";
import crypto from "crypto";
import { IngestionService } from "../services/ingestionService.js";

const newWidgetApiKey = () => `wpk_${crypto.randomBytes(24).toString("base64url")}`;

function normalizeProviderBaseUrl(provider: unknown, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  // Older rows use NULL for an unset URL. The dashboard sends the complete
  // assistant object back on save, so accept that legacy representation as an
  // empty URL rather than rejecting unrelated settings (for example widgets).
  if (value === null) return "";
  if (typeof value !== "string") throw new Error("Provider base URL must be a string");
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (provider !== "local") throw new Error("Custom base URLs are supported only for the local provider");
  const url = new URL(trimmed);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash) throw new Error("Local provider base URL must be an HTTP(S) URL without credentials");
  return url.toString().replace(/\/$/, "");
}

function validateEmbeddingConfiguration(provider: unknown, model: unknown, baseUrl: unknown) {
  if (provider !== undefined && provider !== IngestionService.embeddingProvider) {
    throw new Error(`Knowledge embeddings currently support only '${IngestionService.embeddingProvider}' so ingestion and retrieval remain in the same vector space`);
  }
  if (model !== undefined && model !== null && model !== "" && model !== IngestionService.embeddingModel) {
    throw new Error(`Knowledge embeddings currently require model '${IngestionService.embeddingModel}'`);
  }
  if (baseUrl !== undefined && baseUrl !== null && String(baseUrl).trim()) {
    throw new Error("Custom embedding base URLs are not supported by the shared knowledge index");
  }
}

function normalizeWidgetOrigins(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("widgetAllowedOrigins must contain at most 20 origins");
  return [...new Set(value.map((entry) => {
    if (typeof entry !== "string") throw new Error("Every widget origin must be a string");
    const url = new URL(entry.trim());
    if (!/^https?:$/.test(url.protocol) || url.origin !== entry.trim().replace(/\/$/, "")) throw new Error("Widget origins must be exact http(s) origins");
    return url.origin;
  }))];
}

function withoutSecrets(assistant: typeof assistants.$inferSelect) {
  const { apiKey, embeddingApiKey, modelProfiles, ...safe } = assistant;
  const publicProfiles = Array.isArray(modelProfiles) ? modelProfiles.map((profile: any) => ({
    id: profile.id, label: profile.label, provider: profile.provider, modelName: profile.modelName, baseUrl: profile.baseUrl || "", apiKeyConfigured: Boolean(profile.apiKey),
  })) : [];
  return { ...safe, modelProfiles: publicProfiles, apiKeyConfigured: Boolean(apiKey), embeddingApiKeyConfigured: Boolean(embeddingApiKey) };
}

function normalizeModelProfiles(value: unknown, existing: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw new Error("At most 8 model profiles are allowed");
  const prior = new Map((Array.isArray(existing) ? existing : []).map((profile: any) => [profile?.id, profile]));
  const providers = new Set(["openai", "anthropic", "google", "nvidia", "local"]);
  return value.map((profile: any) => {
    if (!profile || typeof profile !== "object" || typeof profile.id !== "string" || !/^[a-zA-Z0-9_-]{4,64}$/.test(profile.id)) throw new Error("Invalid model profile id");
    if (typeof profile.label !== "string" || !profile.label.trim() || profile.label.length > 60 || !providers.has(profile.provider) || typeof profile.modelName !== "string" || !profile.modelName.trim() || profile.modelName.length > 160) throw new Error("Invalid model profile");
    const previous = prior.get(profile.id) as any;
    const apiKey = typeof profile.apiKey === "string" && profile.apiKey.trim() ? encryptSecret(profile.apiKey.trim()) : previous?.apiKey || null;
    return { id: profile.id, label: profile.label.trim(), provider: profile.provider, modelName: profile.modelName.trim(), baseUrl: normalizeProviderBaseUrl(profile.provider, profile.baseUrl)?.slice(0, 300) || "", apiKey };
  });
}

const router = Router();
router.use(authenticate);
router.use(tenantContext);

// GET /api/v1/assistants
router.get("/", async (req: AuthRequest, res) => {
  try {
    const list = await db
      .select()
      .from(assistants)
      .where(eq(assistants.organizationId, req.organization!.id));

    if (list.length === 0) {
      // A read endpoint must not turn a Viewer or Agent into a tenant writer.
      // Only organization administrators may initialize the first assistant.
      if (!["owner", "admin"].includes(req.organization!.role)) return res.json([]);
      const [newAssistant] = await db
        .insert(assistants)
        .values({
          organizationId: req.organization!.id,
          name: "Support AI",
          widgetApiKey: newWidgetApiKey(),
        })
        .returning();

      return res.json([withoutSecrets(newAssistant)]);
    }

    // Backfill assistants that existed before public widget keys were added.
    const readyList = await Promise.all(list.map(async (assistant) => {
      if (assistant.widgetApiKey) return assistant;
      const [updated] = await db.update(assistants).set({ widgetApiKey: newWidgetApiKey(), updatedAt: new Date() }).where(eq(assistants.id, assistant.id)).returning();
      return updated;
    }));
    return res.json(readyList.map(withoutSecrets));
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

// PUT /api/v1/assistants/:id
router.put("/:id", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const {
      name,
      systemPrompt,
      modelProvider,
      modelName,
      apiKey,
      baseUrl,
      embeddingProvider,
      embeddingModel,
      embeddingApiKey,
      embeddingBaseUrl,
      temperature,
      handoffEnabled,
      handoffKeywords,
      primaryColor,
      welcomeMessage,
      widgetAllowedOrigins,
      chatPageEnabled,
      widgetSettings,
      modelProfiles,
      activeModelProfileId,
    } = req.body;

    const normalizedOrigins = widgetAllowedOrigins === undefined ? undefined : normalizeWidgetOrigins(widgetAllowedOrigins);
    const [existingAssistant] = await db.select({ modelProfiles: assistants.modelProfiles, modelProvider: assistants.modelProvider, embeddingProvider: assistants.embeddingProvider, embeddingModel: assistants.embeddingModel, embeddingBaseUrl: assistants.embeddingBaseUrl }).from(assistants).where(and(eq(assistants.id, req.params.id), eq(assistants.organizationId, req.organization!.id))).limit(1);
    if (!existingAssistant) return res.status(404).json({ error: "Assistant not found" });
    validateEmbeddingConfiguration(embeddingProvider ?? existingAssistant.embeddingProvider, embeddingModel ?? existingAssistant.embeddingModel, embeddingBaseUrl ?? existingAssistant.embeddingBaseUrl);
    const normalizedProfiles = normalizeModelProfiles(modelProfiles, existingAssistant.modelProfiles);
    const normalizedBaseUrl = normalizeProviderBaseUrl(modelProvider ?? existingAssistant.modelProvider, baseUrl);
    const normalizedEmbeddingBaseUrl = embeddingBaseUrl === undefined ? undefined : "";
    if (activeModelProfileId !== undefined && activeModelProfileId !== null && (!normalizedProfiles || !normalizedProfiles.some((profile) => profile.id === activeModelProfileId))) throw new Error("Active model profile does not exist");

    const [updated] = await db
      .update(assistants)
      .set({
        name: name !== undefined ? name : undefined,
        systemPrompt: systemPrompt !== undefined ? systemPrompt : undefined,
        modelProvider: modelProvider !== undefined ? modelProvider : undefined,
        modelName: modelName !== undefined ? modelName : undefined,
        apiKey: apiKey !== undefined ? encryptSecret(apiKey) : undefined,
        baseUrl: normalizedBaseUrl,
        embeddingProvider: embeddingProvider !== undefined ? IngestionService.embeddingProvider : undefined,
        embeddingModel: embeddingModel !== undefined ? IngestionService.embeddingModel : undefined,
        embeddingApiKey: embeddingApiKey !== undefined ? encryptSecret(embeddingApiKey) : undefined,
        embeddingBaseUrl: normalizedEmbeddingBaseUrl,
        temperature: temperature !== undefined ? parseFloat(temperature) : undefined,
        handoffEnabled: handoffEnabled !== undefined ? Boolean(handoffEnabled) : undefined,
        handoffKeywords: handoffKeywords !== undefined ? handoffKeywords : undefined,
        primaryColor: primaryColor !== undefined ? primaryColor : undefined,
        welcomeMessage: welcomeMessage !== undefined ? welcomeMessage : undefined,
        widgetAllowedOrigins: normalizedOrigins,
        chatPageEnabled: chatPageEnabled !== undefined ? Boolean(chatPageEnabled) : undefined,
        widgetSettings: widgetSettings !== undefined && typeof widgetSettings === "object" && !Array.isArray(widgetSettings) ? widgetSettings : undefined,
        modelProfiles: normalizedProfiles,
        activeModelProfileId: activeModelProfileId !== undefined ? activeModelProfileId : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(assistants.id, req.params.id), eq(assistants.organizationId, req.organization!.id)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Assistant not found" });
    }

    return res.json(withoutSecrets(updated));
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
});

// Rotating this key immediately invalidates the previous public browser integration.
router.post("/:id/widget-key/rotate", requireRole(["owner", "admin"]), async (req: AuthRequest, res) => {
  try {
    const [updated] = await db.update(assistants)
      .set({ widgetApiKey: newWidgetApiKey(), updatedAt: new Date() })
      .where(and(eq(assistants.id, req.params.id), eq(assistants.organizationId, req.organization!.id)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Assistant not found" });
    return res.json(withoutSecrets(updated));
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
