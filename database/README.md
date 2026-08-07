# AMASS Database Schema

## Overview

PostgreSQL serves as the primary relational database for AMASS, managed through Prisma ORM.

## Entity Relationship Diagram

```
┌─────────────┐       ┌──────────────────┐       ┌──────────────┐
│    Scan     │──M:N──│ ScanRepository   │──M:N──│  Repository  │
└──────┬──────┘       └──────────────────┘       └──────────────┘
       │
       │ 1:N
       ├──────────────────┐
       │                  │
       ▼                  ▼
┌──────────────┐   ┌──────────────────┐
│Vulnerability │   │ AgentExecution   │
└──────┬───────┘   └──────────────────┘
       │
       │ 1:N          N:1
       ├────────┬─────────┐
       ▼        ▼         ▼
  ┌─────────┐ ┌───────┐ ┌───────────┐
  │ Exploit │ │ Patch │ │ CVERecord │
  └─────────┘ └───────┘ └───────────┘
```

## Tables

### Scan
A security scan session. One scan can target multiple repositories and produces vulnerabilities and agent executions.

| Column | Type | Description |
|--------|------|-------------|
| id | cuid | Primary key |
| name | string | Scan display name |
| status | ScanStatus | PENDING → RUNNING → COMPLETED/FAILED |
| startedAt | datetime? | When scan began |
| completedAt | datetime? | When scan finished |

### Repository
Source code repository metadata. Repositories are linked to scans via the join table.

| Column | Type | Description |
|--------|------|-------------|
| id | cuid | Primary key |
| url | string | Repository URL (unique with branch) |
| provider | RepositoryProvider | GITHUB, GITLAB, BITBUCKET, LOCAL |
| branch | string | Target branch (default: main) |
| language | string? | Primary programming language |

### Vulnerability
Detected security issue found during a scan.

| Column | Type | Description |
|--------|------|-------------|
| id | cuid | Primary key |
| scanId | FK → Scan | Parent scan |
| severity | VulnerabilitySeverity | CRITICAL, HIGH, MEDIUM, LOW, INFO |
| status | VulnerabilityStatus | DETECTED → CONFIRMED → PATCHED |
| cveRecordId | FK → CVERecord? | Linked CVE if applicable |
| filePath | string? | Source file location |
| lineNumber | int? | Line in source file |

### Exploit
Exploitability confirmation produced by the Sniper Agent.

| Column | Type | Description |
|--------|------|-------------|
| id | cuid | Primary key |
| vulnerabilityId | FK → Vulnerability | Parent vulnerability |
| status | ExploitStatus | PENDING → CONFIRMED/NOT_EXPLOITABLE |
| proofOfConcept | text? | PoC code or description |
| attackVector | string? | How the exploit works |

### Patch
AI-generated fix produced by the Engineer Agent.

| Column | Type | Description |
|--------|------|-------------|
| id | cuid | Primary key |
| vulnerabilityId | FK → Vulnerability | Parent vulnerability |
| status | PatchStatus | GENERATED → VALIDATED → APPLIED |
| diffContent | text? | Unified diff of the patch |
| explanation | text? | Why this fix works |

### AgentExecution
Record of an autonomous agent run within a scan.

| Column | Type | Description |
|--------|------|-------------|
| id | cuid | Primary key |
| scanId | FK → Scan | Parent scan |
| agentType | AgentType | SCOUT, SNIPER, ENGINEER, CRITIC |
| status | AgentExecutionStatus | PENDING → RUNNING → COMPLETED/FAILED |
| input | json? | Agent input payload |
| output | json? | Agent output payload |
| durationMs | int? | Execution time |

### CVERecord
Common Vulnerabilities and Exposures reference data.

| Column | Type | Description |
|--------|------|-------------|
| id | cuid | Primary key |
| cveId | string | Unique CVE identifier (e.g., CVE-2024-1234) |
| cvssScore | float? | CVSS severity score |
| description | text? | CVE description |
| references | json? | External reference URLs |

## Relationships

- **Scan ↔ Repository**: Many-to-many via `ScanRepository`
- **Scan → Vulnerability**: One-to-many (cascade delete)
- **Scan → AgentExecution**: One-to-many (cascade delete)
- **Vulnerability → Exploit**: One-to-many (cascade delete)
- **Vulnerability → Patch**: One-to-many (cascade delete)
- **Vulnerability → CVERecord**: Many-to-one (optional)

## Indexes

Performance indexes are defined on frequently queried columns:
- `scans.status`, `scans.createdAt`
- `vulnerabilities.scanId`, `vulnerabilities.severity`, `vulnerabilities.status`
- `agent_executions.scanId`, `agent_executions.agentType`, `agent_executions.status`
- `cve_records.cveId`, `cve_records.severity`
