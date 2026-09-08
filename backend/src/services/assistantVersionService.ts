import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { assistantVersions } from "../db/assistantVersionSchema.js";
import { assistants } from "../db/schema.js";

type AssistantRow = typeof assistants.$inferSelect;
type AssistantSnapshot = {
  name: string;
  avatarUrl: string | null;
  systemPrompt: string;
  modelProvider: string;
  modelName: string;
  apiKey: string | null;
  baseUrl: string | null;
  embeddingProvider: string;
  embeddingModel: string | null;
  embeddingApiKey: string | null;
  embeddingBaseUrl: string | null;
  temperature: number;
  handoffEnabled: boolean;
  handoffKeywords: any;
  primaryColor: string;
  welcomeMessage: string;
  widgetAllowedOrigins: any;
  chatPageEnabled: boolean;
  widgetSettings: any;
  modelProfiles: any;
  activeModelProfileId: string | null;
};

function snapshotOf(assistant: AssistantRow): AssistantSnapshot {
  return {
    name: assistant.name,
    avatarUrl: assistant.avatarUrl,
    systemPrompt: assistant.systemPrompt,
    modelProvider: assistant.modelProvider,
    modelName: assistant.modelName,
    apiKey: assistant.apiKey,
    baseUrl: assistant.baseUrl,
    embeddingProvider: assistant.embeddingProvider,
    embeddingModel: assistant.embeddingModel,
    embeddingApiKey: assistant.embeddingApiKey,
    embeddingBaseUrl: assistant.embeddingBaseUrl,
    temperature: assistant.temperature,
    handoffEnabled: assistant.handoffEnabled,
    handoffKeywords: assistant.handoffKeywords,
    primaryColor: assistant.primaryColor,
    welcomeMessage: assistant.welcomeMessage,
    widgetAllowedOrigins: assistant.widgetAllowedOrigins,
    chatPageEnabled: assistant.chatPageEnabled,
    widgetSettings: assistant.widgetSettings,
    modelProfiles: assistant.modelProfiles,
    activeModelProfileId: assistant.activeModelProfileId,
  };
}

function publicVersion(row: typeof assistantVersions.$inferSelect) {
  const snapshot = row.snapshot as AssistantSnapshot;
  return {
    id: row.id,
    assistantId: row.assistantId,
    version: row.version,
    label: row.label,
    status: row.status,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
    snapshot: {
      name: snapshot.name,
      avatarUrl: snapshot.avatarUrl,
      systemPrompt: snapshot.systemPrompt,
      modelProvider: snapshot.modelProvider,
      modelName: snapshot.modelName,
      baseUrl: snapshot.baseUrl,
      temperature: snapshot.temperature,
      handoffEnabled: snapshot.handoffEnabled,
      handoffKeywords: snapshot.handoffKeywords,
      primaryColor: snapshot.primaryColor,
      welcomeMessage: snapshot.welcomeMessage,
      widgetAllowedOrigins: snapshot.widgetAllowedOrigins,
      chatPageEnabled: snapshot.chatPageEnabled,
      widgetSettings: snapshot.widgetSettings,
      modelProfiles: Array.isArray(snapshot.modelProfiles)
        ? snapshot.modelProfiles.map((profile: any) => ({
            id: profile?.id,
            label: profile?.label,
            provider: profile?.provider,
            modelName: profile?.modelName,
            baseUrl: profile?.baseUrl || "",
            apiKeyConfigured: Boolean(profile?.apiKey),
          }))
        : [],
      activeModelProfileId: snapshot.activeModelProfileId,
      apiKeyConfigured: Boolean(snapshot.apiKey),
      embeddingApiKeyConfigured: Boolean(snapshot.embeddingApiKey),
      embeddingProvider: snapshot.embeddingProvider,
      embeddingModel: snapshot.embeddingModel,
    },
  };
}

export class AssistantVersionService {
  static async list(organizationId: string, assistantId: string) {
    const rows = await db.select().from(assistantVersions).where(and(
      eq(assistantVersions.organizationId, organizationId),
      eq(assistantVersions.assistantId, assistantId),
    )).orderBy(desc(assistantVersions.version));
    return rows.map(publicVersion);
  }

  static async publish(data: { organizationId: string; assistantId: string; userId: string; label?: string }) {
    const label = data.label?.trim().slice(0, 120) || null;
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`assistant-version:${data.organizationId}:${data.assistantId}`}))`);
      const [assistant] = await tx.select().from(assistants).where(and(
        eq(assistants.organizationId, data.organizationId),
        eq(assistants.id, data.assistantId),
      )).limit(1);
      if (!assistant) throw new Error("Assistant not found");

      const [latest] = await tx.select({ version: assistantVersions.version }).from(assistantVersions).where(and(
        eq(assistantVersions.organizationId, data.organizationId),
        eq(assistantVersions.assistantId, data.assistantId),
      )).orderBy(desc(assistantVersions.version)).limit(1);

      const [created] = await tx.insert(assistantVersions).values({
        organizationId: data.organizationId,
        assistantId: data.assistantId,
        version: (latest?.version || 0) + 1,
        label,
        snapshot: snapshotOf(assistant),
        createdByUserId: data.userId,
      }).returning();
      return publicVersion(created);
    });
  }

  static async activate(data: { organizationId: string; assistantId: string; versionId: string }) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`assistant-version:${data.organizationId}:${data.assistantId}`}))`);
      const [version] = await tx.select().from(assistantVersions).where(and(
        eq(assistantVersions.organizationId, data.organizationId),
        eq(assistantVersions.assistantId, data.assistantId),
        eq(assistantVersions.id, data.versionId),
      )).limit(1);
      if (!version) throw new Error("Assistant version not found");
      const snapshot = version.snapshot as AssistantSnapshot;

      const [updatedAssistant] = await tx.update(assistants).set({
        name: snapshot.name,
        avatarUrl: snapshot.avatarUrl,
        systemPrompt: snapshot.systemPrompt,
        modelProvider: snapshot.modelProvider,
        modelName: snapshot.modelName,
        apiKey: snapshot.apiKey,
        baseUrl: snapshot.baseUrl,
        embeddingProvider: snapshot.embeddingProvider,
        embeddingModel: snapshot.embeddingModel,
        embeddingApiKey: snapshot.embeddingApiKey,
        embeddingBaseUrl: snapshot.embeddingBaseUrl,
        temperature: snapshot.temperature,
        handoffEnabled: snapshot.handoffEnabled,
        handoffKeywords: snapshot.handoffKeywords,
        primaryColor: snapshot.primaryColor,
        welcomeMessage: snapshot.welcomeMessage,
        widgetAllowedOrigins: snapshot.widgetAllowedOrigins,
        chatPageEnabled: snapshot.chatPageEnabled,
        widgetSettings: snapshot.widgetSettings,
        modelProfiles: snapshot.modelProfiles,
        activeModelProfileId: snapshot.activeModelProfileId,
        updatedAt: new Date(),
      }).where(and(eq(assistants.organizationId, data.organizationId), eq(assistants.id, data.assistantId))).returning();
      if (!updatedAssistant) throw new Error("Assistant not found");

      await tx.update(assistantVersions).set({ status: "archived" }).where(and(
        eq(assistantVersions.organizationId, data.organizationId),
        eq(assistantVersions.assistantId, data.assistantId),
        eq(assistantVersions.status, "active"),
      ));
      const [activated] = await tx.update(assistantVersions).set({ status: "active", activatedAt: new Date() }).where(and(
        eq(assistantVersions.organizationId, data.organizationId),
        eq(assistantVersions.assistantId, data.assistantId),
        eq(assistantVersions.id, data.versionId),
      )).returning();
      return { version: publicVersion(activated), assistant: updatedAssistant };
    });
  }

  static async markLiveDraft(organizationId: string, assistantId: string) {
    await db.update(assistantVersions).set({ status: "archived" }).where(and(
      eq(assistantVersions.organizationId, organizationId),
      eq(assistantVersions.assistantId, assistantId),
      eq(assistantVersions.status, "active"),
    ));
  }
}
