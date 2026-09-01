# Multi-Tenant AI Customer Support Platform

A production-ready, multi-tenant AI Customer Support Platform enabling businesses to create intelligent 24/7 support assistants trained on their own documentation, FAQs, PDF files, and website URLs.

Features RAG (Retrieval-Augmented Generation), PostgreSQL with `pgvector` semantic similarity search, Socket.IO real-time agent handoff, automated support tickets, AI suggested replies, analytics, and an embeddable customer widget.

---

## 🛠 Tech Stack

- **Frontend**: Next.js 16 (App Router), TypeScript, Tailwind CSS, Lucide Icons, Axios, Socket.IO Client
- **Backend**: Node.js, Express.js, TypeScript, REST APIs, Socket.IO, Multer, `pdf-parse`, Puppeteer
- **Database & ORM**: PostgreSQL, `pgvector`, Drizzle ORM
- **AI & RAG**: OpenAI API (`gpt-4o-mini`, `text-embedding-3-small`), NVIDIA AI APIs, LangChain, Recursive Character Text Splitter
- **Infrastructure**: Docker, Docker Compose, Redis for background job queues and caching

---

## 🚀 Key Platform Features

1. **Multi-Tenant Architecture**: Strict data isolation per organization (`organizations`, `users`, `assistants`, `knowledge_bases`, `documents`, `websites`, `conversations`, `tickets`, `analytics`).
2. **Authentication & RBAC**: JWT & API Key authentication with granular roles (`owner`, `admin`, `agent`, `viewer`).
3. **RAG AI Chat Assistant**: Instant context-aware answers using `pgvector` similarity search. Supports configurable system prompts, temperature sliders, model selection (OpenAI & NVIDIA), and fallback responses.
4. **PDF & Document Processing**: Upload PDFs or plaintext files; automatic text extraction, chunking, and pgvector embedding.
5. **Website Crawler**: Crawl target URLs with SSRF protection against private IP ranges (`127.0.0.1`, `10.x.x.x`, `192.168.x.x`), HTML text cleaning, and change tracking.
6. **Real-Time Human Agent Handoff**: Seamless state transitions (`AI_ACTIVE` → `WAITING_FOR_AGENT` → `AGENT_ACTIVE` → `RESOLVED`) using Socket.IO real-time rooms.
7. **AI Suggested Replies**: AI generates suggested responses for human support agents without auto-sending.
8. **Ticket Management**: Automated or manual ticket creation with priority levels, agent assignment, and internal comments.
9. **Analytics & Insights**: Dashboard metrics for conversation volume, resolution rates, handoffs, sentiment breakdown, language stats, and unanswered questions.
10. **Embeddable Chat Widget (`widget.js`)**: Lightweight widget script businesses can embed via `<script src=".../public/widget.js" data-assistant-id="..."></script>`.

---

## 📦 Project Structure

```
AI_Customer_Sup/
├── docker-compose.yml       # PostgreSQL (pgvector) & Redis containers
├── backend/
│   ├── src/
│   │   ├── db/              # Drizzle ORM schema & seed scripts
│   │   ├── middleware/      # JWT auth, tenant context, RBAC
│   │   ├── routes/          # REST API endpoints
│   │   ├── services/        # RAG engine, Ingestion, Conversations, Tickets, Analytics, Redis Queue
│   │   └── index.ts         # Express server & Socket.IO real-time handler
│   └── public/
│       └── widget.js        # Public embeddable chat widget
└── frontend/
    └── src/
        ├── app/             # Next.js 16 App Router dashboard pages
        └── lib/             # API client with multi-tenant headers
```

---

## 🏁 Quickstart Guide

### 1. Start Infrastructure (PostgreSQL + pgvector & Redis)
```bash
docker-compose up -d
```

### 2. Start Backend API Server
```bash
cd backend
npm install
npm run db:push
npm run db:seed  # Seeds demo organization (Acme Corp) & admin user
npm run dev
```
*Backend runs on `http://localhost:5000`.*

### 3. Start Next.js Dashboard
```bash
cd frontend
npm install
npm run dev
```
*Dashboard runs on `http://localhost:3000`.*

---

## 🔑 Default Seed Credentials (after `npm run db:seed`)

- **Organization**: Acme Corporation
- **Admin Email**: `alex@acme.com`
- **Admin Password**: `Password123!`
- **API Key**: Printed in terminal output

---

## 🔌 Embeddable Chat Widget Snippet

Businesses can embed the chat assistant into any website using:

```html
<script 
  src="http://localhost:5000/public/widget.js" 
  data-assistant-id="YOUR_ASSISTANT_ID">
</script>
```

---

## 📄 License
MIT License
