# AMASS Research Benchmarks

Evaluation artifacts for the AMASS research paper: a **ground-truth corpus of
vulnerable applications** and a **metrics collector** that turns durable scan
artifacts into paper-ready numbers.

```
benchmarks/
  corpus.schema.json     JSON Schema for the corpus document
  corpus.json            Ground truth: apps, provisioning specs, known vulns
  README.md              this file
backend/
  src/benchmarks/        Corpus loader + ground-truth matching engine (tested)
  scripts/collect-metrics.ts   CLI collector (reads Postgres, scores vs corpus)
```

## The corpus (`corpus.json`)

Each app entry declares:

| field | meaning |
|---|---|
| `id` / `name` | stable id + display name (id may appear in Scan names) |
| `repoUrl` | git URL — the join key to `ScanRepository.repository.url` |
| `ref` | pinned commit/branch for reproducible runs |
| `runtime` | how the runtime sandbox provisions it (Mode 1 Dockerfile vs Mode 2 template), port, health path, explicit start command when the Dockerfile has no `CMD`, allowlisted env, sibling containers (e.g. MongoDB) |
| `expectedSurface` | the route map Scout should discover (recon recall numerator) |
| `groundTruth[]` | known vulnerabilities, each with CWE, canonical type, severity, **scope**, and the HTTP surface (path templates + injection parameter) |

### Finding scopes — what counts as "found"

A ground-truth entry must be honest about what the *current* pipeline can
verify, or the numbers will be wrong:

- **`sniper`** — the current Sniper verifiers (SQL injection via sqlmap) must
  CONFIRM it. Counts in detection recall/precision/F1.
- **`static`** — the static scanner must surface it at `DETECTED` level.
  Counts in the static-scope recall.
- **`future`** — a documented vulnerability the pipeline cannot verify yet
  (IDOR, CSRF, auth flaws). **Never scored**; reported separately so a
  reader can see coverage ambitions without polluting the numbers.

> **Ground-truth caveat for the paper:** the corpus is *finite, not
> exhaustive*. A CONFIRMED exploit that matches no corpus entry is counted as
> a false positive by this tooling, but that means "outside the ground-truth
> set", not "not a real vulnerability". State this explicitly in the
> limitations section.

## Adding a benchmark app

1. Provision the app once manually (repo clone → `docker run` with the same
   flags the runtime sandbox uses) and confirm the health path responds.
2. Add an entry to `corpus.json` with the runtime spec + `groundTruth`.
   Write CWE entries from the app's documented vulnerabilities; verify each
   `sniper` entry actually confirms with sqlmap before publishing a number.
3. Run the corpus test to validate the document shape:
   `cd backend && npx vitest run src/benchmarks`.

## Running an evaluation

1. Start the stack (`npm run docker:up` or dev), then run a scan against a
   corpus app — either through the API
   (`POST /api/scans` with the repo URL, plus the runtime-sandbox + agents
   pipeline) or the gated E2E harness.
2. Collect metrics:

```bash
cd backend
npx tsx scripts/collect-metrics.ts --scan <scanId>            # one scan
npx tsx scripts/collect-metrics.ts --name NodeGoat           # name LIKE
npx tsx scripts/collect-metrics.ts --recent 20 --check-docker --out report.json
```

The report is a JSON document; the console prints a human-readable summary.
`--check-docker` adds the zero-leftover check (read-only `docker` filters,
only counts resources labeled `amass.manager=1`).

## Metrics glossary (what each number means)

**Detection (scored vs corpus):**
- `aggregates.sniper.{truePositive,falseNegative,falsePositive}` — TP: corpus
  finding matched by a CONFIRMED/EXPLOITABLE exploit; FN: corpus finding with
  no matching exploit; FP: confirmed exploit outside the ground-truth set.
- `recall = TP/(TP+FN)`, `precision = TP/(TP+FP)`, `F1` — reported overall
  and per-CWE. Matching requires **both** type/CWE identity **and** route
  agreement (method + normalized path + injection parameter), so a confirmed
  exploit on the wrong route never credits a finding.
- `aggregates.static` — same idea at the static-scanner level (DETECTED rows).
- `scout.recon.recall` — fraction of `expectedSurface` discovered by Scout
  (normalized path templates; concrete ids collapse to `:param`).

**Process:**
- `stages[]` — per agent type: run count, COMPLETED/FAILED/TIMEOUT and
  duration stats (mean/p50/p95/max) from durable `AgentExecution` rows.
- `spanMs` — `Scan.startedAt → completedAt` wall clock.
- `costProxy` — `agentRuns`, `totalExecutionMs`, `llmStageRuns` (non-Sniper
  agent runs). Token-level cost is NOT yet recorded (see gaps).

**Remediation:**
- `patches.*` — counts per `Patch.status`; `criticRuns.*` per `CriticStatus`.
- `firstAttemptApprovalRate` — patches APPROVED by a first-attempt Critic run
  over patches with ≥1 Critic run (empirical "fixes it first try").
- `retriesNeeded` — distribution of max Critic attempt per patch
  (0 = never validated, 1 = first try, …).

**Sandbox/isolation:**
- `sandbox.{provisioned,ready,failed,destroyed,expired}` + `failureReasons`
  (e.g. the old `EHOSTUNREACH`/`ECONNREFUSED` health-check failures appear
  here verbatim — good evidence for the "before/after" table).
- `isolation.{containers,networks,images}` — `--check-docker` only; -1 means
  Docker unavailable. A successful evaluation run must report 0/0/0.

## Comparison methodology (paper)

- **Ablations**: run the pipeline with agents disabled (no Scout, no Planner,
  Sniper-only) and compare recall/precision/latency — same corpus, same apps.
- **K-repeat stability**: run each app K ≥ 3 times; report min/median/max F1
  and stage latencies. LLM sampling makes single runs anecdotal.
- **Model sweep**: same pipeline, different `LLM_PROVIDER`/model — detection
  and remediation sensitivity to the base model.
- **Baselines**: standalone semgrep (static), sqlmap (verification) on the
  same apps; literature numbers (CyberSecEval, SecurityEval) only as context.

## Known gaps (what the tooling does NOT measure yet)

- Token/cost per scan — `AgentExecution` stores sanitized metadata, not token
  usage. Instrument the LLM layer to persist `{promptTokens, completionTokens}`
  per run, then sum per stage.
- Event-level stage timing (Scout probe latencies, health-check latencies,
  time-to-READY) lives only in the ephemeral EventBus. Persist a
  `SandboxLifecycle` timestamp (e.g. `readyAt` on `RuntimeSandbox`) to make
  these durable.
- Patch *correctness* beyond Critic: the tool counts APPROVED, but a
  human-re-checked "false-fixed" rate needs a small manual review set
  (adversarial sampling), stored as a separate CSV keyed by patch id.
- Deterministic per-parameter matching is by design; app routes that return
  query params in `Exploit.endpoint` vs `Exploit.parameter` are handled, but
  a corpus entry with no route hint matches on type/CWE only — add `routes`
  whenever the surface is known.
