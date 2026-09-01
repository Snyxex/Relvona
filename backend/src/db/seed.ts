import { db } from "./index.js";
import { organizations, users, organizationMembers, assistants, knowledgeBases, knowledgeSources, documentChunks, customers, conversations, tickets } from "./schema.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function seed() {
  console.log("🌱 Seeding Multi-Tenant AI Customer Support Platform...");

  // 1. Create Demo Organization
  const orgSlug = "acme-corp-" + crypto.randomBytes(2).toString("hex");
  const orgApiKey = "sk_live_" + crypto.randomBytes(24).toString("hex");

  const [org] = await db
    .insert(organizations)
    .values({
      name: "Acme Corporation",
      slug: orgSlug,
      apiKey: orgApiKey,
      plan: "enterprise",
    })
    .returning();

  console.log(`✅ Created Demo Organization: ${org.name} (API Key: ${org.apiKey})`);

  // 2. Create Admin User
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const [adminUser] = await db
    .insert(users)
    .values({
      name: "Alex Support Manager",
      email: "alex@acme.com",
      passwordHash,
      systemRole: "user",
    })
    .returning();

  await db.insert(organizationMembers).values({
    organizationId: org.id,
    userId: adminUser.id,
    role: "owner",
  });

  console.log(`✅ Created Admin User: ${adminUser.email} (Password: Password123!)`);

  // 3. Create AI Assistant
  const [assistant] = await db
    .insert(assistants)
    .values({
      organizationId: org.id,
      name: "Acme Helper AI",
      systemPrompt: "You are Acme Corp's official AI Customer Support Assistant. Provide accurate, helpful answers based strictly on Acme's knowledge base. If unsure, politely escalate to a human agent.",
      modelProvider: "openai",
      modelName: "gpt-4o-mini",
      temperature: 0.2,
      primaryColor: "#2563EB",
      welcomeMessage: "Welcome to Acme Corp! How can I assist you with your account or orders today?",
    })
    .returning();

  console.log(`✅ Created AI Assistant: ${assistant.name}`);

  // 4. Create Knowledge Base & Sources
  const [kb] = await db
    .insert(knowledgeBases)
    .values({
      organizationId: org.id,
      name: "Product & Billing FAQs",
      description: "Official Acme Corp product documentation, return policies, and billing guides",
    })
    .returning();

  const sampleFaqContent = `
# Acme Corp Return & Refund Policy
Customers can request a full refund within 30 days of purchase for any unused hardware or software product.
To initiate a return, navigate to your Account Settings -> Orders -> Request Return, or email support@acme.com.

# Acme Corp Shipping Options
We offer Standard Shipping (3-5 business days) and Express Next-Day Shipping. Standard shipping is free on orders over $50.

# API Rate Limits
Enterprise plan accounts receive up to 10,000 API calls per minute. Pro plan accounts receive 1,000 calls per minute.
`;

  const [source] = await db
    .insert(knowledgeSources)
    .values({
      organizationId: org.id,
      knowledgeBaseId: kb.id,
      title: "Return Policy & General Info",
      type: "faq",
      status: "completed",
      chunkCount: 3,
    })
    .returning();

  // Create sample vector chunks
  const dummyVector = new Array(1536).fill(0.01);

  await db.insert(documentChunks).values([
    {
      organizationId: org.id,
      knowledgeBaseId: kb.id,
      sourceId: source.id,
      chunkIndex: 0,
      content: "Acme Corp Return & Refund Policy: Customers can request a full refund within 30 days of purchase for any unused hardware or software product.",
      metadata: { title: "Return Policy" },
      embedding: dummyVector,
    },
    {
      organizationId: org.id,
      knowledgeBaseId: kb.id,
      sourceId: source.id,
      chunkIndex: 1,
      content: "Acme Corp Shipping Options: Standard Shipping (3-5 business days) and Express Next-Day Shipping. Standard shipping is free on orders over $50.",
      metadata: { title: "Shipping" },
      embedding: dummyVector,
    },
  ]);

  console.log(`✅ Created Knowledge Base & Sample Chunks`);

  // 5. Create Customer, Conversation & Support Ticket
  const [customer] = await db
    .insert(customers)
    .values({
      organizationId: org.id,
      name: "Sarah Customer",
      email: "sarah.smith@example.com",
    })
    .returning();

  const [conv] = await db
    .insert(conversations)
    .values({
      organizationId: org.id,
      assistantId: assistant.id,
      customerId: customer.id,
      state: "AI_ACTIVE",
      detectedLanguage: "en",
    })
    .returning();

  await db.insert(tickets).values({
    ticketNumber: 1001,
    organizationId: org.id,
    conversationId: conv.id,
    customerId: customer.id,
    subject: "Question about enterprise shipping",
    description: "Customer inquired about next-day shipping rates for bulk hardware orders.",
    status: "open",
    priority: "high",
  });

  console.log(`✅ Created Sample Customer, Conversation & Ticket #1001`);
  console.log("🚀 Database Seed Completed Successfully!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed script failed:", err);
  process.exit(1);
});
