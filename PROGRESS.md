# AMASS Backend — Progress Log

> Living development log for the **Repository Analyzer** and **Static
> Scanner** modules (plus what comes next). This file is **maintained on
> every change**: every completed feature, how it was implemented, and what
> challenges were solved. Ask the assistant for an update whenever work is done.

---

## How this file is structured & maintained

- A **Unified Map** section is always kept up-to-date (new files added, keys
  rotated, tests updated) so a fresh session can resume without digging.
- Each milestone has a **Built** (what + how) and **Challenges** (what was hard
  or surprising) subsection.
- Global, recurring constraints are listed once at the bottom and assumed
  throughout, so they don't need repeating per entry.

To update: add/adjust the relevant milestone entries, bump the **Global status**
counters, and reflect any new files in the Unified Map. Never delete history —
append new milestones below prior ones.

---

# Repository Analyzer — Module Status

**Location:** `backend/src/repository-analysis/`

## Global status

| Milestone | Feature | Tests added | Status |
|---|---|---|---|
| 1 | Repository Cloner | 18 | ✅ Complete |
| 2 | File System Analyzer | +17 | ✅ Complete |
| 3 | Technology Detector | +5 | ✅ Complete |
| 4 | Dependency Analyzer | +6 | ✅ Complete |
| 5 | Architecture & API Analyzer | +16 | ✅ Complete |
| 6 | Profile Generator + API | +5 | ✅ Complete |
| 7 | Static Scanner (Module 2) | +38 | ✅ Complete |
| 8 | Sandboxing (Layer 1) | +11 | ✅ Complete |
| 9 | Sandbox Manager (SandboxInfrastructure) | +21 | ✅ Complete |
| 10 | Pipeline through the Manager (M10) | +5 | ✅ Complete |
| 11 | Route wired to sandboxed orchestrator (M11) | +1 | ✅ Complete |
| 12 | Runnable stack / Docker E2E (M12) | +0 (infra) | ✅ Complete |
| 13 | Scout Agent — recon (M13) | +40 (183 / 39) | ✅ Complete |
| 14 | Attack Planner — reasoning (M14) | +21 (204 / 43) | ✅ Complete |
| 15 | Sniper Agent — SQLi verification (M15) | +45 (251 / 50) | ✅ Complete |
| 16 | Runtime Sandbox Lifecycle (Phase 6) | +39 (293 / 55) | ✅ Complete |
| 17 | LLM Provider Abstraction (free-first) | +57 (354 / 62) | ✅ Complete |
| 17a | Provider adjustment: Gemini primary (7A) | — (354 / 62) | ✅ Complete |
| 18 | Knowledge ingestion + RAG foundation (7A) | +75 (429 / 72) | ✅ Complete |
| 19 | Engineer Agent — draft remediation (7B) | +74 (503 / 82) | ✅ Complete |

- **Total tests:** 503 passing across 82 test files — 511 collected (8
  skipped: 4 Docker-gated E2E tests + 4 opt-in LLM/RAG/Engineer live tests).

- `npx tsc --noEmit` → exit 0 · `npm run build` → clean · compiled CJS loads
  (with `DATABASE_URL`/env set — the app's env validation runs at import).
- All implementation files are `< 300` lines (max = 295, sniper-run.ts) — the runtime
  lifecycle is split by responsibility: `runtime-sandbox.service.ts` (orchestrator) +
  `runtime-sandbox-provisioning.ts` (container build/probe) + `runtime-sandbox-state.ts`
  (seed/patch/ownership) + `runtime-sandbox-utils.ts` (stage mapping/helpers).
- New runtime deps (CJS-compatible, all verified): `@iarna/toml`, `yaml`,
  `fast-xml-parser`.

## Global process/architecture conventions (assumed in every entry)

- **Clean Architecture**, 4 layers, never mixed:
  `Domain models/ports/errors` → `application/services` (orchestration) →
  `infrastructure/*` (implementations) → `presentation/*` (HTTP/DTOs).
- **Ports before implementations**; strong types, no `any` unless justified;
  no placeholder implementations.
- **Extend existing abstractions** — never replace working architecture;
  search the project before creating files; no duplicate services.
- **Behavioral rules:** the Analyzer only *reads* a repo (never executes code,
  never touches `.env`, never scans for vulnerabilities — that's a later
  agent's job). Never expose secrets. **Never guess** — if confidence is low,
  return `Unknown`/`null`.
- Edge cases: DTOs at API boundaries, log every execution (pino via
  `config/logger`), versions parsed into manifests, ignore
  `node_modules/.git/dist/build/target/vendor`.
- Test colour: `backend/vitest.config.ts` sets `LOG_LEVEL: 'fatal'` (never
  `'silent'`) plus `DATABASE_URL`/`REDIS_URL`.

---

## Milestone 1 — Repository Cloner ✅

### Built
- **Domain**
  - `domain/models/repository.ts` — `RepositoryIdentity`, `CloneResult`,
    `ClonedRepository` (immutable DTOs: identity, localPath, commitSha,
    sizeBytes, clonedAt).
  - `domain/ports/repository-url-resolver.ts`, `domain/ports/repository-cloner.ts`.
  - `domain/errors/repository-analysis.errors.ts` — `InvalidRepositoryUrlError`,
    `RepositoryTooLargeError` (plus `AppError` base usage).
- **Infrastructure**
  - `git/github-url-resolver.ts` — strict validation: only `https://github.com`,
    reconstructs the clone URL from owner/name, **rejects** embedded creds, ports,
    SSH, path traversal, non-github hosts. No network — purely reconstruct +
    validate.
  - `git/git-repository-cloner.ts` — runs the system `git` binary via
    `child_process.execFile` (argv array, **no shell string**), `--depth 1`
    shallow clone, `GIT_TERMINAL_PROMPT=0`, configurable timeout, cleans up a
    partial clone on failure. No new runtime dependency (uses system git; the
    backend Docker image now `apk add git`).
  - `infrastructure/fs/directory-size.ts` — async directory size walk.
- **Application**
  - `application/services/repository-cloning.service.ts` — resolves+validates via
    injected resolver, clones into a fresh unique dir under a managed workspace,
    enforces the size budget (`ANALYZER_MAX_REPO_BYTES`), returns immutable
    metadata; never leaks a partial clone.
- **Config** — extended `src/config/index.ts` (`analyzerConfig`):
  `ANALYZER_WORKSPACE_DIR`, `ANALYZER_CLONE_TIMEOUT_MS` (120s),
  `ANALYZER_MAX_REPO_BYTES` (2 GiB), `ANALYZER_KEEP_REPO_DIR`. Dockerfile installs
  `git`.

**How tests work:** `test/helpers/git-repo.ts` creates a temp git repo on disk and
returns `{ fileUrl, commitSha, cleanup }`; the cloning service ignores the URL and
uses a fake resolver that returns the fixture's `fileUrl` (no network needed).

### Challenges
- **No-shell cloning** — building the git invocation safely required
  `execFile` with an argv array, not a template string, to avoid any injection
  path on user-provided URLs.
- **Shallow-clone commit sha** — a `--depth 1` clone's HEAD sha differs from the
  remote's full sha; tests use the resolve both sides via the fixture's own
  commit sha.
- **Partial-clone leak** — failing clones (or oversized repos) had to have their
  working tree removed in every failure path (`try/catch` + size check) so a
  bad run never leaves clutter behind in the workspace.
- **Latent `instanceof` bug** — `src/utils/errors.ts` originally did
  `Object.setPrototypeOf(this, AppError.prototype)` which broke `instanceof`
  for every subclass. Fixed to `new.target.prototype` — this was required
  before domain errors (which extend `AppError`) could be caught.

---

## Milestone 2 — File System Analyzer ✅

**Built**
- **Domain** — `models/file-system.ts` (`FileInfo`, `DirectoryNode`,
  `FileSystemAnalysis`, `ImportantFile`, `LargestEntry`), `ports/file-system-analyzer.ts`.
- **Infrastructure** (`infrastructure/fs/`)
  - `ignore-rules.ts` — gitignore-style matcher. **Defaults are directory-only**
    for folder names (`build/` not `build`) so `src/build/` (a valid source
    folder) is not skipped. Secret `.env` is always ignored.
  - `important-files.ts` — catalog of notable files (READMEs, manifests,
    lockfiles, configs, CI, container files) classified by category.
  - `file-system-analyzer.ts` — single-pass recursive walk; **symlinks never
    followed**; LOC computed for text files only; `.env` ignored; `tree` is
    truncated (via max depth) for output; keeps the full `files` list (used by
    downstream analyzers — relative paths are the join key).

**Challenges**
- Wrongly treating `build/` as both dir and file. Git's rule that a trailing
  slash means "directory only" had to be implemented so real source folders
  named `build` or `tests` are not accidentally excluded. **Burned once** during
  early detection tests — commits semantic issue.
- Symlink loops — following symlinks naively recurses forever; the analyzer
  never descends into symlinked directories.
- Truncating the tree for output while still exposing the complete file list
  for downstream consumers (a single small type capsule both needs).

---

## Milestone 3 — Technology Detector ✅

**Built**
- **Domain**: `models/technology.ts` (`Technology`, categories via union, each
  with `confidence` + `evidence`); `ports/technology-detector.ts`.
- **Infrastructure** (`infrastructure/detection/`)
  - `detection-context.ts` — cached, size-capped manifest reads (reads
    `package.json` deps/engines, python deps…); static `dependencyMatches`
    resolves scoped names (`@pkg`).
  - `dashboard/...`/signals : declarative `TechnologySignal` spec
    (`detection/signal.ts`) + a `detection-engine.ts` that collects evidence and
    orders categories **language → runtime → framework → package-manager →
    build-tool → database → container → ci-cd → cloud**.
  - `technology-detector.ts` — injectable categories.
  - `signatures/` — language, runtime, framework, package-manager,
    build-tool, database, container, ci-cd, cloud signatures. **Package-manager
    is lockfile-based** (no false claims from a bare `package.json`).
- **Key rule:** no guessing — returning nothing for an ambiguous repo is correct.

**Challenges**
- Signatures vs. false positives: package managers only present if a real
  lockfile exists (a repo with just `package.json` does not claim npm).
- Because of the diversity of categories, a declarative signal spec + ordering
  engine was cleaner than ad-hoc `if`s — order in the output matters because the
  *primary technology* (M6) is taken as the top of the list.
- `@pkg` scoped names have to be matched both with and without the scope — the
  static matcher handles it in one place.

---

## Milestone 4 — Dependency Analyzer ✅

**Built**
- **Domain**: `models/dependencies.ts` (`ParsedDependency`, `EcosystemSummary`,
  `DependencyAnalysis`, scopes/categories unions); `ports/dependency-analyzer.ts`.
- New deps installed: **`@iarna/toml`** (TOML), **`yaml`** (YAML),
  **`fast-xml-parser`** (XML) — all verified CJS-compatible.
- **Parsers** (`infrastructure/parsers/`) — a manifest per file, one registry entry each:

  | Manifest | Ecosystem | Notes |
  |---|---|---|
  | `package.json` | npm | deps/dev/peer/optional scopes + `engines` runtimes |
  | `requirements.txt` | pip | PEP 508 specifiers |
  | `pyproject.toml` | Python | PEP 621 `[project]` + legacy `[tool.poetry]` |
  | `Cargo.toml` | cargo | runtime + dev-deps |
  | `pom.xml` | maven | `${property}` version resolution, scopes, Java runtime |
  | `build.gradle` | gradle | best-effort coordinate regexes (documented limitation) |
  | `go.mod` | go | module + Go version + `require` block |
  | `composer.json` | php | `require`/`require-dev` + PHP constraint |
  | `pubspec.yaml` | dart | deps + SDK constraint |
  | `Gemfile.lock` | bundler | resolved versions + Ruby version |

  Plus `parse-pep508.ts` (PEP 508 parsing), `types.ts` (shared),
  `index.ts` (registry `MANIFEST_DEFINITIONS`).
- **Classifier** `detection/dependency-classifier.ts` — maps package names to
  semantic categories (framework/auth/security/orm/database/ai/test/lint/
  validation/logging/http/utility), reuses `DetectionContext.dependencyMatches`,
  and is **artifact-aware** for Maven coordinates (matches the segment after the
  final `:`).
- **Analyzer** `dependency-analyzer.ts` — reads root manifests through
  `DetectionContext.readManifest` (size-capped, cached), classifies, dedupes per
  category, filters null runtimes.

**Challenges**
- `fast-xml-parser` converts numeric/boolean XML text to JS numbers — `pom.xml`
  properties like `<java.version>17</java.version>` had to be coerced back to
  strings for the runtime field.
- `pyproject.toml` comes in two dialects (PEP 621 plus the legacy Poetry
  section); a hand-written `uv`/tool section was removed. Only definite reads.
- Import paths were churned several times (`./detection/...`, `../domain/...`) —
  the parsers live under `infrastructure/parsers` while models live under
  `domain` — fixed by standardizing relative paths.
- `${property}` resolution in `pom.xml` requires registry lookups against the
  `<properties>` block; implemented in `pom-xml.ts` for the common case.

---

## Milestone 5 — Architecture & API Analyzer ✅

**Built**
- **Domain**: `models/architecture.ts` (`ArchitectureCandidate`, `primary: null |
  candidate`, leaving "Unknown" to consumers); `models/api.ts`
  (`ApiInventory`, endpoints, protocols union); `models/authentication.ts`.
- **Ports**: `architecture-analyzer.ts`, `api-analyzer.ts`,
  `authentication-analyzer.ts`.
- **Infrastructure** (`infrastructure/analyzers/`)
  - `architecture-analyzer.ts` — **SignatureArchitectureAnalyzer**. Emits
    candidates only from real signals: `clean`/`hexagonal`/`layered`/`mvc`
    (directory layers detected **at any depth**, e.g. `src/domain/…`),
    `client-server`, `monorepo` (workspace manifests + nested package.json),
    `microservices` (≥3 top-level service manifests), `serverless`
    (serverless/vercel/netlify/wrangler), `monolith` (single root manifest, no
    service dirs). Precedence: `microservices` > `client-server` > `monorepo` >
    concrete shapes. **`primary` is `null` when nothing clears the confidence
    bar → `"Unknown"`.** No guessing.
  - `api-analyzer.ts` — **RegexApiAnalyzer**. Read-only, size-bounded (>2 each).
    Route declaration patterns for: Express/Fastify/Koa/Hapi call-sites +
    router mounts (`app.use('/x', router)`), FastAPI/Flask decorators (incl.
    Flask explicit `methods=[...]`), Spring `@*Mapping` (Java+Kotlin),
    Go Gin/Echo + net/http, Laravel `Route::` (route files only),
    Rails `routes.rb`. Dedupes by method+path; caps endpoints (200) and scanned
    files (500). Protocol detection: `rest`/`graphql`/`websocket`/`rpc` from
    manifests, `hasGlob('**/*.graphql')`, `.proto` globs, deps
    (`socket.io`, `grpc`, `@trpc/server`, …). `graphqlSources` listing detached.
  - `authentication-analyzer.ts` — **RegexAuthenticationAnalyzer**. Libraries →
    schemes (JWT, OAuth2, Session, NextAuth, Clerk, Supabase, Firebase, SSO)
    via `AUTH_RULES`; finds auth middleware files (name-based + keyword scan,
    max 5 evidence paths).

**Challenges**
- **Topology vs. concrete shape precedence**: a `client/` + `server/` split is
  also a monorepo; both candidates appear. `client-server` had to be preferred
  over the generic `monorepo` label. Reordered `pickPrimary`.
- **Nested layers.** `src/domain/…` didn't match a top-level-directory check.
  Added `DetectionContext.allDirectories` (every directory name at any depth)
  so architecture detection isn't fooled by scaffolding dirs.
- Route scanning produces false positives if it runs on every file (e.g. a
  string literal `'get'`); patterns are scoped per extension and (for Laravel /
  Rails) restricted to files whose path contains `route`.
- No supertest in the project, so route/controller tests are done by stubbing
  `req`/`res` and capturing via `res.json` promises (M6 below).

---

## Milestone 6 — Repository Profile Generator + API ✅

**Built**
- **Domain**: `models/repository-profile.ts` — a single JSON-ready
  `RepositoryProfile` projection (`meta`, `fileSystem`, `technologies`,
  `dependencies`, `architecture`, `api`, `authentication`). It is deliberately a
  *projection* — it never exposes the full file tree, per-file metadata, or raw
  manifest content.
- **Application** `repository-profile.service.ts` — orchestrates the whole
  pipeline: clone → file-system → technology → dependencies → architecture →
  API → auth; logs every step with a timer; **owns the repo lifecycle**
  (auto-cleanup unless `keepRepoDir`). Returns the assembled `RepositoryProfile`.
- **Presentation**
  - `dto/analyze-repository.dto.ts` — zod `.strict()` request validation.
  - `controllers/repository-profile.controller.ts` — validates body (400 on
    invalid), delegates to the service, returns via `createSuccessResponse`
    envelope.
  - `routes/repository-profile.routes.ts` — **composition root** wiring all
    concrete implementations with explicit constructor injection (no DI
    framework).
  - Mounted in `backend/src/routes/index.ts` at **`POST /api/repositories`**.

**Tests (M6)**: full-pipeline integration test (real temp git repo → all
analyzers → deep assertions on meta/tech/deps/arch/api/auth + cleanup),
`keepRepoDir=true` retention, invalid-URL rejection, and controller unit tests
(success envelope + validation 400).

**Challenges**
- **Self-referential bundle.** First attempt built the `AnalysisBundle`
  object literal with `fileSystem: …`, then referenced `bundle.fileSystem`
  inside the same literal for the next stage — a temporal dead zone / `undefined`
  runtime. Split each stage into its own `await`ed local variable.
- npm ecosystem `count` includes devDependencies (5 not 4 in the fixture test)
  — the parser counts all scopes; assertion corrected.
- `express` classifies as **framework**, not `http`, in the classifier; test
  assertions corrected.
- Running the built CJS needs `DATABASE_URL` set (the app config eagerly loads
  Prisma and requires it); verified new modules load with `DATABASE_URL`
  injected. No other module registers new required env vars.

---

# Static Scanner — Module Status

**Location:** `backend/src/static-scanner/`

Deterministic, agent-free security scanning. Given a repository URL, it
clones/analyzes the repo (reusing the analyzer's `RepositoryProfileService` as
a `RepositoryPreparer`), selects applicable scanners from a registry, runs
them in isolated processes, normalizes + deduplicates results into a **Unified
Vulnerability Model**, and persists them (reusing the existing `Scan` /
`Repository` / `Vulnerability` tables — `Patch`/`Exploit` untouched).

## Milestone 7 — Static Scanner ✅

### Built

- **Domain models** (`domain/models/`): `severity.ts` (ladder + `rank` +
  `isAtOrAbove`), `finding.ts` (`RawFinding` → `UnifiedFinding`), `scan.ts`
  (`ScanContext`, `ScannerRunResult`, `ScannerStatistics`, `ScanSummary` +
  pure `summarize()`, `StoredScan`/`StoredRepository`/`StoredFinding`,
  `ScanResult`/`ScanOverview`), `scanner-metadata.ts`, `scan-target.ts`
  (decoupled `ScanTargetProfile` so the scanner never depends on analyzer
  models), and `errors/static-scanner.errors.ts` (`ScannerExecutionError`,
  `ScanNotFoundError` extending `AppError`).
- **Ports** (`domain/ports/`): `scanner-executor`, `scanner` (Scanner /
  ScannerConfig / ScannerCommand), `scanner-registry`, `scanner-runner`,
  `deduplicator`, `scan-repository` (with `scannerStats` in
  `CompleteScanInput`). Plus application port
  `application/ports/repository-preparer.ts` (`prepareRepository` /
  `disposeRepository` → `PreparedRepository`) implemented by the analyzer's
  profile service.
- **Infrastructure — execution**: `process-scanner-executor.ts`
  (`child_process.execFile`, argv-only, `timeoutMs` + `maxBuffer`, no shell,
  no env passthrough beyond a minimal safe set); `scanner-runner.ts`
  (per-scanner isolation — a failing scanner never stops the others; logs
  every run).
- **Infrastructure — normalization**: `severity-mapper.ts` (tool severities →
  canonical ladder, **unknown → INFO, never guessed**), `normalizer.ts`
  (`FindingNormalizer`: deterministic `vuln_<sha256>` id from
  file/line/type/scanner, threshold filter, confidence clamp 0..1,
  reference dedup), `deduplicator.ts` (`KeyedFindingDeduplicator`: keyed on
  file|line|type|severity; higher confidence wins; ties by scanner id;
  **references always merged into the survivor**; deterministic output order).
- **Concrete scanners** (`infrastructure/scanning/scanners/`), each with
  metadata / `isApplicable` / `buildCommand` / `parse` on top of
  `BaseScanner` (`run` = build → execute → parse → normalize; `toRelativePath`
  relativizes tool paths against the working tree):
  - `bandit/` — Python `bandit -r -f json` (confidence/severity/CWE mapped);
  - `pip-audit/` — `pip-audit -r requirements.txt -f json` (CVE + evidence);
  - `semgrep/` — JS/TS `semgrep scan --json` (rules mapped, CWE + refs);
  - `npm-audit/` — `npm audit --json` (treats the non-zero exit code as a
    normal result — vulnerabilities found ≠ crash).
- **Registry** (`scanner-registry.ts`): `DefaultScannerRegistry` selects by
  `isApplicable(profile)`; empty selection = no scanners run (no guessing).
- **Persistence** (`infrastructure/persistence/prisma/scan-repository.prisma.ts`):
  `PrismaScanRepository` — upsert Repository, create/run/complete Scan,
  save findings, read scan + results; schema extended: `Vulnerability` gains
  `scanner`, `vulnType`, `confidence`, `message`, `cve`, `references Json`,
  `evidence` (+ index on `scanner`); `Scan` gains `scannerStats Json`.
  `Patch`/`Exploit` untouched. Client regenerated via `npx prisma generate`.
- **Application**: `scan.service.ts` orchestrates prepare → select → run
  (isolated) → normalize → dedupe → persist → summarize → `scannerStats`;
  any scanner failure marks the scan `FAILED` but never discards the
  findings; preparation errors propagate with nothing persisted; the
  working tree is always disposed in `finally`.
- **Presentation**: `dto/scan-static.dto.ts` (zod strict `{ url }`),
  `controllers/scan.controller.ts` (400 on invalid body, `NotFoundError` 404,
  `createSuccessResponse` envelope), `routes/scan.routes.ts` (composition
  root: executor → 4 scanners → registry → runner → dedup → Prisma repo →
  `ScanService`; reuses the analyzer's profile service as preparer). Mounted
  in `src/routes/index.ts` under `/api`:
  `POST /api/scan/static` · `GET /api/scan/:id` ·
  `GET /api/scan/:id/results` · `GET /api/scan/:id/statistics`.
- **Config**: `staticScannerConfig` (defaultTimeoutMs, severityThreshold,
  per-scanner enabled/timeoutMs/extraArgs) + zod env schema
  (`SCANNER_*`) + `.env.example` entries.
- **Tests (37)**: severity mapping, normalizer (deterministic ids, threshold,
  confidence clamp), dedup (merge + order), per-scanner parse/run
  (fixtures with relative-path relativization), registry selection,
  runner isolation, full-pipeline `ScanService` integration (in-memory repo,
  fake preparer: end-to-end persist + statistics, partial-failure → FAILED
  with findings kept, severity threshold, preparation-error propagation,
  disposal), controller unit tests. Plus a **full-chain integration test**
  (`scan.service.pipeline.test.ts`): a real local git repo → real analyzer
  (`RepositoryProfileService` as preparer) → `ScanService` → persisted UVM,
  asserting cleanup. 24 test files / 105 tests total.

### Challenges

- **Import-depth whiplash**: the scanner lives deeper under `src/` than the
  analyzer (`static-scanner/infrastructure/scanning/scanners/<tool>/`), so
  `../domain/...` depths were wrong (2 levels) — fixed by recomputing up-to-
  `src` per directory; TSC caught every instance.
- **Prisma JSON typing**: `references Json` / `scannerStats Json` columns
  reject `null` in the input union (`JsonValue` ≠ `InputJsonValue`) — cast
  with `Prisma.InputJsonValue`, and `getScan` now passes the repository into
  `toStoredScan` instead of assigning to a readonly property.
- **`readonly` summary mutation**: `summarize()` initially mutated a
  spread of `EMPTY_SUMMARY` (TS2540) — rewritten as pure per-severity
  counters; signature widened to `{ severity: Severity }[]` so stored
  findings summarize too.
- **Protected base constructor**: `BaseScanner` had a `protected` constructor,
  making `new BanditScanner(...)` illegal outside the class (TS2674) —
  made public.
- **Semgrep scope**: kept to JS/TS (Bandit + pip-audit cover Python); tests
  assert the exclusion instead of assuming universal applicability.
- **Dedup reference-loss bug**: an equal-confidence duplicate was dropped
  without merging its references — the survivor now always accumulates the
  duplicate's references.
- **npm audit exit code**: exits non-zero when vulnerabilities exist; the
  scanner treats that as a normal completed run (parsed successfully).
- **Scanner identity**: `finding.scanner` = stable scanner id (registry key),
  not the display engine name.

---

# Sandboxing (Layer 1) — Module Status

**Location:** `backend/src/sandbox/`

Every operation that runs on (untrusted) repository code — git clone **and**
all scanner CLIs — now goes through one sandbox boundary (`SandboxRuntime`
port), with a process-level implementation. OS/container isolation (gVisor /
per-scan container) is prepared as a deployment-layer handoff (Layer 2),
not claimed as done here.

## Milestone 8 — Sandboxed execution ✅

### Built

- **Port** (`sandbox/domain/ports/sandbox.ts`): `SandboxRuntime`
  (`run` + `createWorkspace`/`dispose`), `SandboxRunOptions` (argv-only,
  cwd, hard timeout, maxBuffer, **env allowlist**, safe env overrides,
  network policy `'none' | 'net'`), `SandboxOutput`, `SandboxWorkspace`.
  Interchangeable — a container/gVisor backend can implement the same port.
- **Process-level implementation** (`sandbox/infrastructure/process-sandbox.ts`):
  - `buildEnv` — child env is built **only from an allowlist** (+ safe
    overrides); secrets/tokens/project config never reach child processes.
  - `withNetIsolation` (pure) — when egress is blocked and the host
    supports it, wraps argv with `unshare --user --map-root-user --net --`
    (private network namespace, loopback-only, no egress).
  - `ProcessSandboxRuntime` — `execFile` (no shell), SIGTERM-on-timeout,
    bounded buffer, **feature-detects** unprivileged namespaces once
    (cached; degrades with a logged warning when unavailable instead of
    failing scans), throwaway `createWorkspace` dirs with idempotent
    recursive disposal.
- **Wiring (all code-touching ops are now sandboxed):**
  - `ProcessScannerExecutor` → delegates to `ProcessSandboxRuntime` with a
    minimal env allowlist and per-scanner network policy
    (`ScannerCommand.network`, set from each scanner's
    `metadata.networkAccess` — only npm-audit/pip-audit opt in to egress).
  - `GitRepositoryCloner` → runs `git clone` (network allowed — fetching the
    target is the point, env allowlisted + `GIT_TERMINAL_PROMPT=0`) and
    `git rev-parse` (network blocked) through the sandbox; failures are now
    detected via exit codes (the sandbox doesn't throw) and wrapped as
    `RepositoryCloneError`.
- **Docker hardening** (`backend/Dockerfile`): runs as non-root `amass`
  (already), adds `util-linux` (provides `unshare` for net isolation),
  dedicated owned workspace dir (`ANALYZER_WORKSPACE_DIR=/app/workspace`).
- **Tests (+11 → 116):** env allowlist strips secrets (incl. a real child
  process observing the env), `withNetIsolation` pure decision (wrap /
  pass-through), success/exit-code/timeout behavior (children killed,
  `timedOut=true`, never hang), throwaway workspace create+idempotent
  dispose, `ProcessScannerExecutor` end-to-end (no secrets visible, exit
  codes/timeouts). All existing clone/scan/profile suites still green
  through the sandboxed paths.

### Challenges

- **Sandboxes report, they don't throw**: `execFile`-style failures used to
  reject; the sandbox returns `{ exitCode, timedOut }`. The git cloner had
  to switch to checking `exitCode !== 0` (and stderr truncation) before
  raising `RepositoryCloneError`.
- **Unprivileged net namespaces are host-dependent**: `unshare --net` needs
  user namespaces (often disabled in Docker). Instead of failing or faking
  isolation, the runtime probes once and degrades to a logged best-effort
  (scanners still get offline-friendly semantics via the network flag).
- **Network policy must be explicit per command**: cloning needs egress
  (fetching the repo) while analysis/scanners must not — so the port
  carries an explicit `network` field rather than assuming either way.
- **Env leakage is default-dangerous**: plain `execFile` inherits
  `process.env`; the allowlist makes the safe path the default.

---

# Sandbox Manager — Milestone 9 ✅ (sandbox infrastructure for ALL agents)

**Location:** `backend/src/sandbox/`

The sandbox is the substrate every phase operates in — clone, analyze, scan,
and the future Scout/Sniper/Engineer/Critic agents. No phase talks to Docker;
they request typed operations from the **Sandbox Manager**, which is the only
component that knows Docker.

## Milestone 9 — Sandbox Manager ✅

### Built

- **Domain model** (`domain/models/sandbox.ts`): `SandboxType`
  (analysis | runtime), `SandboxStatus` lifecycle, `SandboxNetworkPolicy`
  (`none` | `internal` | `egress`+allowlist), `SandboxSpec`, `Sandbox`
  (id, scanId, type, status, image, repositoryPath, network, containerId,
  networkId, timestamps), `ExecRequest` (argv-only, env allowlist, timeout),
  `ExecResult`, `SandboxPatch`. No Docker primitives leak into the model.
- **Ports** (`domain/ports/sandbox-manager.ts`):
  - `SandboxManager` — the ONLY agent-facing surface: `createSandbox`,
    `waitUntilReady`, `execute`, `copyFile`, `applyPatch`, `restart`,
    `collectLogs`, `destroy` (idempotent), `sweepOrphans`.
  - `SandboxBackend` — the Docker-only seam (create/start/execute/copy/
    writeFile/restart/logs/destroy/sweep). Held by the manager only; never
    exposed to agents.
  - `SandboxStore` — persistence for lookup + the reaper.
- **Application** (`application/services/sandbox-manager.service.ts`):
  orchestrates lifecycle with guarantees: unique scan-scoped ids
  (`sbx_<scanId>_<uuid>` — no collisions under concurrency), hard timeouts
  on create/exec, **analysis sandboxes can never egress** (forced `none`),
  runtime sandboxes default to `internal` with egress only via explicit
  allowlist, `destroy()` is idempotent + best-effort (cleans up even when
  the backend throws), failed creates auto-destroy, `applyPatch` writes
  through the backend (never to the host) then restarts, `sweepOrphans`
  reclaims crashed leftovers.
- **Docker layer** (`infrastructure/docker/`):
  - `docker-cli.ts` — argv-only `docker` runner (injectable for tests) + pure
    `buildCreateCommand` (hardened detached container: `--network none` or
    an internal per-scan network, `--read-only`, `--cap-drop ALL`,
    `--security-opt no-new-privileges`, non-root `--user`, memory/cpu caps,
    repo bind at `/workspace`).
  - `docker-sandbox-backend.ts` — the ONLY Docker-touching implementation:
    create (with internal network creation for runtime), start, isReady via
    inspect, exec (workdir + allowlisted env), copyFile, writeFile (temp file
    → `docker cp` → cleanup), restart, logs, destroy (container + network),
    sweep (labeled resources).
- **Store**: `infrastructure/store/memory-sandbox-store.ts` (headless tests;
  a Prisma store is a later swap).
- **Tests (+21 → 137):** manager with a fake backend (analysis egress
  forced off, runtime internal default + explicit egress, unique
  collision-free ids, waitUntilReady healthy/timeout, controlled exec,
  idempotent destroy, applyPatch→restart, orphan sweep), Docker backend
  with a fake docker runner (hardened create command, internal network
  creation, inspect readiness, exec shape, temp-file patch cleanup, destroy
  removes network), pure container-arg builders (network/caps/uid/limits/gVisor
  runtime), plus the existing process-sandbox tests.

### Challenges

- **Two execution models**: `ContainerSandboxRuntime` runs a throwaway
  container per command; the Manager needs a *long-lived* named container
  (exec/logs/restart over time). `buildCreateCommand` therefore creates a
  detached container kept alive (`tail -f /dev/null`) that the backend execs
  into — deliberate, and both models stay behind the same port family.
- **Network policy must be per-sandbox-type**: analysis is forced `none`;
  runtime needs siblings to talk (internal network) but no host egress;
  egress only when explicitly allowlisted. Enforced at the manager, not the
  backend.
- **Cleanup on crash**: `destroy()` alone is not enough — labeled resources
  (`amass.manager=1`, `amass.scan=…`) + `sweepOrphans()` are the reaper.
- **Testability without Docker**: every layer above the CLI is tested with
  fakes; `docker` itself is never required in CI.

---

## How to run / verify

```
cd backend
npx tsc --noEmit                 # must exit 0
npx vitest run                    # 204 tests green
npm run build                     # clean CJS emit
```
Tests are headless (they set their own `DATABASE_URL` via vitest config); the
API server itself needs a real `.env` (`DATABASE_URL` required).

---

## Milestone 10 ✅ — Pipeline through the Sandbox Manager

**Location:** `backend/src/sandbox/` + a shared scanner flow.

The static pipeline now genuinely *runs in a sandbox the manager owns*.
`SandboxedScanOrchestrator` (clone → analyze → scan → destroy) only ever talks
to the `SandboxManager`; no phase touches Docker/`child_process` directly.

### Built

- **`ProcessSandboxBackend`** (`infrastructure/process-sandbox-backend.ts`)
  — a real, no-Docker `SandboxBackend` that makes the manager usable headless:
  each sandbox is a throwaway workspace dir under a temp root; commands run via
  `ProcessSandboxRuntime` (argv-only, hard timeout, bounded buffer, `unshare
  --net` isolation, allowlisted env); `writeFile`/`copyFile` reject paths that
  escape the workspace; `destroy`/`sweep` reclaim the dirs.
- **`SandboxedScannerExecutor`** (`infrastructure/pipeline/`)
  — implements the static-scanner `ScannerExecutor` port by routing each
  scanner command through `manager.execute` (per-call egress honors each
  scanner's `networkAccess`).
- **`SandboxedScanOrchestrator`** (`application/services/`)
  — one ephemeral analysis sandbox per scan: create (egress allowlisted to the
  repo host so the clone can egress) → `manager.execute(git clone)` (network
  egress, the only sanctioned egress call) → analyze the sandboxed tree
  (trusted code, nothing from the repo is executed) → run the scanner suite
  with network `none` → `manager.destroy` in `finally` (reaper backstop).
- **`sandbox-factory.ts`** — composition root choosing the backend from
  `SANDBOX_RUNTIME` (`'process'` default, `'docker'` for host deploy).
- **Shared scanner flow** (`static-scanner/application/services/scan-flow.ts`)
  — extracted the deterministic tail (select → run → normalize → dedupe →
  persist → summarize) so the classic route and the sandboxed orchestrator
  share ONE code path (`ScanService` now delegates to it too).
- **Scanner factory** (`infrastructure/scanning/factory/scanner-factory.ts`)
  — single source of truth for the built-in scanner set, bound to whatever
  executor is in effect (direct or manager-routed). `scan.routes.ts` now uses
  it.

### A note on the manager network rule (refined)

`analysis` sandboxes **default to no egress**, but the clone step legitimately
needs egress. The manager now honors an **explicit, allowlisted `egress`** on
an analysis sandbox while enforcing that a **per-call `network` override can
never be more permissive than the sandbox policy.** Cloning is the single
sanctioned egress call; every scanner runs with `network: 'none'`.

### Fixed (bugs found while wiring)

- Manager was passing its own `id` to the backend instead of the resolved
  `containerId` for `execute`/`waitUntilReady`/`copyFile`/`applyPatch`/
  `restart`/`logs`/`destroy`. All backend calls now go through a containerId
  resolver (this used to break the long-lived-container path and made headless
  readiness poll forever).

### Proof (integration test)

`sandboxed-scan-orchestrator.test.ts` clones a REAL local git repo → analyzes
it in the sandbox tree → runs a probe scanner that executes `git rev-parse`
**inside the sandbox workspace** → persists the UVM → destroys the sandbox.
It asserts the manager surface was the gate (clone + scan exec ≥ 2 calls,
≥ 1 destroy) and that the sandbox workspace is empty afterwards.

---

## Milestone 11 ✅ — HTTP route runs in the sandbox

**Composition change, zero scanner-code change.** `scan.routes.ts` now builds
a `StaticScanGateway` port: `STATIC_SCAN_RUNTIME=sandboxed` (default) → the
controller calls `SandboxedScanGateway`, whose create runs the whole
clone→analyze→scan inside a manager sandbox (`SANDBOX_RUNTIME` picks the
backend); reads (overview/results/statistics) still go to `ScanService` over
the same Prisma repository. `STATIC_SCAN_RUNTIME=classic` keeps the old
preparer-cloned path as a fallback. Env vars documented in `.env.example`.

---

## Milestone 12 ✅ — Runnable end-to-end stack (Docker)

The backend now actually runs on real infra and the whole product loop is
verified **live against a real Postgres + Redis + Qdrant + Docker** (not just
headless tests).

### Added
- **`docker-compose.yml`** (repo root): `postgres` (with healthcheck + volume),
  `redis`, `qdrant`, and `backend` (built from `backend/Dockerfile`).
- **Initial Prisma migration** `backend/prisma/migrations/<ts>_init` generated
  against a real Postgres, so the schema is versioned and `prisma migrate
  deploy` applies on container start.
- Backend container runs `prisma migrate deploy` then serves the API; the
  Dockerfile HEALTHCHECK was pinned to `127.0.0.1` (busybox `wget` was
  resolving `localhost` → `::1`, which the IPv4-bound server refused).
- Root `.dockerignore` (build-context hygiene for the repo-root context).
- Root `package.json` `docker:*` scripts realigned to the actual compose file;
  README **Docker** section corrected to the working stack.

### Verified live (this workspace, Docker present)
```
docker compose up -d --build
curl POST /api/scan/static {"url":"https://github.com/octocat/Hello-World"}  → 201 COMPLETED
GET /api/scan/<id>(/statistics)                                   → reads from Postgres
GET /health                                                       → healthy (pg/redis/qdrant up)
docker compose ps                                                 → backend healthy
psql: select from scans → COMPLETED row persisted
```
Two real scans of public GitHub repos cloned through the sandbox, analyzed,
routed through the manager, and persisted — read back over the API. Stack
was verified then torn down (`docker compose down`); data volumes remain so
`docker compose up --build` brings it straight back.

---

## Milestone 13 ✅ — Scout Agent (reconnaissance)

Recon-only agent. Inputs: a source static-scan id + the running application URL.
Output: a persisted **Attack Surface Report** (endpoints, forms, admin panels,
technologies, ports, services, GraphQL/WebSocket signals, heuristic risk).
No exploitation, no payloads, no writes to the target.

### Module (`backend/src/scout/`, clean architecture)
- **domain** — models (`attack-surface`, `scout-scan`, `scout-report`), pure
  classifiers (`classification.ts`), errors, and 8 ports: `ScoutToolRuntime`
  (exec/probe seam), `Crawler`, `RobotsParser`, `TechnologyFingerprinter`,
  `PortScanner`, `EndpointDiscoverer`, `ScoutRepository`, `ScoutService`.
- **application** — `ScoutRecon` (guarded phases: crawl, robots, fingerprint,
  port scan, discover) + `DefaultScoutService` (orchestrator: context → health
  → phases → prioritize → persist → report) + `HeuristicAttackSurfacePrioritizer`
  (admin=HIGH, auth-upload=CRITICAL, public health/static/docs=LOW, api w/ params=MEDIUM).
- **infrastructure/tools** — `HttpCrawler` (same-origin BFS), `RobotsTxtParser`,
  `SignatureTechnologyFingerprinter`, `NmapPortScanner` (degrades when nmap is
  absent), `ScoutEndpointDiscoverer` (links/forms/robots/common-paths/GraphQL/
  WebSocket/docs), `DirectToolRuntime` (headless) + `SandboxToolRuntime`
  (CLI tools executed inside the target app's sandbox via the manager).
- **infrastructure/persistence** — `PrismaScoutRepository` (+ memory twin for tests).
- **presentation** — `POST /api/scout/run`, `GET /api/scout/:scoutScanId`,
  `/endpoints`, `/ports`, `/services`.

### Persistence (migration `scout_agent`)
`scout_scans`, `scout_attack_surfaces`, `scout_technologies`, `scout_services`,
`scout_ports` — all cascaded from `ScoutScan` → `Scan`.

### Safety
Recon is read-only: idle GET/HEAD probes, bounded bodies/timeouts, same-origin
crawl, no payloads, no brute force, tool failures degrade (never abort), runs
are isolated + concurrent, configurable timeout (`SCOUT_*` envs).

### Verified
- **183 tests green** (40 new: prioritizer, classifiers, robots, fingerprinter,
  crawler + discoverer against a live in-proc app, full-service recon run,
  tool-failure isolation, concurrency, controller).
- **Live in Docker**: `POST /api/scout/run` against a stack service → 201
  COMPLETED, 20 endpoints persisted, read back via `/endpoints` `/ports`
  `/services`; routes 404/validation paths verified; container healthy.

---

## Milestone 14 ✅ — Attack Planner (reasoning only)

The Planner is AMASS's prioritization stage: given a **Repository Profile** +
**Static findings** + **Attack Surface Report** for a scan, it decides *what to
test first*. It never attacks, scans, exploits or patches — it only reasons and
persists a ranked plan, with a transparent factor-level explanation for every
target (no black-box decisions).

### Inputs → Output
- Inputs: `RepositoryProfile` (language/stack) + static `UnifiedFindings` +
  the latest completed Scout surface report — all read through one repository port.
- Output: a persisted **Attack Plan** of sorted `PlannedTarget`s, each with the
  required shape: `targetId`, `endpoint`, `candidateVulnerabilities`, `priority`,
  `recommendedTool`, `reason`, `requiresAuthentication`, `estimatedRisk` — plus
  `breakdown` (every weighted factor) so scores are always explainable.

### Module (`backend/src/planner/`, clean architecture)
- **domain/models** — `plan.ts` (`PlannedTarget`, `AttackPlan`, summary,
  `ScoreFactor`), `plan-input.ts` (normalized static-vuln / surface / profile),
  `errors/planner.errors.ts` (`ScanNotFoundError`, `PlanNotFoundError`).
- **domain/ports** — `planner.ts` (`PlannerService`), `plan-repository.ts`.
- **application/scoring** — `feature-extractor.ts` (Surface→deterministic
  `TargetFeatures` + static-finding summarizer/classifier) and `target-scorer.ts`
  (deterministic weights: scout risk, endpoint type, auth, admin/upload/login,
  query params, DB-interaction, static severity, category overlap, framework;
  candidate-vuln hypotheses; `recommendedTool`; **explainable** `reason` +
  `breakdown`; risk rule: upload+auth always CRITICAL).
- **application/ranking** — `plan-engine.ts` (assign targets ids, sort highest
  priority first, compute summary buckets).
- **application/services** — `attack-plan.service.ts` (`generate(scanId)` loadsanner
  → reasons → persists; `plan(request)` pure; `getPlan` / `getPlanForScan`).
- **infrastructure** — `persistence/prisma-plan-repository.ts` (reads
  scan/vulnerability/scout tables, persists plan + targets via nested create),
  `factory/plan-factory.ts` (composition root), memory twin for tests.
- **presentation** — `dto/planner.dto.ts`, `controller/planner.controller.ts`,
  `routes/planner.routes.ts`. Endpoints: `POST /api/planner/run {scanId}`,
  `GET /api/planner/plans/:planId`, `GET /api/planner/plans/:planId/targets`,
  `GET /api/planner/scans/:scanId`.

### Persistence (migration `attack_planner`)
`attack_plans` (scan-scoped, cascaded, summary json) + `planned_attack_targets`
(per-target fields + `breakdown`/`candidateVulnerabilities` json).

### Safety
Planner is a pure/read-mostly reasoner: loads existing DB rows, ranks in memory,
persists the plan. No probing, no code exec, no attack execution, no patch
generation. Missing recon yields an empty plan (never throws); unknown scan → 404.

### Verified
- **204 tests green** (21 new: scorer explainability + priority + upload-auth
  CRITICAL rule, engine sorting/summary/spec `/api/search`, service generate/
pure/missing-scan/empty-recon, controller routes + 404/validation).
- **Live in Docker**: `POST /api/scan/static` → `POST /api/scout/run` (20
  surfaces) → `POST /api/planner/run` → 201 plan, 20 ranked targets (upload
  endpoints MEDIUM with `Insecure File Upload` hypothesis, admin MEDIUM,
  public assets LOW), read back via `/planner/plans/:id` + `/planner/scans/:id`;
  rows confirmed in Postgres (`attack_plans` 1 / `planned_attack_targets` 20);
  stack torn down.

---

## Milestone 15 ✅ — Sniper Agent (controlled exploit verification)

**Scope:** Sniper performs **controlled exploit verification inside an isolated
runtime sandbox**. It takes the Planner's ranked `PlannedTarget`s for a scan and
proves or disproves them (SQL Injection today; XSS/SSRF/etc. are future
verifier implementations behind the same `VulnerabilityVerifier` port). It is
**not a general-purpose penetration-testing engine**: it never generates new
attacks, never bypasses authentication, never guesses credentials, and can only
touch the sandboxed app instance it is given. Deterministic end-to-end (no
LLM in the decision path).

### Input → Output
- Inputs: `scanId`, `sandboxId`, `baseUrl` (in-sandbox app URL),
  `targetIds` (planner-synthesized) + optional explicit credentials.
- Output: `ProofOfConcept` per target — `NOT_TESTED / TESTING / CONFIRMED /
  NOT_CONFIRMED / INCONCLUSIVE / FAILED` + weighted confidence with a
  per-factor breakdown (tool confirmation, reproducibility, response behavior,
  static correlation, reachability) + reviewer evidence items.

### Module (`backend/src/sniper/`, clean architecture)
- **domain/models** — `verification.ts` (states/categories/factors/target,
  context, outcome, PoC, attempt), `vulnerability-type.ts`; ports
  (`vulnerability-verifier`, `tool-runtime`, `sniper-repository`,
  `sniper-service`); `errors/sniper.errors.ts`.
- **application/services** —
  - `sniper.service.ts` — facade: sandbox pre-flight (`getSandbox` +
    scan-match), bounded concurrency (`BoundedExecutor`), per-target outcome
    isolation, run report + read-back queries (refactored from the original
    518-line file down to <300).
  - `sniper-run.ts` — per-target pipeline: target/scan validation →
    same-origin enforcement (`target-origin`, cross-origin ⇒ NOT_TESTED) →
    pick supported type → auth gating (explicit credentials only) → seed
    TESTING row → attempt loop → final persist; refusals never crash a run.
  - `attempt-loop.ts` — bounded retry loop: hard attempt cap, retry only
    transient outcomes (CONFIRMED/NOT_CONFIRMED/NOT_TESTED are terminal),
    per-attempt persistence, backoff + logging.
  - `confidence-scorer.ts` (deterministic weighted factors),
    `sqlmap-classifier.ts` (parsed → verdict + retryable flags),
    `target-origin.ts`, `bounded-executor.ts`.
- **infrastructure** — `tools/sqlmap/` (argv builder with hard bounds — no
  `--dump`/`--os-shell`/tamper; parser; redactor — redact + truncate before
  persistence), `tools/sandbox-tool-runtime.ts` (all exploit commands go
  through the SandboxManager — **no Docker import in the agent**),
  `verifiers/sql-injection/sql-injection-verifier.ts` + `verifier-registry.ts`
  (future types register here), `repository/prisma-sniper-repository.ts` +
  `repository/sniper-mappers.ts` (pure row→domain mappers; repository <300),
  `factory/sniper-factory.ts`.
- **presentation** — Zod DTO + controller + routes
  (`POST /api/sniper/run`, `GET /api/sniper/:id`,
  `GET /api/sniper/:id/results`, `GET /api/sniper/targets/:targetId`,
  targets route registered BEFORE `/:id`).

### Persistence (migrations `sniper_agent` + `sniper_finalize`)
`exploits` extended (scan/target identity + verification fields,
`vulnerabilityId` nullable SetNull) + `verification_attempts` (per-attempt
record; final status lives on `Exploit`) + `exploit_evidence`; FKs cascade.
`sniper_finalize` drops the unused legacy columns (`proofOfConcept`,
`attackVector`, `impact` — no code referenced them) and aligns the `endpoint`
default with the schema.

### Safety
Sandbox-gated (no Docker imports in the agent; SandboxManager is the only
Docker owner), same-origin enforcement, auth-gating (explicit credentials
only, never bypass/brute), bounded timeouts/retries (transient only)/
concurrency, redacted + truncated evidence, deterministic explainable
confidence. Scope is strictly **validation of Planner-supplied candidates** —
no new exploitation capabilities.

### Verified (after the file-size refactor)
- **251 tests** (46 sniper: parser, argv, redaction, classifier, confidence
  scorer, verifier, service orchestration incl. concurrency cap + retry
  persistence + cross-origin/auth refusals, controller validation; existing
  suites stay green).
- **Docker + Postgres E2E re-run** (`SNIPER_E2E=1`): ephemeral Postgres +
  `prisma migrate deploy` → real `AttackPlanService` → real hardened Docker
  sandbox (sqlmap + intentionally-vulnerable SQLite app, internal network) →
  real `DefaultSniperService` → **CONFIRMED** (`boolean-based blind,
  time-based blind, UNION query`), `Exploit` CONFIRMED with
  `VerificationAttempt` + `ExploitEvidence` rows in Postgres; sandbox/PG
  torn down (prisma now disconnects before the ephemeral PG is removed —
  the spurious `prisma:error Closed` at teardown is gone).

### Fixed along the way
- `SandboxManagerService.createSandbox` started the backend with the sandbox
  id instead of the container id (latent bug — the Docker backend exercised it
  for the first time). `getSandbox` / `healthCheck` added to the manager port.
- `prisma migrate deploy` failed because the sniper migration re-created
  `exploits_status_idx` (already created by init) — removed the duplicate.
- `Exploit.attacks` was hardcoded/DB-missing; the Prisma repository now counts
  real `VerificationAttempt` rows via `_count`.
- File-size house rule (all impl files `< 300`): `sniper.service.ts`
  518 → 156 (extracted `sniper-run.ts` 295 + `attempt-loop.ts` 156),
  `prisma-sniper-repository.ts` 307 → 204 (extracted `sniper-mappers.ts`).
- E2E teardown now disconnects the prisma engine before removing the
  ephemeral Postgres — no more `prisma:error Error { kind: Closed }` noise.

---

## Milestone 16 ✅ — Runtime Sandbox Lifecycle (Phase 6)

**Scope:** a first-class runtime-sandbox provisioning/lifecycle capability —
the missing link that turns a repository scan into a running, isolated app
instance the agent pipeline (Scout → Planner → Sniper) can consume. Built as
an **extension of the existing Sandbox Manager** (still the ONLY Docker
owner): Repository → ephemeral workspace → deterministic image build (Mode 1
repo Dockerfile / Mode 2 python+node templates) → hardened container on an
internal-only network → TCP+HTTP health-gated READY → agents consume a
**read-only `RuntimeSandbox` context** → destroy/expire with full resource
reclamation and structured errors.

### HTTP API (`/api/runtime-sandboxes`)
- `POST /` — provision (scanId + repository url|path + optional name, portOverride,
  hostExpose). 201 → READY record; **429** capacity; **422** structured creation
  failure (FAILED record carried in `details`), **422** unsupported runtime;
  400 validation.
- `GET /:id?scanId=` — read (optional ownership scope → 403).
- `POST /:id/health` — re-verify TCP+HTTP liveness. Registered BEFORE `/:id`
  so it can never be shadowed.
- `DELETE /:id` — destroy (idempotent), reclaims container + network + image + workspace.

### Module (`backend/src/sandbox/…`)
- **domain** — `entities/runtime-sandbox.ts` (status machine, live/terminal sets),
  `errors/runtime-sandbox.errors.ts` (`RuntimeSandboxCapacityError`,
  `RuntimeSandboxCreationError` w/ stage, `UnsupportedRuntimeError`,
  NotFound/Forbidden, `InvalidRuntimeRepositoryError`), ports: `runtime-sandbox-service`,
  `-store`, `-registry`, `-scan-gateway`, `-workspace-provider`, `runtime-health-prober`,
  value-objects `runtime-config.ts` (bounded `ResourceLimits`, defaults;
  `HealthProbeResult`).
- **application** — `runtime-sandbox.service.ts` (lifecycle orchestrator),
  `runtime-sandbox-provisioning.ts` (hardened container request + bounded probe
  retries), `runtime-sandbox-state.ts` (seed/patch/log/ownership), `runtime-sandbox-utils.ts`
  (stage classification map), `runtime-config-resolver.ts` (Mode 1 / Mode 2 / UNSUPPORTED),
  `runtime-env-builder.ts` (allowlist-only env), `runtime-cleanup.ts` (coordinator:
  container → image → workspace, never throws).
- **infrastructure** — prisma repository + scan gateway, in-memory registry
  (slot at CREATING, released on terminal — no silent queues),
  `FsRuntimeWorkspaceProvider` (transport not execution; skips `node_modules/.git/.venv`),
  `TcpHttpHealthProber` + wired factory.
- **presentation** — Zod DTO + controller (error mapping incl. CapacityError→429)
  + routes.
- **manager/backend extensions** — `buildImage`/`removeImage`/`inspectRuntimeContainer`
  + `buildCreateCommand` hardening:`mountRepository:false` ⇒ **no host mount**,
  explicit `--env` only, `--pids-limit`, `appCommand: []` ⇒ image CMD, `-p 127.0.0.1::port`
  dynamic localhost publish (never `0.0.0.0`); idempotent `ensureNetwork` for
  sibling sandboxes on the per-scan internal network.
- **prisma** — `RuntimeSandbox` model + status enum + migration
  `20260808143328_runtime_sandbox` (indexes scanId/status/expiresAt);
  config gains `SANDBOX_*` vars (env + zod bounds, `runtimeSandboxConfig`).

### Safety properties (tested)
- Runtime app containers: internal-only egress by default; host exposure only via
  `127.0.0.1` + dynamic port; no host mounts; no host env passthrough (explicit
  allowlist only — documented decision); bounded CPU/memory/PIDs/timeouts/concurrency
  (capacity errors are 429s, never silent queues); image build through the manager;
  workspaces are ephemeral copies, repository payload is never executed on the host.
- Any failure → FAILED record + failureStage + collected logs + full cleanup
  (container rm + image rm + workspace rm); cleanup never throws; destroy/expire
  idempotent.
- Agents never create/destroy sandboxes; they receive read-only contexts (Sniper
  already executes only through the manager).

### Verified
- **293 tests collected** (289 default-pass + 4 gated), the headless suite
  stays green, tsc/build clean, all impl files < 300 lines.
- **Docker + Postgres E2E** (`RUNTIME_SANDBOX_E2E=1`, host port 15432 so the
  dev compose DB is never touched): vulnerable app repo → Mode 2 build →
  READY with TCP+HTTP health → host-reachable `/search?q=1` → live Scout
  discovers `/search` → Planner synthesizes the target → Sniper (sqlmap in a
  sibling toolbox sandbox on the same internal net) → **CONFIRMED**, `Exploit`
+ `ExploitEvidence` in PG → destroy → zero containers/networks/images/workspaces
left + record DESTROYED. Also: Mode 1 (repo Dockerfile) works; unsupported
runtime → FAILED with no leftovers; `cleanupExpired` reclaims backdated
sandboxes and frees capacity.

### Fixed along the way
- `docker run --rm --workdir /tmp` broke image-CMD apps (`python app.py` resolved
  against /tmp and crashed → "marked for removal" on start): runtime containers now
  omit `--workdir` so the image's own WORKDIR governs.
- Mode-1 `-f Dockerfile` resolved against the process CWD (the backend dir!), not
  the build context — the service now joins the dockerfile to the copied workspace.
- Health probe 200ms race with app bind (container reports running before the port
  listens): bounded re-probing (max 4 attempts × 750ms) added before READY.
- E2E suite hygiene: pre-suite sweep + `try/finally` teardown + afterAll hard
  sweep; ephemeral PG moved to host port 15432 so suites don't fight the dev DB.

---

## Open / deferred items (optional follow-ups)
- **Runtime sandboxes through the HTTP API end-to-end**: M16 wires the
  lifecycle + the Sniper consumption (E2E proves it); next is the UI/scan-flow
  wiring that reaches `POST /api/sniper/run` with the provisioned sandboxId.
- **Planner/Scout consumption of `targetUrl`** from the runtime-sandbox record
  (today the E2E passes the URL explicitly).
- **Live-container end-to-end verification** (Docker host): run `/api/scan/static`
  with `SANDBOX_RUNTIME=docker` and watch per-scan containers appear/destroy.
- **Runtime sandboxes for post-static phases** (run the app, dynamic checks,
  exploit validation; internal net + DB/Redis + test data), then the
  Scout/Sniper/Engineer/Critic agents consuming only the manager surface.
- **Live-container verification**: `DockerSandboxBackend` + `ContainerSandboxRuntime`
  are unit-tested against fake runners; real `docker run`/gVisor execution
  needs a host runtime (deploy-time).
- **Prisma `SandboxStore`** (persist sandbox records across restarts; the
  in-memory store is for headless runs).
- **Image-build guardrails** for runtime sandboxes (digest-pinned base images,
  `--network=none` builds, resource caps) — building from untrusted repos is
  the riskiest path and is NOT yet enabled.
- **Agent adoption**: Scout/Sniper/Engineer/Critic must use only the Manager
  surface (`execute`/`applyPatch`/`collectLogs`); never raw exec/Docker.
- **Offline scan data**: npm/pip-audit declare `networkAccess: true`. For fully
  air-gapped deploys, vendor local advisory DBs so egress can stay `none`.
- **DB wiring / containers**: a Postgres container so the running API can
  actually use `PrismaScanRepository` (`DATABASE_URL`). Then an end-to-end
  **HTTP integration test** for `/api/repositories` and `/api/scan/*`.
  DB-dependent code is compile- and unit-verified only (no DB in CI).
- **git init** in the `repository-analysis/` folder (git history for the module).
- **ESLint config** — `backend/.eslintrc` missing, so `npm run lint` is
  currently a no-op (observed as pre-existing).
- **Module barrel exports** — `index.ts` for `repository-analysis`, `static-scanner`, `sandbox`.
- **Profiles still not persisted** (analyzer returns them as JSON only).
- **Mounting next agents** (Scout / Sniper / Engineer / Critic) —
  `RepositoryProfile` is the typed handoff for them; `ScanResult`/UVM is the
  typed handoff for Sniper.
- **Scout/Critic/Engineer wiring to the LLM provider** — the free-first
  provider module (M17) exists headless; agent prompts/consumption (incl.
  prompt versioning and Qdrant RAG retrieval behind the same seam) awaits
  explicit direction on the next agent milestone.

---

**(See the Milestone 9 section above — the six corrections you approved are
implemented: typed ops (no raw agent exec), no Docker socket in the API
(backend seam holds it), layered on the existing SandboxRuntime port,
reaper-based cleanup, per-type network policy, applyPatch→restart→validate.)**

---

## Milestone 17 ✅ — LLM Provider Abstraction (free-first)

**Scope:** the provider-agnostic LLM seam the agents (Scout/Planner/Sniper and
future Engineer/Critic) will use — free-first, meaning **zero paid providers
are required**. Preferred provider order: **Gemini → OpenRouter → Groq →
Mistral**; Gemini is the default primary (its model is configuration-only —
nothing is baked in). OpenRouter's `openrouter/free` alias routes to whatever
free model is available right now; the app never stores assumptions about
which concrete model that is. At least one configured provider must have a
key; nothing else is mandatory. OpenAI/Anthropic are never required.

### Module (`backend/src/llm/`, clean architecture)
- **domain** — `ports/llm-provider.ts` (`LLMProvider` interface:
  generate / healthCheck / getModelInfo; `LLMRequest/Response/Usage`, `ModelInfo`
  with `freeAlias`), `ports/llm-config.ts` (`LLMProviderConfig`), `errors/llm.errors.ts`
  (stable-code taxonomy: CONFIG/AUTH/MALFORMED_REQUEST/POLICY/RATE_LIMIT/
  MODEL_UNAVAILABLE/UNAVAILABLE/TIMEOUT/RESPONSE + `isFallbackEligible`).
- **application** — `fallback-llm-provider.ts` (bounded coordinator) +
  `llm-usage-recorder.ts` (in-memory ledger: provider/model/tokens/cost/duration/
  status per call — the data for later latency/token/success comparisons).
- **infrastructure** — `http/openai-compatible-client.ts` (shared
  HTTP/retry/recording substrate, 235 lines) + `openai-compatible-parse.ts`
  (pure wire parsing + error classification, 166 lines); thin adapters
  `providers/gemini|openrouter|groq|mistral-provider.ts` (Gemini rides Google's
  official OpenAI-compatible endpoint — no Gemini SDK); `factory/llm-provider-factory.ts`;
  `redact/redactor.ts` (sk-/xr-/AIza-key, Bearer, base64, assignment redaction
  + bounded prompt summaries — never log keys or full prompts).
- **config** — `LLM_PROVIDER` (default `gemini`), optional
  `LLM_PRIMARY_PROVIDER` (overrides `LLM_PROVIDER` when set), `LLM_MODEL`
  (`openrouter/free` default), `LLM_TEMPERATURE`, `LLM_MAX_TOKENS`,
  `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES` (0-5, bounded), `LLM_FALLBACK_PROVIDERS`
  (comma list), per-provider `GEMINI|OPENROUTER|GROQ|MISTRAL_API_KEY` and
  `…_MODEL` overrides — all zod-bounded, nothing hardcoded in app logic.
  The `openrouter/free` alias is rejected (clear config error) on any
  non-OpenRouter provider — a concrete model is required there.

### Free-first & fallback policy (tested)
- Factory fails with a **clear config error** on unsupported providers or a
  missing key for any configured (primary or fallback) provider — no silent
  skips, no paid-API assumption.
- Fallback escalates ONLY on RATE_LIMIT / UNAVAILABLE / MODEL_UNAVAILABLE /
  TIMEOUT. AUTH, CONFIG, MALFORMED_REQUEST (incl. context-too-long), POLICY
  and RESPONSE (unparseable) errors rethrow immediately — they would repeat
  elsewhere or mask application bugs.
- Bounded at every level: max 5 internal retries (exponential backoff ≤ 4s);
  fallback walks the configured list exactly once; no loops, no unbounded wait.
- Cost: `estimatedCost` is 0 unless the provider reports a figure (OpenRouter
  does for paid models); AMASS never invents pricing. Token counts fall back
  to a char/4 estimate when omitted, cost stays 0.

### Security (tested)
- No provider SDKs — plain `fetch`; `Authorization: Bearer` never logged;
  error details are redacted (providers can echo request content in errors);
  `redactSensitive()` masks sk-/xr-keys, Bearer tokens, `key=value`/`key: value`
  assignments and long base64; prompt logs are bounded role+head summaries
  (repository source code never ships wholesale to logs — and callers are
  responsible for sending only the necessary source to providers).

### Verified
- **57 LLM tests** (all HTTP mocked — the default suite requires no provider,
  no keys, no network): success+usage/cost, JSON mode body shape,
  auth/policy/malformed (no-fallback), rate-limit/model-unavailable/5xx/
  network/timeout (retry+fallback), retry budgets, key hygiene, healthCheck,
  factory selection (Gemini default + every provider) + config errors
  (missing key, unsupported id, `openrouter/free` sentinel on other
  providers), bounded fallback (stubs), ledger, redactor, zod env defaults
  (`LLM_PROVIDER=gemini`, `LLM_PRIMARY_PROVIDER` precedence).
- **Phase 7A provider adjustment (Gemini primary)**: provider id union +
  preferred order `gemini → openrouter → groq → mistral`; `GeminiLLMProvider`
  over the shared substrate (official OpenAI-compatible endpoint); new env
  `LLM_PRIMARY_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`; Gemini key prefix
  (AIza…) added to the redactor; e2e gate `LLM_GEMINI_E2E=1`. RAG / Qdrant /
  CVE ingestion / embedding / prompt / AgentExecution / Engineer / patch /
  LangGraph were NOT touched (per the 7A scope).
- Opt-in live smoke tests `test/llm-provider-e2e.test.ts` gated on
  `LLM_GEMINI_E2E=1`/`LLM_OPENROUTER_E2E=1`/`LLM_GROQ_E2E=1`/`LLM_MISTRAL_E2E=1`
  (+ matching key; skipped by default).
- `tsc`/`build` clean; defaults green: **346 passing / 8 skipped (354
  collected)**; all implementation files < 300 lines.

## Milestone 18 ✅ — Knowledge ingestion + RAG foundation (Phase 7A)

**Scope:** the AI/RAG foundation — an independent embedding line, a single
Qdrant-backed knowledge store, NVD CVE ingestion, RAG retrieval, a file-backed
prompt registry, the agent-facing context model, and a sanitizing
AgentExecution record service. Engineer/Critic/patch-generation/LangGraph
remain **NOT built** (still unsanctioned); the LLM provider layer was **not
touched** (it is already complete).

### Module layout (clean architecture)
- **`src/embedding/`** — `EmbeddingProvider` port (embedText/embedBatch/
  dimensions), error taxonomy (CONFIG/AUTH/UNAVAILABLE/TIMEOUT/RESPONSE/
  DIMENSION_MISMATCH), `OpenAICompatibleEmbeddingClient` fetch substrate
  (no SDKs; bounded retries, dimension validation, redacted errors),
  `GeminiEmbeddingProvider` (official OpenAI-compatible endpoint, configurable
  model default `text-embedding-004`), `EmbeddingProviderFactory` (clear
  `EmbeddingConfigError` on missing key/unsupported provider). This is a
  SEPARATE config axis from the LLM providers.
- **`src/knowledge/`** — domain: `KnowledgeDocument` (normalized model,
  bounded content), `KnowledgeSource` port, `KnowledgeVectorStore` port
  (no Qdrant/HTTP types leak), `CveRepository` port, stable-code errors.
  Application: `cve-normalizer` (NVD v2.0 → CVERecord + KnowledgeDocument,
  pure), `DefaultCveIngestionService` (exact flow: NVD → validate → normalize
  → upsert CVERecord → embed → upsert Qdrant; idempotent by cveId + stable
  point id; skips malformed with a counter; embedding failure fails loudly),
  `RagService` (query validation, topK bounds, metadata filters, ranked
  results, full content resolved from CVERecord, no provider types leak).
  Infrastructure: `QdrantClient` (THE single TS Qdrant client — fetch-based,
  collection CRUD + points; the Python `QdrantService` is untouched and is
  the only other Qdrant contact in the repo), `QdrantKnowledgeStore`,
  `NvdKnowledgeSource` (official NVD REST v2.0; bounded paging/maxItems/
  retries on 429/5xx; lastMod window for incremental), `PrismaCveRepository`
  (upserts the EXISTING `CVERecord` model — no new tables/migrations),
  `knowledge-factory` (lazy wiring), plus DTO/controller/routes.
  Centralized collection config: single collection `amass_security_knowledge`;
  payload carries only small metadata (sourceType/cveId/vulnerabilityType/
  severity/language/framework/sourceUrl).
- **`src/prompts/`** — `PromptRegistry` port + `FileSystemPromptRegistry`
  ({root}/{version}/{scope}/{name}.md, cached, typed errors). Templates live
  in `backend/agents/prompts/v1/engineer/`:
  `system.md`, `patch-generation.md`, `rag-context.md`, `security-review.md`.
  The registry NEVER invokes an LLM.
- **`src/agent/`** — `AgentScanContext` (agent-facing, all-optional except
  scanId; reuses `RuntimeSandboxContext` + `RepositoryProfile` + `AttackPlan`
  types; no Docker internals) and `DefaultAgentExecutionService` + Prisma repo
  reusing the EXISTING `AgentExecution` model (no schema change; sanitizes
  metadata BEFORE persistence: sensitive keys → `[REDACTED]`, values
  truncated, no huge blobs, no raw source shipping).

### HTTP API
- `POST /api/knowledge/cve/ingest` → 201 summary {fetched, inserted, updated,
  malformed, embedded, hasMore} (validation 400, source error 502/503).
- `GET /api/knowledge/cve/:cveId` → CVERecord or 404.
- `POST /api/rag/search` → ranked documents (filters: severity / cveId /
  vulnerabilityType / sourceType / language / framework — whitelisted only).

### Config (zod-bounded, clear errors)
`EMBEDDING_PROVIDER`/`_MODEL`/`_DIMENSIONS` (64–8192, default 768),
`KNOWLEDGE_QDRANT_URL/API_KEY/COLLECTION/TIMEOUT_MS`,
`KNOWLEDGE_NVD_BASE_URL/PAGE_SIZE/MAX_PAGES/TIMEOUT_MS/MAX_RETRIES/
RETRY_DELAY_MS`, `RAG_TOP_K_MAX`/`RAG_DEFAULT_TOP_K`, `PROMPTS_ROOT`.

### Security
- Knowledge/repo/LLM outputs are UNTRUSTED DATA: never executed; retrieved
  docs carry content+metadata only and can never override system instructions
  (the rag-context template makes this explicit); logs redacted; keys never
  logged; no secrets stored in AgentExecution.

### Verified
- **~70 new tests** (mocked HTTP / in-memory fakes; default suite needs no
  keys, no Docker, no network): embedding factory+substrate (auth/timeout/
  network/dims/redaction), qdrant client (create-idempotent/upsert/search/
  filter/delete/errors), normalizer (severity ladder, CWE dedup, non-http
  refs, malformed → typed error), NVD source (paging/maxItems/malformed
  count/429 retry/5xx exhaustion/4xx fast-fail), ingestion service
  (pipeline, idempotent re-run, malformed skip, loud embed failure),
  RAG (validation, deterministic retrieval-quality fixture — “SQL injection
  in Python Flask” ranks CVE-2024-1280 first among lookalike/unrelated docs;
  score ordering, filters, dedup, no type leak), prompt registry (versioned
  lookup, NotFound/Version errors, caching, fs-only), AgentScanContext
  (minimal/optional fields, scanId guard), AgentExecution (redaction,
  truncation), controller (400/201/200/404 + response shape), acceptance
  test (fixture pipeline + real prompts + context) — and opt-in live gates
  `RAG_NVD_E2E=1`, `RAG_QDRANT_E2E=1`, `RAG_EMBEDDING_E2E=1`.
- `tsc`/`build` clean; default suite: **429 passing / 8 skipped (437
  collected)**, 72 passed files; all implementation files < 300 lines (max
  204).

### Not built (per scope)
Engineer / Critic / patch generation / LangGraph orchestration /
autonomous command execution / new vulnerability classes / Kubernetes /
Redis. LLM module unchanged.

## Milestone 19 ✅ — Engineer Agent — draft remediation (Phase 7B)

**Scope:** the first remediation stage. Takes **CONFIRMED SQL Injection**
findings from Sniper and produces **draft** patches as `Patch` rows with
`status=GENERATED | REJECTED` — validated, security-gated, **never applied**.
Restricted to the single supported class (`SQL_INJECTION`); no Critic, no
auto-apply, no new vuln classes, no LangGraph, no new LLM providers, no new
Qdrant clients, no new Docker abstractions. The LLM module was **not
touched**; knowledge/RAG and prompts were reused as-is.

### Module layout (clean architecture)
- **`src/engineer/domain/`** — `engineer-response.ts` (strict
  `EngineerResponse` model + bounds: maxDiffChars/maxPatchFiles/
  maxExplanationChars/maxAssumptions), `repo-path.ts` (safe relative-path
  normalization + traversal/absolute/drive-letter rejection), errors
  (`ConfirmedFindingNotFoundError`, `UnsupportedVulnerabilityError`,
  `InvalidEngineerResponseError`, `EngineerSourceError`), ports:
  `confirmed-finding-repository.ts` (findByVulnerabilityId / listConfirmed —
  the ONLY way the Engineer sees Sniper findings), `patch-repository.ts`
  (`saveGeneratedPatch` — the ONLY writer, over the EXISTING Prisma `Patch`
  model; no migrations), `source-reader.ts` (typed read-by-path seam with
  size/line bounds — the ONLY way the Engineer reads repository source).
- **`src/engineer/application/`** —
  - `engineer-selection.ts` — deterministic candidate pick: filter
    `status=CONFIRMED` + `type=SQL_INJECTION`, sort severity → confidence →
    exploit depth → stable id.
  - `source-window.ts` — bounded line window around the finding line.
  - `rag-query-builder.ts` — focused SQLi RAG query (whitelisted metadata
    filters) + advisory rendering; purely advisory, never blocks.
  - `prompt-assembler.ts` — loads all four `v1/engineer/*.md` templates via
    the existing PromptRegistry and builds bounded system/user messages.
  - `response-validator.ts` — parse (code-fence tolerant) + structural
    validation: matching vulnerabilityId, single in-scope file, unified
    diff shape, path-traversal/absolute-path rejection, size bounds.
  - `security-review-gate.ts` — deterministic checklist using the
    `engineer.security-review` template (secrets, unsafe commands,
    out-of-scope paths, malformed diffs).
  - `engineer-run-context.ts` — resolveFinding / resolveSandboxContext
    (existing runtime store) / readSource / retrieveRag / tryParseJsonObject.
  - `engineer-outcome.ts` — persist GENERATED|REJECTED via the patch
    repository port + record COMPLETED/FAILED AgentExecutions (bounded
    error text, sanitized metadata).
  - `engineer.service.ts` — thin orchestrator (run/getRun; ~170 lines).
- **`src/engineer/infrastructure/`** — `prisma-patch-repository.ts` and
  `prisma-confirmed-finding-repository.ts` (reuse existing models),
  `manager-source-reader.ts` (the ONLY source seam — `wc -c` size probe
  followed by `cat` via the existing SandboxManager; no raw Docker),
  `engineer-factory.ts` (wires Prisma + manager + RAG + registry + LLM +
  executions). Presentation: DTO + controller + routes at `/api/engineer`.

### HTTP API
- `POST /api/engineer/run` — `{scanId, vulnerabilityId?}` → run result
  {executionId, vulnerabilityId, patchId, status, summary} (400 invalid,
  404 no confirmed finding, 422 unsupported/invalid response, 502 source
  unavailable, 500 otherwise — all recorded as FAILED executions).
- `GET /api/engineer/:executionId` — the sanitized `AgentExecution` detail.

### Config (zod-bounded)
`ENGINEER_MAX_SOURCE_BYTES` (64k), `_MAX_CONTEXT_LINES` (150),
`_DEFAULT_CONTEXT_WINDOW` (12), `_MAX_DIFF_CHARS` (16k),
`_MAX_PATCH_FILES` (3), `_RAG_TOP_K` (4); `ENGINEER_E2E=1` live gate.

### Security
- Model output is UNTRUSTED: parsed → structurally validated → gated →
  persisted as GENERATED only after the review gate passes; never executed,
  never applied (`applyPatch` is off-limits in 7B).
- Source read is bounded (size probe + line window) and path-validated
  (absolute/traversal/drive letters rejected; backslash normalized).
- AgentExecution metadata sanitized before persistence; error messages
  capped at 2000 chars; secrets never logged.

### Verified
- **~74 new tests** in `src/engineer/**` + acceptance (`test/engineer-acceptance`)
  + opt-in live gate `test/engineer-e2e` (`ENGINEER_E2E=1`): selection
  (determinism, type/status filter), source-window/RAG-builder, prompt
  assembler (real registered templates), response validator (malformed,
  wrong id, traversal, unrelated file, bounds, REJECTED), security gate
  (secrets/dangerous commands/out-of-scope), manager-source-reader (argv
  protocol, size/line caps, path rejection), engineer.service (full
  GENERATED path with programmed LLM, REJECTED path, RAG-outage
  tolerance, no-sandbox and failure paths, no-apply invariant, secrets
  never persisted, FAILED recording, getRun), controller (400/200/404/422
  mapping), acceptance (fixture pipeline end-to-end). Default suite needs
  no keys/Docker/network.
- `tsc`/`build` clean; **73+ engineer tests pass**; implementation files
  < 300 lines (service 170, outcome 128, assembler 189, validator 202).

### Not built (per scope)
Critic / auto-apply (`applyPatch`) / new vulnerability classes / XSS-SSRF-
inherit-command-injection amplification / LangGraph orchestration / new
providers / new Qdrant clients / Kubernetes / Redis. `Patch` rows produced
in 7B are drafts only — nothing in the pipeline consumes or applies them.
