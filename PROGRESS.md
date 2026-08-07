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

- **Total tests:** 105 passing across 24 test files
  (analyzer 18+17+5+6+16+5=67 + static-scanner 38, incl. the full GitHub → Analyzer → Static Scanner → UVM chain test).
- `npx tsc --noEmit` → exit 0 · `npm run build` → clean · compiled CJS loads.
- All implementation files are `< 300` lines (max = 253, file-system-analyzer).
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

## How to run / verify

```
cd backend
npx tsc --noEmit                 # must exit 0
npx vitest run                    # 105 tests green
npm run build                     # clean CJS emit
```
Tests are headless (they set their own `DATABASE_URL` via vitest config); the
API server itself needs a real `.env` (`DATABASE_URL` required).

---

## Open / deferred items (optional follow-ups)
- **Harden**/*isolation* of the scanner tool processes at deploy time: the
  executor already uses `execFile` (argv, no shell) and a minimal env — a
  future container could mount scanner binaries read-only / sandbox them.
- **DB wiring / containers**: a Postgres container so the running API can
  actually use `PrismaScanRepository` + `PrismaRepositoryProfile`
  (`DATABASE_URL`). Then an end-to-end **HTTP integration test** for both
  `/api/repositories` and `/api/scan/*`. Current DB-dependent code is compile-
  and unit-verified only (no DB in CI).
- **git init** in the `repository-analysis/` folder (git history for the module).
- **ESLint config** — `backend/.eslintrc` missing, so `npm run lint` is
  currently a no-op (observed as pre-existing).
- **Module barrel exports** (`index.ts`) for `repository-analysis` and
  `static-scanner`.
- **Profiles still not persisted** (analyzer returns them as JSON only; only
  the scanner persists `Scan`/`Repository`/`Vulnerability`). Optional: persist
  profiles too.
- **Mounting next agents** (Scout / Sniper / Engineer / Critic) —
  `RepositoryProfile` is the typed handoff for them; `ScanResult`/UVM is the
  typed handoff for Sniper.
- Next **Scout agent** (Python/FastAPI/LangGraph) requires LLM keys + Qdrant
  — deferred to a later phase, awaiting explicit direction.