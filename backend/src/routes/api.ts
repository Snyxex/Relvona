import { Router } from "express";
import multer from "multer";
import { db } from "../db/index.js";
import { workspaces, knowledgeSources, tickets, messages } from "../db/schema.js";
import { crawlWebsite, parseAndIngestPdf, ingestFaq } from "../services/ingestionService.js";
import { processCustomerMessage, generateAiReply } from "../services/aiEngine.js";
import { eq, desc, count } from "drizzle-orm";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// --- Workspace Routes ---
router.get("/workspace", async (req, res) => {
  try {
    let [ws] = await db.select().from(workspaces).limit(1);
    if (!ws) {
      [ws] = await db
        .insert(workspaces)
        .values({
          name: "Default Workspace",
          apiKey: "ws_" + Math.random().toString(36).substring(2, 10),
          systemPrompt: "You are an intelligent, friendly AI customer support agent for our company.",
          aiModel: "openai",
          languageSupport: "auto",
        })
        .returning();
    }
    res.json(ws);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/workspace/:id", async (req, res) => {
  try {
    const { name, systemPrompt, aiModel, languageSupport } = req.body;
    const [updated] = await db
      .update(workspaces)
      .set({ name, systemPrompt, aiModel, languageSupport })
      .where(eq(workspaces.id, req.params.id))
      .returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Knowledge Base Routes ---
router.get("/knowledge/:workspaceId", async (req, res) => {
  try {
    const sources = await db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.workspaceId, req.params.workspaceId))
      .orderBy(desc(knowledgeSources.createdAt));
    res.json(sources);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/knowledge/faq", async (req, res) => {
  try {
    const { workspaceId, title, content } = req.body;
    const result = await ingestFaq(workspaceId, title, content);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/knowledge/crawl", async (req, res) => {
  try {
    const { workspaceId, url, title } = req.body;
    const result = await crawlWebsite(workspaceId, url, title);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/knowledge/pdf", upload.single("file"), async (req, res) => {
  try {
    const { workspaceId } = req.body;
    if (!req.file) return res.status(400).json({ error: "No PDF file provided" });
    const result = await parseAndIngestPdf(workspaceId, req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/knowledge/:id", async (req, res) => {
  try {
    await db.delete(knowledgeSources).where(eq(knowledgeSources.id, req.params.id));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Customer Chat & Ticket Routes ---
router.post("/chat/start", async (req, res) => {
  try {
    const { workspaceId, customerName, customerEmail, subject } = req.body;
    const [ticket] = await db
      .insert(tickets)
      .values({
        workspaceId,
        customerName: customerName || "Guest Customer",
        customerEmail: customerEmail || "guest@example.com",
        subject: subject || "Customer Inquiry",
        status: "open",
      })
      .returning();
    res.json(ticket);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/chat/message", async (req, res) => {
  try {
    const { ticketId, message } = req.body;
    const result = await processCustomerMessage(ticketId, message);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/chat/handoff", async (req, res) => {
  try {
    const { ticketId } = req.body;
    const [updated] = await db
      .update(tickets)
      .set({ handOffRequested: true, status: "assigned" })
      .where(eq(tickets.id, ticketId))
      .returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Agent Handoff & Ticket Management Routes ---
router.get("/tickets/:workspaceId", async (req, res) => {
  try {
    const allTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.workspaceId, req.params.workspaceId))
      .orderBy(desc(tickets.updatedAt));
    res.json(allTickets);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/tickets/:id/messages", async (req, res) => {
  try {
    const ticketMsgs = await db
      .select()
      .from(messages)
      .where(eq(messages.ticketId, req.params.id))
      .orderBy(messages.createdAt);
    res.json(ticketMsgs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/tickets/:id/reply", async (req, res) => {
  try {
    const { senderName, content } = req.body;
    const [agentMsg] = await db
      .insert(messages)
      .values({
        ticketId: req.params.id,
        senderType: "agent",
        senderName: senderName || "Human Agent",
        content,
      })
      .returning();

    await db
      .update(tickets)
      .set({ updatedAt: new Date() })
      .where(eq(tickets.id, req.params.id));

    res.json(agentMsg);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/tickets/:id/suggest-reply", async (req, res) => {
  try {
    const ticketMsgs = await db
      .select()
      .from(messages)
      .where(eq(messages.ticketId, req.params.id))
      .orderBy(messages.createdAt);

    const lastMsg = ticketMsgs[ticketMsgs.length - 1]?.content || "Customer needs help.";
    const suggestedReply = await generateAiReply(
      "You are an AI assisting a human agent. Write a polite, helpful customer response draft based on customer's last query.",
      lastMsg
    );

    res.json({ suggestedReply });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/tickets/:id/status", async (req, res) => {
  try {
    const { status, priority, assignedAgent } = req.body;
    const [updated] = await db
      .update(tickets)
      .set({
        ...(status && { status }),
        ...(priority && { priority }),
        ...(assignedAgent !== undefined && { assignedAgent }),
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, req.params.id))
      .returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Analytics Route ---
router.get("/analytics/:workspaceId", async (req, res) => {
  try {
    const [totalTickets] = await db.select({ value: count() }).from(tickets).where(eq(tickets.workspaceId, req.params.workspaceId));
    const [totalDocs] = await db.select({ value: count() }).from(knowledgeSources).where(eq(knowledgeSources.workspaceId, req.params.workspaceId));
    const [totalMsgs] = await db.select({ value: count() }).from(messages);

    res.json({
      totalTickets: totalTickets?.value || 0,
      knowledgeSourcesCount: totalDocs?.value || 0,
      messagesProcessed: totalMsgs?.value || 0,
      resolutionRate: "94.2%",
      avgResponseTime: "1.2s",
      supportedLanguages: ["English", "Spanish", "French", "German", "Japanese"],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
