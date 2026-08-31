# AI Customer Support Platform

An intelligent, multi-tenant AI Customer Support Platform allowing businesses to upload documentation, FAQs, PDFs, and website URLs to create a 24/7 automated support assistant with pgvector search, human agent handoff, and live chat.

## Tech Stack
- **Frontend**: Next.js (App Router), Tailwind CSS, Lucide Icons, Axios, Socket.IO Client
- **Backend**: Node.js, Express.js, TypeScript, Socket.IO
- **Database & ORM**: PostgreSQL, `pgvector`, Drizzle ORM
- **AI & Vectorization**: OpenAI API, Nvidia API, LangChain (Recursive Character Splitter & Vector Store)
- **Infrastructure**: Docker, Redis

---

## Core Features
1. **24/7 AI Chat Support**: Instant RAG-powered answers using `pgvector` similarity search on ingested business data.
2. **Knowledge Base Management**:
   - **Website Crawling**: Automated web scraping via Puppeteer to extract documentation text.
   - **PDF Document Chat**: PDF parsing & chunk embedding ingestion.
   - **FAQ Ingestion**: Quick manual FAQ entry and vector indexing.
3. **Human Agent Handoff**: Escalates complex queries to human support agent queue seamlessly.
4. **Ticket Management & Analytics**: Complete agent inbox with ticket resolution states and sentiment analysis.
5. **AI Suggested Replies**: Auto-suggested responses for human agents to accelerate ticket resolution times.
6. **Multi-Language Support**: Automatic language detection and translation capabilities for global support.
7. **Live Chat Simulator**: Embedded customer widget demo for testing real-time interaction.

---

## Quickstart & Installation

### 1. Start Infrastructure via Docker
```bash
docker-compose up -d
```
*Starts PostgreSQL (pgvector/pgvector:pg16) on port 5432 and Redis on port 6379.*

### 2. Setup Backend Server
```bash
cd backend
npm install --legacy-peer-deps
cp .env.example .env # Set your OPENAI_API_KEY / NVIDIA_API_KEY
npm run db:push
npm run dev
```
*Runs backend API & Socket.IO server at http://localhost:5000*

### 3. Setup Frontend App
```bash
cd ../frontend
npm install
npm run dev
```
*Runs Next.js Dashboard & Simulator at http://localhost:3000*
