# Technologie-Stack

Diese Übersicht beschreibt die aktuell im Repository verwendeten Technologien und Bibliotheken von AI Customer Support.

## Architektur

```text
Next.js-Dashboard / eingebettetes Chat-Widget
                 │ HTTP, SSE, Socket.IO
                 ▼
        Express API + BullMQ Worker
           │          │
           ▼          ▼
PostgreSQL + pgvector   Redis
           │
           ▼
RAG, Embeddings und LLM-Anbieter
```

## Frontend und Widget

| Technologie | Verwendung |
| --- | --- |
| Next.js 16 | Dashboard als React-Anwendung, Produktions-Build mit Standalone-Output |
| React 19 | Komponenten, Zustand und Benutzeroberfläche |
| TypeScript | Typsichere Frontend- und Backend-Entwicklung |
| Tailwind CSS 4 | Styling des Dashboards |
| Axios | API-Aufrufe des Dashboards |
| Socket.IO Client | Echtzeitfunktionen zwischen Dashboard und API |
| React Hook Form + Zod | Formulare und Validierung |
| Lucide React | Icons |
| Vanilla JavaScript | Eigenständiges, einbettbares Chat-Widget (`backend/public/widget.js`) |
| Server-Sent Events (SSE) | Streaming von KI-Antworten im Chat-Widget |

## Backend und API

| Technologie | Verwendung |
| --- | --- |
| Node.js 22 | Laufzeit für API, Worker und Build-Prozesse |
| Express 4 | REST-API unter `/api/v1` und öffentliche Widget-Endpunkte |
| Socket.IO | Echtzeit-Kommunikation und Agent-Handoff |
| `@socket.io/redis-adapter` | Socket.IO-Skalierung über Redis Pub/Sub |
| CORS | Kontrollierter Zugriff des Dashboards und Widgets |
| dotenv | Laden lokaler Umgebungsvariablen |
| Better Auth + Drizzle Adapter | Serverseitige, Cookie-basierte Anmeldung für Dashboard-Nutzer |
| bcryptjs | Sichere Passwort-Hashes |
| multer | Datei-Uploads |
| pdf-parse | Text-Extraktion aus PDF-Dateien |
| Puppeteer | Extraktion von Inhalten aus Websites |

## KI, RAG und Verarbeitung

| Technologie | Verwendung |
| --- | --- |
| LangChain | Dokumentaufteilung und RAG-nahe Hilfsfunktionen |
| Eigener AI Gateway | Einheitliche Anbindung für OpenAI-, Anthropic-, Google-, NVIDIA- und lokale OpenAI-kompatible Modelle |
| pgvector | Speicherung und Ähnlichkeitssuche von Embeddings in PostgreSQL |
| BullMQ | Asynchrone Jobs für Ingestion, Crawling und Embeddings |
| Redis | BullMQ-Queue, Rate Limits, Token-Quoten und Socket.IO Pub/Sub |
| OpenTelemetry | Tracing der API- und Worker-Prozesse über OTLP/HTTP |

## Datenhaltung

| Technologie | Verwendung |
| --- | --- |
| PostgreSQL 16 | Primäre relationale Datenbank für Mandanten, Nutzer, Gespräche, Tickets und Wissen |
| `pgvector/pgvector:pg16` | PostgreSQL-Image mit Vektor-Erweiterung |
| Drizzle ORM | Typsichere Datenbankzugriffe und Schema-Definition |
| Drizzle Kit | Schema-Synchronisierung und Migrationen |
| Row-Level Security (RLS) | Datenisolation zwischen Organisationen direkt in PostgreSQL |

## Betrieb und Entwicklung

| Technologie | Verwendung |
| --- | --- |
| Docker / Docker Compose | Lokaler Stack mit Dashboard, API, Worker, PostgreSQL und Redis |
| Multi-Stage Docker Builds | Kleine Produktionsimages für Frontend und Backend |
| Infisical CLI | Geheimnisse zur Laufzeit in Produktionsumgebungen |
| npm | Paketverwaltung und Skripte |
| ESLint | Code-Qualitätsprüfung im Frontend |
| GitHub Actions | CI mit Build, Sicherheitschecks, Audit und CodeQL |

## Lokale Ports

| Dienst | Adresse |
| --- | --- |
| Dashboard | `http://localhost:3000` |
| API | `http://localhost:8080` |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |

## Relevante Konfigurationsdateien

- `frontend/package.json` – Frontend-Abhängigkeiten und Skripte
- `backend/package.json` – API-, KI- und Worker-Abhängigkeiten
- `docker-compose.local.yml` – lokaler Docker-Stack
- `docker-compose.prod.yml` – Produktions-Stack
- `backend/src/db/schema.ts` – Datenbankschema
