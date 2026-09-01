import { Router } from "express";
import { authenticate, tenantContext, requireRole, AuthRequest } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { assistants } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

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
      const [newAssistant] = await db
        .insert(assistants)
        .values({
          organizationId: req.organization!.id,
          name: "Support AI",
        })
        .returning();

      return res.json([newAssistant]);
    }

    return res.json(list);
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
    } = req.body;

    const [updated] = await db
      .update(assistants)
      .set({
        name: name !== undefined ? name : undefined,
        systemPrompt: systemPrompt !== undefined ? systemPrompt : undefined,
        modelProvider: modelProvider !== undefined ? modelProvider : undefined,
        modelName: modelName !== undefined ? modelName : undefined,
        apiKey: apiKey !== undefined ? apiKey : undefined,
        baseUrl: baseUrl !== undefined ? baseUrl : undefined,
        embeddingProvider: embeddingProvider !== undefined ? embeddingProvider : undefined,
        embeddingModel: embeddingModel !== undefined ? embeddingModel : undefined,
        embeddingApiKey: embeddingApiKey !== undefined ? embeddingApiKey : undefined,
        embeddingBaseUrl: embeddingBaseUrl !== undefined ? embeddingBaseUrl : undefined,
        temperature: temperature !== undefined ? parseFloat(temperature) : undefined,
        handoffEnabled: handoffEnabled !== undefined ? Boolean(handoffEnabled) : undefined,
        handoffKeywords: handoffKeywords !== undefined ? handoffKeywords : undefined,
        primaryColor: primaryColor !== undefined ? primaryColor : undefined,
        welcomeMessage: welcomeMessage !== undefined ? welcomeMessage : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(assistants.id, req.params.id), eq(assistants.organizationId, req.organization!.id)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Assistant not found" });
    }

    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
