# AMASS — Autonomous Multi-Agent Security System

An agentic AI-powered DevSecOps platform that autonomously detects vulnerabilities, performs **controlled exploit verification inside isolated runtime sandboxes**, and produces prioritized, evidence-backed reports. Patch generation/validation agents are a later phase.

> **Current Phase:** Static Scanner + Scout (recon) + Planner (prioritize) + Sniper (controlled verification) implemented in-process. Engineer / Critic / patch generation not yet implemented.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Folder Structure](#folder-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development](#development)
- [Docker](#docker)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Environment Variables](#environment-variables)
- [Service Communication](#service-communication)
- [Future Extensibility](#future-extensibility)
- [Recommended Libraries](#recommended-libraries)
- [Security Best Practices](#security-best-practices)
- [Common Mistakes to Avoid](#common-mistakes-to-avoid)

---

## Architecture

```
Frontend (React)  ──►  Backend API (Express)  ──►  Agents Service (FastAPI)
     :5173                    :3001                        :8000
                               │                              │
                    ┌──────────┼──────────────────────────────┤
                    ▼          ▼                              ▼
               PostgreSQL    Redis                         Qdrant
                 :5432       :6379                          :6333
```

See [docs/architecture.md](docs/architecture.md) for detailed diagrams and clean architecture layers.

### Agent Pipeline

```text
Repository Analyzer → Static Scanner → Scout (Detect) → Planner (Prioritize) → Sniper (Confirm)
```

- **Scout** — reconnaissance: discovers the attack surface of a running app (endpoints, technologies, ports, forms, auth pages, API/docs, GraphQL/WebSocket) using read-only probes.
- **Planner** — ranks the discovered surface into an explained attack plan (what to test first); heuristics only, never executes anything.
- **Sniper** — **controlled exploit verification inside an isolated runtime sandbox**: validates Planner-supplied candidate vulnerabilities (SQL Injection today) by running bounded, sandbox-gated tools (sqlmap) against the sandboxed app instance. It is **not a general-purpose penetration-testing engine** — it never generates new attacks, bypasses authentication, or touches anything outside the sandbox. Engineer / Critic / patch generation remain future work.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, TailwindCSS, Vite |
| Backend API | Node.js, Express, TypeScript |
| AI Services | Python, FastAPI |
| Database | PostgreSQL, Prisma ORM |
| Cache | Redis |
| Vector DB | Qdrant |
| Containerization | Docker, Docker Compose |
| Agent Framework | LangGraph (future) |
| LLM Framework | LangChain (future) |

---

## Folder Structure

```
amass/
├── frontend/                 # React + Vite + TailwindCSS
│   ├── src/
│   │   ├── App.tsx           # Dashboard with service health
│   │   ├── main.tsx
│   │   └── index.css
│   ├── Dockerfile
│   └── package.json
│
├── backend/                  # Express TypeScript API
│   ├── src/
│   │   ├── config/           # Environment, DB, Redis, logger
│   │   ├── controllers/      # HTTP handlers
│   │   ├── services/         # Business logic
│   │   ├── repositories/     # Data access (Prisma)
│   │   ├── routes/           # Route definitions
│   │   ├── middlewares/      # Error handling, logging
│   │   ├── types/            # TypeScript interfaces
│   │   ├── utils/            # Response helpers, errors
│   │   ├── app.ts            # Express app factory
│   │   └── index.ts          # Entry point
│   ├── prisma/
│   │   └── schema.prisma     # Database schema
│   └── Dockerfile
│
├── agents/                   # FastAPI Python AI service
│   ├── app/
│   │   ├── config/           # Settings, logging
│   │   ├── api/routes/       # HTTP endpoints
│   │   ├── services/         # Health, Qdrant services
│   │   ├── agents/           # LangGraph agents (future)
│   │   ├── core/             # Response format, exceptions
│   │   ├── middleware/       # Error handlers
│   │   └── main.py           # App factory
│   ├── requirements.txt
│   └── Dockerfile
│
├── shared/                   # Shared TypeScript types
│   └── src/types/
│
├── database/                 # Schema documentation
│   └── README.md
│
├── docker/
│   └── docker-compose.yml    # Full stack orchestration
│
├── docs/
│   └── architecture.md       # Detailed architecture docs
│
├── scripts/
│   ├── setup-dev.sh          # One-command dev setup
│   ├── init-qdrant.sh        # Qdrant collection init
│   ├── db-migrate.sh         # Prisma migrations
│   └── wait-for-it.sh        # Service readiness check
│
├── .env.example              # Environment template
├── turbo.json                # Turborepo config
└── package.json              # Monorepo root
```

---

## Prerequisites

- **Node.js** >= 20
- **npm** >= 10
- **Python** >= 3.12
- **Docker** & **Docker Compose**
- **Git**

---

## Quick Start

### Option 1: Automated Setup

```bash
git clone <repo-url> amass && cd amass
chmod +x scripts/*.sh
./scripts/setup-dev.sh
npm run dev
```

### Option 2: Docker (Full Stack)

```bash
cp .env.example .env
docker compose up -d --build          # or: npm run docker:up / docker:build
```

The backend applies Prisma migrations on startup. Services:

| Service | URL |
|---------|-----|
| Backend API | http://localhost:3001 (health: `/health`) |
| PostgreSQL | localhost:5432 (`amass`/`amass`/`amass`) |
| Redis | localhost:6379 |
| Qdrant | http://localhost:6333 |

Stop / reset the full stack:

```bash
docker compose down              # keep DB data
docker compose down -v           # wipe the DB + Qdrant volumes
```

> Frontend and the Agents service are not wired into this compose stack yet.

---

## Development

### Run All Services (Turbo)

```bash
npm run dev
```

### Run Individual Services

```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev

# Agents (Python)
cd agents
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:create_app --factory --reload --port 8000
```

### Database Commands

```bash
npm run db:generate    # Generate Prisma client
npm run db:push        # Push schema to database
npm run db:migrate     # Run migrations
npm run db:studio      # Open Prisma Studio GUI
```

### Infrastructure Only

```bash
docker compose -f docker/docker-compose.yml up -d postgres redis qdrant
```

---

## Docker

### Services

| Container | Image | Port | Purpose |
|-----------|-------|------|---------|
| amass-postgres | postgres:16-alpine | 5432 | Primary database |
| amass-redis | redis:7-alpine | 6379 | Cache, agent memory, queue |
| amass-qdrant | qdrant/qdrant:v1.12.5 | 6333 | Vector embeddings |
| amass-backend | Custom (Node 20) | 3001 | Express API |
| amass-agents | Custom (Python 3.12) | 8000 | FastAPI agents |
| amass-frontend | Custom (Node 20) | 5173 | React dev server |

All containers communicate over the `amass-network` bridge network. Data volumes persist PostgreSQL, Redis, and Qdrant data.

### Commands

```bash
npm run docker:up       # Start all services
npm run docker:down     # Stop all services
npm run docker:logs     # Tail logs
npm run docker:build    # Rebuild images
```

---

## API Reference

### Standard Response Format

All API endpoints return a consistent response envelope:

```json
{
  "success": true,
  "data": { },
  "error": null,
  "timestamp": "2026-08-03T17:00:00.000Z"
}
```

Error responses:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  },
  "timestamp": "2026-08-03T17:00:00.000Z"
}
```

### Backend API (Express) — Port 3001

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check with dependency status |
| GET | `/version` | Version and environment |

### Agents Service (FastAPI) — Port 8000

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check with dependency status |
| GET | `/version` | Version and environment |
| GET | `/docs` | OpenAPI documentation (dev only) |

---

## Database Schema

Seven core tables with full relationship mapping:

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| **Scan** | Security scan session | → Vulnerabilities, AgentExecutions |
| **Repository** | Source code repo | ↔ Scans (M:N) |
| **Vulnerability** | Detected security issue | → Exploits, Patches, CVERecord |
| **Exploit** | Exploitability confirmation | ← Vulnerability |
| **Patch** | AI-generated fix | ← Vulnerability |
| **AgentExecution** | Agent run record | ← Scan |
| **CVERecord** | CVE reference data | → Vulnerabilities |

See [database/README.md](database/README.md) for the full ERD and column details.

### Prisma Relationships

```
Scan ──1:N──► Vulnerability ──1:N──► Exploit
  │                │
  │                ├──1:N──► Patch
  │                │
  │                └──N:1──► CVERecord
  │
  ├──1:N──► AgentExecution
  │
  └──M:N──► Repository (via ScanRepository)
```

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | — | Redis connection string |
| `QDRANT_URL` | — | Qdrant HTTP endpoint |
| `BACKEND_PORT` | 3001 | Backend API port |
| `AGENTS_PORT` | 8000 | Agents service port |
| `FRONTEND_PORT` | 5173 | Frontend dev server port |
| `LOG_LEVEL` | info | Logging verbosity |
| `OPENAI_API_KEY` | — | LLM API key (future) |
| `JWT_SECRET` | — | Auth secret (future) |

See [.env.example](.env.example) for the complete list.

---

## Service Communication

```
Frontend ──REST──► Backend ──REST──► Agents
                      │                 │
                      ├──Prisma──► PostgreSQL
                      ├──ioredis─► Redis
                      │                 ├──Qdrant Client──► Qdrant
                      │                 └──Redis──────────► Redis
                      └──HTTP────► Qdrant (health)
```

- **Frontend → Backend**: Scan management, vulnerability reports
- **Frontend → Agents**: Agent status monitoring
- **Backend → Agents**: Trigger agent workflows (future)
- **Agents → Qdrant**: Vector similarity search for RAG
- **Agents → Redis**: Agent conversation memory, job queue
- **Backend → PostgreSQL**: All persistent data via Prisma

---

## Future Extensibility

### Redis Use Cases

| Use Case | Key Pattern | TTL |
|----------|-------------|-----|
| Agent Memory | `amass:agent:{type}:{scanId}:memory` | Session |
| API Cache | `amass:cache:{resource}:{id}` | 3600s |
| Job Queue | `amass:queue:{name}` | Persistent |

### Qdrant Collections

| Collection | Content | Purpose |
|------------|---------|---------|
| `amass_embeddings` | CVE descriptions | Match vulnerabilities to known CVEs |
| (future) | Security docs | RAG context for patch generation |
| (future) | Fix history | Learn from past successful patches |
| (future) | Code snippets | Similar code pattern retrieval |

### Adding New Agents

1. Create module in `agents/app/agents/{name}/`
2. Define LangGraph state machine
3. Add API route and register in `main.py`
4. Add `AgentType` to Prisma schema
5. No infrastructure changes required

---

## Recommended Libraries

### Current (Installed)

| Library | Service | Purpose |
|---------|---------|---------|
| pino | Backend | Structured JSON logging |
| structlog | Agents | Structured JSON logging |
| zod | Backend | Environment validation |
| pydantic-settings | Agents | Environment validation |
| helmet | Backend | HTTP security headers |
| ioredis | Backend | Redis client |
| qdrant-client | Agents | Vector DB client |

### Future Phases

| Library | Purpose |
|---------|---------|
| langgraph | Multi-agent orchestration |
| langchain | LLM tool chains |
| langchain-openai | OpenAI integration |
| bullmq | Redis job queue |
| jsonwebtoken | JWT authentication |
| @octokit/rest | GitHub API integration |
| pytest / vitest | Testing frameworks |

---

## Security Best Practices

1. **Never commit `.env`** — use `.env.example` as template
2. **Change default passwords** in production (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`)
3. **Use helmet** — already configured for security headers
4. **Validate all input** — Zod (backend) and Pydantic (agents) for env; extend to request validation
5. **Principle of least privilege** — Docker containers run as non-root users
6. **CORS restriction** — configure `CORS_ORIGIN` for production
7. **Secrets management** — use Kubernetes Secrets or Vault in production
8. **Rate limiting** — add express-rate-limit before production
9. **Audit logging** — AgentExecution table tracks all agent activity
10. **Network isolation** — Docker internal network; only expose necessary ports

---

## Common Mistakes to Avoid

1. **Don't put business logic in controllers** — keep them thin, delegate to services
2. **Don't hardcode configuration** — use environment variables via config modules
3. **Don't skip health checks** — Docker depends_on with condition: service_healthy
4. **Don't connect agents directly to frontend for mutations** — route through backend API
5. **Don't store agent state only in memory** — use Redis for persistence across restarts
6. **Don't embed vectors in PostgreSQL** — use Qdrant for similarity search
7. **Don't create circular imports** — follow the dependency direction (routes → controllers → services → repositories)
8. **Don't run Prisma migrations inside Docker build** — run at container startup or via init script
9. **Don't expose Qdrant/Redis/PostgreSQL ports in production** — internal network only
10. **Don't implement agents before infrastructure is stable** — this phase establishes the foundation

---

## Development Workflow

```
1. Create feature branch
2. Make changes in relevant workspace (frontend/backend/agents)
3. Run linting: npm run lint
4. Test locally: npm run dev
5. Test with Docker: npm run docker:up
6. Database changes: edit schema.prisma → npm run db:migrate
7. Commit and push
8. CI/CD (future): build → test → deploy
```

---

## License

Final Year Engineering Major Project — All rights reserved.
