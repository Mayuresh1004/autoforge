# AMASS — Autonomous Multi-Agent Security System

An agentic AI-powered DevSecOps platform that autonomously detects vulnerabilities, performs **controlled exploit verification inside isolated runtime sandboxes**, and produces prioritized, evidence-backed reports. Patch generation/validation agents are a later phase.

> **Current Phase:** Full pipeline to remediation: Repository Analyzer → Static Scanner → Scout → Planner → Sniper → Engineer (draft patch generation, SQL Injection only) → Critic (patch validation in a fresh disposable sandbox, SQL Injection only). Auto-apply remains future work.
>
> **Hardening:** the remediation stack runs over ONE shared `SandboxManager` built by the
> application composition root (`src/application/application-root.ts`); HTTP errors are mapped
> centrally (5xx bodies masked), Engineer and Critic resolve the same canonical CONFIRMED
> finding, Critic baseline/retest runs are non-persistent, LLM defaults are provider-aware
> (no paid default, lazy boot), and asked-for host port publishing fails fast (422) while
> `SANDBOX_ALLOW_HOST_EXPOSE` stays `false`. See `PROGRESS.md` Milestone 21.
>
> **Observability (Phase 9):** one canonical `AmassEvent` model + an in-memory, bounded,
> transport-agnostic `EventBus` streams the whole pipeline (Analyzer → Scanner → Sandbox →
> Scout → Planner → Sniper → Engineer → Critic) over `GET /api/scans/:scanId/events` (SSE) —
> per-scan monotonic sequence ordering, heartbeat + `Last-Event-ID` reconnect, secret
> redaction, bounded per-connection buffers, scan-scoped subscriptions. Events are
> ephemeral by design (durable rows stay `Scan`/`AgentExecution`/critic runs); configurable
> via `EVENTS_*`. See `PROGRESS.md` Milestone 22.

```text
Repository Analyzer → Static Scanner → Scout (Detect) → Planner (Prioritize) → Sniper (Confirm) → Engineer (Remediate) → Critic (Validate)
```

- **Scout** — reconnaissance: discovers the attack surface of a running app (endpoints, technologies, ports, forms, auth pages, API/docs, GraphQL/WebSocket) using read-only probes.
- **Planner** — ranks the discovered surface into an explained attack plan (what to test first); heuristics only, never executes anything.
- **Sniper** — **controlled exploit verification inside an isolated runtime sandbox**: validates Planner-supplied candidate vulnerabilities (SQL Injection today) by running bounded, sandbox-gated tools (sqlmap) against the sandboxed app instance. It is **not a general-purpose penetration-testing engine** — it never generates new attacks, bypasses authentication, or touches anything outside the sandbox.
- **Engineer** — **draft remediation for confirmed SQL Injection findings only**: reads bounded source context through the runtime sandbox, consults RAG advisory knowledge, and produces a `Patch` row (`status=GENERATED` after a deterministic security-review gate, or `REJECTED`). It is advisory-only: patches are **never applied** in this phase, and the LLM response is validated, gated and persisted without ever being executed.
- **Critic** — **validates Engineer patches (SQL Injection only) inside a fresh disposable sandbox**: the original repository is never modified; a patched app must start, build, pass its regression tests and neutralize the confirmed exploit (re-verification `NOT_CONFIRMED` ⇒ FIXED) before the patch is `APPROVED` (deterministic security gate first; the optional advisory LLM never overrides). Rejections produce structured feedback for a bounded Engineer retry loop (`CRITIC_MAX_ENGINEER_RETRIES=2`).

### Runtime Sandbox Lifecycle (Phase 6)

A first-class runtime-sandbox capability that turns a repository into a running,
isolated app instance for the pipeline, extending the **Sandbox Manager** (the only
Docker owner — agents never touch Docker directly):

```text
Repository → ephemeral workspace → deterministic image build (Mode 1 repo Dockerfile /
Mode 2 python+node templates) → hardened container on an internal-only network →
TCP+HTTP health-gated READY → agents consume a read-only RuntimeSandbox context →
destroy/expire with full resource reclamation
```

- `POST /api/runtime-sandboxes` — provision (201 READY, 429 capacity, 422 structured failure)
- `GET  /api/runtime-sandboxes/:id?scanId=` — read (optional ownership scope → 403)
- `POST /api/runtime-sandboxes/:id/health` — re-verify liveness
- `DELETE /api/runtime-sandboxes/:id` — idempotent destroy
- Security: internal-only egress by default, host exposure only on `127.0.0.1` + dynamic
  port, **no host mounts**, **no host env passthrough** (explicit allowlist), bounded
  CPU/memory/PIDs/timeouts/concurrency (structured 429 capacity errors, never silent
  queues, always bounded), failure → FAILED + logs + full cleanup.

### Knowledge Ingestion + RAG (Phase 7A)

Free-first security-knowledge foundation: an **EmbeddingProvider** independent from the
LLM axis (EMBEDDING_PROVIDER=gemini, EMBEDDING_MODEL=text-embedding-004, 768 dims, no
SDK — one fetch-based OpenAI-compatible substrate), a single Qdrant knowledge store
(collection `amass_security_knowledge`; the only TS Qdrant client in the backend is a
fetch-based `QdrantClient` — the Python service stays untouched), official **NVD v2.0 CVE
ingestion** persisted into the existing `CVERecord` model, and **RAG retrieval** with
whitelisted metadata filters.

```text
NVD API -> validate -> normalize -> upsert CVERecord -> KnowledgeDocument -> embed -> Qdrant
-> RAG search (query -> embed -> ranked, deduplicated hits, content resolved from CVERecord)
```

- Idempotent + incremental: CVERecord upsert by unique cveId; stable point ids
  (sha256-derived uuid) make re-ingestion a no-op; startTime window for incremental
  fetches; NVD paging/retries bounded (KNOWLEDGE_NVD_MAX_PAGES, KNOWLEDGE_NVD_MAX_RETRIES).
- API: `POST /api/knowledge/cve/ingest`, `GET /api/knowledge/cve/:cveId`,
  `POST /api/rag/search` (filters are the whitelisted fields severity/cveId/
  vulnerabilityType/sourceType/language/framework).
- PromptRegistry: versioned, file-backed prompts under `backend/agents/prompts/v1/`
  (engineer/system, patch-generation, rag-context, security-review) — reads files,
  never invokes an LLM.
- AgentScanContext (all-optional fields, no Docker internals) + sanitized AgentExecution
  records reusing the existing Prisma model (secrets redacted before persistence; no
  huge blobs; no secrets stored).
- Security: retrieved knowledge is untrusted context — never executed, never able to
  override system prompts; logs redacted; no new tables/migrations.
- Live smoke tests opt-in: RAG_NVD_E2E=1, RAG_QDRANT_E2E=1, RAG_EMBEDDING_E2E=1.

### Engineer Agent — Draft Remediation (Phase 7B)

A remediation stage that turns **CONFIRMED SQL Injection findings** into reviewed
**draft patches** — with guardrails so the model output stays an advisory artifact:

```text
CONFIRMED SQLi finding → deterministic selection (severity → confidence → exploit depth → stable id)
→ bounded source window (SandboxManager.execute only, no raw Docker) → RAG advisory query
→ v1/engineer prompts (PromptRegistry) → LLMProvider (free-first Gemini default)
→ structural validation (unified diff, in-scope path only) → security-review gate
→ Patch row (status GENERATED | REJECTED) + AgentExecution (COMPLETED | FAILED)
```

- **Only SQL Injection today**: `SUPPORTED_VULNERABILITY_TYPES = ['SQL_INJECTION']` — other
  types and non-CONFIRMED states are rejected with typed errors (422). Selection is
  deterministic: severity → confidence → exploit depth → stable vulnerability id.
- **Bounded, port-only seams**: source reading (size probe first, then a line window)
  goes through a `SourceReader` port implemented over the existing `SandboxManager` (the
  only Docker owner); retrieval goes through the existing `RagService`; prompts through
  the versioned `PromptRegistry`; LLM calls through the `LLMProvider` port; no new tables
  — patches persist into the existing `Patch` model via a `PatchRepository` port.
- **Security gate before persist**: the `engineer.security-review` template powers a
  deterministic checklist (secrets, unsafe commands, out-of-scope paths, malformed
  diffs) — a failed gate yields `REJECTED`, never `GENERATED`. Model output is untrusted:
  bounded (≤ 2000 tokens, `json_object` framing), structurally validated (single-file
  unified diff, path traversal rejected, size/applicability bounds).
- **Never applies anything**: `applyPatch` is off-limits in 7B; artifacts are draft-only.
  Every run records a sanitised `AgentExecution` (secrets redacted, bounded error text).
- API: `POST /api/engineer/run` (optionally pin `vulnerabilityId`),
  `GET /api/engineer/:executionId`.
- Live smoke test opt-in: `ENGINEER_E2E=1` (needs a configured live LLM key).

### Critic Agent — Patch Validation (Phase 8)

The **Critic** turns an Engineer `GENERATED` patch into a validated verdict by running it
in a **fresh disposable runtime sandbox** — the original repository is never touched:

```text
GENERATED patch (CONFIRMED SQLi only) → fresh disposable sandbox
→ baseline: vulnerability reachable + exploit reproduces (Sniper CONFIRMED)
→ unified-diff apply inside the sandbox → startup health → build → regression tests
→ exploit re-verification (NOT_CONFIRMED ⇒ FIXED) → deterministic security gate
→ optional advisory LLM (never overrides) → APPROVED / REJECTED
→ bounded Engineer retry loop (CRITIC_MAX_ENGINEER_RETRIES=2)
```

- **Only** `GENERATED` patches on **CONFIRMED `SQL_INJECTION`** findings are reviewable;
  `APPLIED`/`VALIDATED`/`APPROVED`/`REJECTED` patches and unverified findings fail fast
  with deterministic 404/422 errors. The Critic records a `CriticRun` (`id =
  patchId#attempt`, attempts never overwritten) + an `AgentExecution` (`agentType=CRITIC`).
- **Verdicts are machine-made**: APPROVED / REJECTED are installed only by the pipeline —
  the advisory LLM can annotate but never overrides. Infrastructure failures are `FAILED`
  (never a fake "bad patch"); only `APPROVED`/`REJECTED` seal the patch row.
- **Deterministic security gate** (secrets, dangerous constructs, dependency manifests,
  multi-file diffs, parameterization signal) precedes any LLM reasoning.
- **Safety**: one disposable sandbox per run, destroyed in a `finally`; the applier is a
  pure unified-diff engine (no fuzz, no shell); all commands are argv-only through the
  existing SandboxManager (still the only Docker owner).
- The Critic HTTP surface is a **side-channel**: routes exist (POST `/api/critic/run`,
  GET `/api/critic/:executionId`) but are **not mounted** in `routes/index.ts` — only
  orchestration code may reach them.
- Live smoke test opt-in: `CRITIC_E2E=1` (real Docker: fixture app, zero-residue assert).

### LLM Provider Abstraction (free-first)

A provider-agnostic `LLMProvider` seam (generate / healthCheck / getModelInfo) with **no
paid provider required**: OpenRouter is the default — its `openrouter/free` alias routes
to whichever free model is currently available, and the app never assumes which concrete
model that is. Groq and Mistral are optional providers/fallbacks. Everything is selected
by configuration (`LLM_PROVIDER` / `LLM_MODEL` / …) — the factory fails loudly on
unsupported providers or missing keys instead of silently skipping.

- Providers (preferred order): **Gemini → OpenRouter → Groq → Mistral** — Gemini is the
  default. Thin adapters over ONE shared OpenAI-compatible substrate (plain `fetch`, no
  SDKs; no provider types leak out). Gemini rides Google's official OpenAI-compatible
  endpoint, so no Gemini SDK exists in the repo.
- Fallback (`LLM_PRIMARY_PROVIDER=gemini`, `LLM_FALLBACK_PROVIDERS=openrouter,groq,mistral`): escalates ONLY on rate-limit / outage /
  model-unavailable / timeout; auth, policy, malformed-request and unparseable-response
  errors rethrow immediately. Bounded: max 5 retries with backoff, single pass over the
  provider list — never an infinite loop.
- Cost: `estimatedCost` is 0 unless the provider explicitly reports one — AMASS never
  invents pricing. Every call records usage metadata (provider, model, tokens, cost,
  duration, status) for later latency/token/success/quality comparisons.
- Security: API keys are never logged; provider error bodies are redacted (providers can
  echo request content back); log views of prompts are bounded, redacted summaries —
  repository source code is never shipped wholesale to logs or providers.

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
| POST | `/api/runtime-sandboxes` | Provision a runtime sandbox (see Runtime Sandbox Lifecycle) |
| GET | `/api/runtime-sandboxes/:id` | Read a runtime sandbox (optional `?scanId=` scope) |
| POST | `/api/runtime-sandboxes/:id/health` | Re-verify sandbox liveness (TCP+HTTP) |
| DELETE | `/api/runtime-sandboxes/:id` | Destroy idempotently (container + network + image + workspace) |
| POST | `/api/knowledge/cve/ingest` | Ingest NVD CVE knowledge (normalize → CVERecord → embed → Qdrant) |
| GET | `/api/knowledge/cve/:cveId` | Read a normalized CVE record |
| POST | `/api/rag/search` | Ranked knowledge retrieval (whitelisted metadata filters) |
| POST | `/api/engineer/run` | Run the Engineer agent on one CONFIRMED SQLi finding (deterministic selection; produces a `Patch` with status `GENERATED`/`REJECTED`) |
| GET | `/api/engineer/:executionId` | Read an Engineer `AgentExecution` detail |
| POST | `/api/critic/run` (hidden) | Validate one GENERATED patch in a fresh disposable sandbox → `APPROVED`/`REJECTED` (side-channel: not mounted in `routes/index.ts`) |
| GET | `/api/critic/:executionId` (hidden) | Read a Critic `CriticRun` detail (side-channel) |

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
| `SANDBOX_MAX_*` | see `.env.example` | Bounded runtime-sandbox limits (CPU/memory/PIDs/concurrency/timeouts/build/health) |
| `LLM_PROVIDER` (+`LLM_PRIMARY_PROVIDER`) / `LLM_MODEL` | `gemini` / `openrouter/free` | Free-first LLM provider + model (no paid provider required; preferred order Gemini → OpenRouter → Groq → Mistral); `LLM_FALLBACK_PROVIDERS`, `LLM_TEMPERATURE`, `LLM_MAX_TOKENS`, `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`, per-provider `GEMINI/OPENROUTER/GROQ/MISTRAL_API_KEY` + `…_MODEL` |
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
