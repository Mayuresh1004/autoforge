# AMASS Architecture Documentation

## System Overview

AMASS (Autonomous Multi-Agent Security System) is an agentic AI-powered DevSecOps platform that autonomously detects vulnerabilities, confirms exploitability, generates patches using RAG, validates patches, and produces security reports.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    React + TailwindCSS (Vite)                    │    │
│  │                         Port: 5173                               │    │
│  └──────────────────────────────┬──────────────────────────────────┘    │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │ HTTP/REST
┌─────────────────────────────────┼───────────────────────────────────────┐
│                           API LAYER                                     │
│  ┌──────────────────────────────▼──────────────────────────────────┐    │
│  │              Express + TypeScript Backend API                    │    │
│  │                         Port: 3001                               │    │
│  │  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌────────────────┐   │    │
│  │  │  Routes  │→│ Controllers│→│ Services │→│  Repositories  │   │    │
│  │  └──────────┘ └────────────┘ └──────────┘ └────────────────┘   │    │
│  └──────────────────────────────┬──────────────────────────────────┘    │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │ HTTP/REST
┌─────────────────────────────────┼───────────────────────────────────────┐
│                        AGENT ORCHESTRATION LAYER                        │
│  ┌──────────────────────────────▼──────────────────────────────────┐  │
│  │                  FastAPI + Python Agents Service                   │  │
│  │                         Port: 8000                                 │  │
│  │  ┌─────────┐ ┌─────────┐ ┌───────────┐ ┌─────────┐              │  │
│  │  │  Scout  │ │ Sniper  │ │ Engineer  │ │ Critic  │  (Future)   │  │
│  │  └────┬────┘ └────┬────┘ └─────┬─────┘ └────┬────┘              │  │
│  │       └───────────┴─────────────┴───────────┘                   │  │
│  │                    LangGraph Orchestrator (Future)                 │  │
│  └──────────────────────────────┬──────────────────────────────────┘    │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │
┌─────────────────────────────────┼───────────────────────────────────────┐
│                          DATA LAYER                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐    │
│  │  PostgreSQL  │  │    Redis     │  │         Qdrant           │    │
│  │  Port: 5432  │  │  Port: 6379  │  │      Port: 6333          │    │
│  │              │  │              │  │                          │    │
│  │ • Scans      │  │ • Agent mem  │  │ • CVE embeddings         │    │
│  │ • Vulns      │  │ • Cache      │  │ • Doc embeddings         │    │
│  │ • Patches    │  │ • Job queue  │  │ • Fix history            │    │
│  │ • CVE records│  │              │  │ • Code snippets          │    │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Service Communication Diagram

```
                    ┌──────────┐
                    │ Frontend │
                    │  :5173   │
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          │          ▼
        ┌──────────┐    │    ┌──────────┐
        │ Backend  │◄───┘    │  Agents  │
        │  :3001   │────────►│  :8000   │
        └────┬─────┘         └────┬─────┘
             │                    │
     ┌───────┼────────────────────┼───────┐
     │       │                    │       │
     ▼       ▼                    ▼       ▼
┌─────────┐ ┌───────┐      ┌─────────┐ ┌───────┐
│Postgres │ │ Redis │      │ Qdrant  │ │ Redis │
│  :5432  │ │ :6379 │      │  :6333  │ │ :6379 │
└─────────┘ └───────┘      └─────────┘ └───────┘

Communication:
  Frontend → Backend:  REST API (scan management, reports)
  Frontend → Agents:   REST API (agent status, direct queries)
  Backend  → Agents:   REST API (trigger agent workflows)
  Backend  → Postgres: Prisma ORM (CRUD operations)
  Backend  → Redis:    ioredis (cache, sessions)
  Backend  → Qdrant:   HTTP (health checks)
  Agents   → Postgres: Direct SQL (agent state persistence)
  Agents   → Redis:    Agent memory, job queue
  Agents   → Qdrant:   Vector search for RAG
  Agents   → Backend:  Health check, result reporting
```

## Clean Architecture Layers

### Backend (Express)

```
src/
├── config/          # Environment, database, redis, logger
├── controllers/     # HTTP request handlers (thin)
├── services/        # Business logic (future)
├── repositories/    # Data access layer (Prisma)
├── routes/          # Route definitions
├── middlewares/     # Error handling, logging, auth (future)
├── types/           # TypeScript interfaces
├── utils/           # Response helpers, error classes
├── app.ts           # Express app factory
└── index.ts         # Entry point, graceful shutdown
```

### Agents (FastAPI)

```
app/
├── config/          # Settings, logging
├── api/routes/      # HTTP endpoints
├── services/        # Health, Qdrant, agent services
├── agents/          # LangGraph agents (future)
├── core/            # Response format, exceptions
├── middleware/      # Error handlers
└── main.py          # App factory, lifespan events
```

## Future Agent Pipeline

```
Scan Request
     │
     ▼
┌─────────┐    Detect      ┌─────────┐   Confirm     ┌───────────┐
│  Scout  │──────────────► │ Sniper  │─────────────► │ Engineer  │
│  Agent  │  vulnerabilities│  Agent  │ exploitability│   Agent   │
└─────────┘                └─────────┘               └─────┬─────┘
                                                           │
                                                           ▼ Generate
                                                     ┌─────────┐
                                                     │ Critic  │
                                                     │  Agent  │
                                                     └────┬────┘
                                                          │
                                                          ▼ Validate
                                                   Security Report
```

## Dependency Rules

1. **Routes** depend on Controllers only
2. **Controllers** depend on Services only
3. **Services** depend on Repositories and external services
4. **Repositories** depend on Prisma/database only
5. **Config** has no dependencies on other layers
6. **No circular dependencies** between any layers

## Future Extensibility

### Adding a New Agent

1. Create agent module in `agents/app/agents/{agent_name}/`
2. Define LangGraph state machine and tools
3. Add route in `agents/app/api/routes/`
4. Register route in `main.py`
5. Add `AgentType` enum value in Prisma schema
6. No changes needed to backend or frontend infrastructure

### Adding a New API Endpoint

1. Create repository method in `backend/src/repositories/`
2. Create service method in `backend/src/services/`
3. Create controller handler in `backend/src/controllers/`
4. Register route in `backend/src/routes/`

### Adding a New Database Table

1. Add model to `backend/prisma/schema.prisma`
2. Run `npm run db:migrate`
3. Create repository in `backend/src/repositories/`
4. Add shared types to `shared/src/types/`
