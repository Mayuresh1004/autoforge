# [AGENT.md](http://AGENT.md)

# AMASS

Autonomous Multi-Agent Security System

---

## Overview

AMASS is an Agentic AI powered DevSecOps platform that autonomously:

1. Understands a software repository.

2. Detects vulnerabilities.

3. Confirms exploitability.

4. Generates secure patches using Retrieval-Augmented Generation (RAG).

5. Validates generated patches.

6. Produces a final security report.

The system follows a modular multi-agent architecture orchestrated using LangGraph.

---

# Project Goals

The project must prioritize:

- Modularity

- Extensibility

- Maintainability

- Security

- Explainability

The codebase should resemble production software rather than a hackathon prototype.

---

# Architecture

Current Architecture

Repository

↓

Repository Analyzer

↓

Static Scanner

↓

Scout Agent

↓

Sniper Agent

↓

Engineer Agent

↓

Critic Agent

↓

GitHub Pull Request

↓

Dashboard

---

# Technology Stack

Frontend

- Nextjs

- TailwindCSS

- Motion

Backend

- Express

- TypeScript

AI

- Python

- FastAPI

- LangGraph

- LangChain

Database

- PostgreSQL

Cache

- Redis

Vector Database

- Qdrant

ORM

- Prisma

Containerization

- Docker



Package Manager

- pnpm

- Turborepo

---

# Agents

## Repository Analyzer

Responsibilities

- Clone repository

- Detect technologies

- Detect frameworks

- Detect architecture

- Parse dependencies

- Detect APIs

- Generate Repository Profile

Must NEVER

- Execute repository code

- Scan vulnerabilities

- Generate patches

---

## Scout

Responsibilities

- Attack surface discovery

- Static security analysis

- Endpoint discovery

- Technology fingerprinting

Output

Unified Vulnerability Model

---

## Sniper

Responsibilities

- Validate vulnerabilities

- Execute exploits inside sandbox

- Produce PoC

- Reduce false positives

---

## Engineer

Responsibilities

- Retrieve similar CVEs

- Query Qdrant

- Generate Git patch

- Preserve coding style

Must never directly modify repositories.

Always generate Git diffs.

---

## Critic

Responsibilities

- Validate generated patches

- Re-run exploits

- Perform static review

- Approve or reject patches

---

# Coding Principles

Always

- Follow SOLID

- Use Dependency Injection

- Use clean architecture

- Prefer composition over inheritance

- Keep functions small

- Keep files focused

Never

- Hardcode secrets

- Duplicate business logic

- Mix infrastructure and domain logic

- Create circular dependencies

---

# Folder Structure

apps/

dashboard/

api/

ai-orchestrator/

packages/

types/

config/

logger/

schemas/

shared/

infra/

docker/

kubernetes/

docs/

---

# Database

Primary Database

PostgreSQL

Vector Database

Qdrant

Cache

Redis

---

# Communication

Express API

↓

FastAPI

↓

LangGraph

↓

Agents

↓

Database

---

# Logging

Every major action must log

- Agent

- Duration

- Status

- Errors

Logs should be structured.

---

# AI Guidelines

Whenever generating code:

Prioritize

- readability

- maintainability

- testability

Avoid

- giant classes

- giant functions

- hidden side effects

Never invent APIs.

If uncertain, create interfaces first.

---

# Security

Never

- expose secrets

- print tokens

- disable TLS

- ignore authentication

Sandbox all exploit execution.

Never run attacks outside authorized environments.

---

# Development Philosophy

Implement one complete vertical slice before expanding horizontally.

Example

SQL Injection

↓

Detect

↓

Confirm

↓

Patch

↓

Validate

↓

Report

Only then implement XSS, SSRF, etc.

---

# Long-Term Vision

AMASS should eventually support

- Multiple LLM providers

- Multiple vector databases

- Multiple scanners

- Plugin architecture

- Human approval mode

- GitHub PR automation

- Kubernetes deployment