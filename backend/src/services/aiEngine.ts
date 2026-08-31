import { ChatOpenAI } from "@langchain/openai";
import { generateEmbedding } from "./ragService.js";
import { db } from "../db/index.js";
import { documentEmbeddings, workspaces, tickets, messages } from "../db/schema.js";
import { sql, eq } from "drizzle-orm";

export async function processCustomerMessage(ticketId: string, customerQuery: string) {
  // 1. Fetch ticket and workspace settings
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!ticket) throw new Error("Ticket not found");

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, ticket.workspaceId));
  const systemPrompt = workspace?.systemPrompt || "You are a helpful customer support AI assistant.";

  // Save customer message
  await db.insert(messages).values({
    ticketId,
    senderType: "customer",
    senderName: ticket.customerName || "Customer",
    content: customerQuery,
  });

  // If handoff was requested, AI does not respond directly, but generates AI suggested response for the human agent
  if (ticket.handOffRequested || ticket.status === "assigned") {
    const suggestedReply = await generateAiReply(systemPrompt, customerQuery, []);
    // Save placeholder or suggested reply to latest customer message
    return {
      handOff: true,
      suggestedReply,
      message: "Connected to human agent queue. An agent will respond shortly.",
    };
  }

  // 2. Perform PgVector Similarity Search on Knowledge Base
  const queryVector = await generateEmbedding(customerQuery);
  const vectorStr = `[${queryVector.join(",")}]`;

  // Fetch top 3 relevant chunks using cosine distance
  const relevantDocs = await db.execute(sql`
    SELECT content, metadata, 1 - (embedding <=> ${vectorStr}::vector) as similarity
    FROM document_embeddings
    WHERE workspace_id = ${ticket.workspaceId}
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT 3;
  `);

  const contextText = (relevantDocs.rows as any[])
    .map((row) => row.content)
    .join("\n\n---\n\n");

  // 3. Generate AI Answer using OpenAI / Nvidia LLM via Langchain
  const prompt = `
System Prompt: ${systemPrompt}

Knowledge Base Context:
${contextText || "No context found in knowledge base."}

User Query: ${customerQuery}

Instructions:
- Provide an accurate, friendly, and helpful response based on the Knowledge Base Context.
- If the knowledge base does not contain the information and you cannot answer, inform the customer politely and suggest connecting with a human agent.
- Keep the language matched with user query.
`;

  const aiReply = await generateAiReply(systemPrompt, prompt, []);

  // 4. Save AI Response
  const [aiMessage] = await db
    .insert(messages)
    .values({
      ticketId,
      senderType: "ai",
      senderName: "AI Support Assistant",
      content: aiReply,
    })
    .returning();

  // 5. Update Ticket sentiment & summary asynchronously
  analyzeConversation(ticketId, customerQuery, aiReply).catch(console.error);

  return {
    handOff: false,
    aiReply: aiMessage.content,
    relevantDocsCount: relevantDocs.rows.length,
  };
}

export async function generateAiReply(systemPrompt: string, promptText: string, chatHistory: any[] = []): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey !== "your_openai_api_key_here") {
    const llm = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: "gpt-4o-mini",
      temperature: 0.3,
    });
    const res = await llm.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: promptText },
    ]);
    return typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  } else {
    // Simulated AI response for testing when API key is unconfigured
    return `[AI Assistant Response]: Thank you for reaching out! Based on our documentation: ${promptText.slice(0, 100)}... Is there anything else I can assist you with?`;
  }
}

async function analyzeConversation(ticketId: string, userQuery: string, aiReply: string) {
  // Simple sentiment heuristic for prompt demonstration
  const lower = userQuery.toLowerCase();
  let sentiment = "neutral";
  if (lower.includes("angry") || lower.includes("terrible") || lower.includes("broken") || lower.includes("bad")) {
    sentiment = "negative";
  } else if (lower.includes("thanks") || lower.includes("great") || lower.includes("love") || lower.includes("awesome")) {
    sentiment = "positive";
  }

  await db
    .update(tickets)
    .set({
      sentiment,
      summary: `User asked: "${userQuery.slice(0, 50)}..."`,
      updatedAt: new Date(),
    })
    .where(eq(tickets.id, ticketId));
}
