/**
 * AMASS Demo Mode Fixtures (Phase 10A).
 * 
 * Production-like target fixtures providing realistic findings, recon endpoints,
 * attack plans, exploitation evidence, patches, and critic verification data.
 * 
 * GeoSpy domain: Generative Engine Optimization (GEO) platform.
 * AskBit domain: TypeScript/React Q&A Platform.
 * Stable ID linkages bind Findings, Scout Endpoints, Targets, Exploits, and Patches.
 */

import type {
  FindingModel,
  ScanModel,
  ScoutEndpoint,
  TargetModel,
  ExploitEvidenceModel,
  PatchModel,
  RuntimeSandboxModel,
} from '../types/api-types';

export interface DemoTargetFixture {
  readonly id: 'AskBit' | 'GeoSpy';
  readonly name: string;
  readonly repositoryUrl: string;
  readonly techStack: string;
  readonly description: string;
  readonly scan: ScanModel;
  readonly sandbox: RuntimeSandboxModel;
  readonly endpoints: ScoutEndpoint[];
  readonly targets: TargetModel[];
  readonly findings: FindingModel[];
  readonly exploits: ExploitEvidenceModel[];
  readonly patches: PatchModel[];
}

// ============================================================================
// 1. ASKBIT TARGET FIXTURES (TypeScript/React Q&A Platform)
// ============================================================================

export const ASKBIT_FIXTURE: DemoTargetFixture = {
  id: 'AskBit',
  name: 'AskBit (TypeScript/React Q&A Platform)',
  repositoryUrl: 'https://github.com/Mayuresh1004/AskBit',
  techStack: 'Node.js, Express, React, TypeScript, PostgreSQL',
  description: 'Open-source community Q&A platform.',
  
  scan: {
    scanId: 'scan_8f4a29c1',
    repositoryUrl: 'https://github.com/Mayuresh1004/AskBit',
    commitHash: 'a7b3c9f',
    status: 'COMPLETED',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    targetUrl: 'http://askbit-sandbox.internal:3000',
    isDemo: true,
  },

  sandbox: {
    id: 'sbx-askbit-8f4a',
    sandboxId: 'sbx-askbit-8f4a',
    scanId: 'scan_8f4a29c1',
    status: 'READY',
    runtime: 'docker-isolated',
    targetUrl: 'http://askbit-sandbox.internal:3000',
    internalHost: '172.28.0.4',
    internalPort: 3000,
    createdAt: new Date().toISOString(),
    repository: {
      name: 'AskBit',
      url: 'https://github.com/Mayuresh1004/AskBit',
      path: '/workspace/askbit',
    },
  },

  findings: [
    {
      id: 'fnd-askbit-a01',
      findingId: 'fnd-askbit-a01',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A01-ACCESS-CONTROL',
      title: 'A01: Privilege Escalation in Role Middleware',
      severity: 'CRITICAL',
      cwe: 'CWE-285',
      filePath: 'src/routes/admin.ts',
      lineStart: 42,
      lineEnd: 55,
      endpoint: '/api/admin/users/role',
      parameter: 'role',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'User role modification endpoint omits requireAdmin middleware check.',
      evidence: 'POST /api/admin/users/role {"userId":"usr_102","role":"admin"} -> HTTP 200 OK (User role updated to admin)',
    },
    {
      id: 'fnd-askbit-a03',
      findingId: 'fnd-askbit-a03',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A03-SQL-INJECTION',
      title: 'A03: SQL Injection in Question Search',
      severity: 'CRITICAL',
      cwe: 'CWE-89',
      filePath: 'src/controllers/questionController.ts',
      lineStart: 88,
      lineEnd: 96,
      endpoint: '/api/questions/search',
      parameter: 'q',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'Raw SQL template string used in search query handler without parameterized arguments.',
      evidence: "GET /api/questions/search?q=test' OR 1=1-- -> HTTP 200 OK (Extracted 450 query records)",
    },
    {
      id: 'fnd-askbit-a10',
      findingId: 'fnd-askbit-a10',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A10-SSRF',
      title: 'A10: Server-Side Request Forgery (SSRF) in URL Preview',
      severity: 'HIGH',
      cwe: 'CWE-918',
      filePath: 'src/services/previewService.ts',
      lineStart: 24,
      lineEnd: 35,
      endpoint: '/api/fetch-url',
      parameter: 'url',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'URL preview service fetches arbitrary user-supplied URLs without restricting internal private IP ranges.',
      evidence: 'GET /api/fetch-url?url=http://169.254.169.254/latest/meta-data/ -> HTTP 200 OK (AWS Metadata Response)',
    },
    {
      id: 'fnd-askbit-a07',
      findingId: 'fnd-askbit-a07',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A07-AUTH-FAILURE',
      title: 'A07: Weak Secret & Missing Password Rate-Limiting',
      severity: 'HIGH',
      cwe: 'CWE-307',
      filePath: 'src/routes/auth.ts',
      lineStart: 15,
      lineEnd: 28,
      endpoint: '/api/auth/login',
      parameter: 'password',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'Authentication endpoint does not enforce rate limits on failed password login attempts.',
      evidence: '50 consecutive POST requests allowed in 2 seconds without HTTP 429 rate limit response.',
    },
    {
      id: 'fnd-askbit-a05',
      findingId: 'fnd-askbit-a05',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A05-MISCONFIG',
      title: 'A05: Exposed Internal Debug & Environment Endpoint',
      severity: 'MEDIUM',
      cwe: 'CWE-200',
      filePath: 'src/server.ts',
      lineStart: 110,
      lineEnd: 118,
      endpoint: '/api/debug/env',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'Debug endpoint exposed publicly in production builds.',
      evidence: 'GET /api/debug/env returns process uptime, node version, and internal config parameters.',
    },
    {
      id: 'fnd-askbit-a08',
      findingId: 'fnd-askbit-a08',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A08-DATA-INTEGRITY',
      title: 'A08: Untrusted Plugin Schema Deserialization',
      severity: 'MEDIUM',
      cwe: 'CWE-502',
      filePath: 'src/services/pluginLoader.ts',
      lineStart: 60,
      lineEnd: 74,
      endpoint: '/api/plugins/load',
      parameter: 'pluginConfig',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'Plugin configuration loader parses untrusted JSON schemas with dynamic function evaluation without integrity validation.',
      evidence: 'POST /api/plugins/load parses prototype override properties without schema signature check.',
    },
  ],

  endpoints: [
    {
      findingId: 'fnd-askbit-a01',
      path: '/api/admin/users/role',
      method: 'POST',
      description: 'Role modification route in src/routes/admin.ts',
      evidence: 'Identified POST route /api/admin/users/role lacking requireAdmin middleware check.',
      isAuthRequired: true,
    },
    {
      findingId: 'fnd-askbit-a03',
      path: '/api/questions/search',
      method: 'GET',
      description: 'Question search query handler in src/controllers/questionController.ts',
      evidence: 'Identified GET controller; search query parameter "q" directly concatenated into SQL statement.',
      isAuthRequired: false,
    },
    {
      findingId: 'fnd-askbit-a10',
      path: '/api/fetch-url',
      method: 'GET',
      description: 'Remote URL preview fetcher in src/services/previewService.ts',
      evidence: 'Identified preview service route fetching user URLs without loopback IP restrictions.',
      isAuthRequired: false,
    },
    {
      findingId: 'fnd-askbit-a07',
      path: '/api/auth/login',
      method: 'POST',
      description: 'Authentication login endpoint in src/routes/auth.ts',
      evidence: 'Identified auth handler; missing express-rate-limit middleware for login attempts.',
      isAuthRequired: false,
    },
    {
      findingId: 'fnd-askbit-a05',
      path: '/api/debug/env',
      method: 'GET',
      description: 'Internal environment debug route in src/server.ts',
      evidence: 'Identified debug route returning node process environment without auth boundary.',
      isAuthRequired: false,
    },
    {
      findingId: 'fnd-askbit-a08',
      path: '/api/plugins/load',
      method: 'POST',
      description: 'Dynamic JSON plugin loader in src/services/pluginLoader.ts',
      evidence: 'Identified plugin loader parsing untrusted JSON payloads without cryptographic signatures.',
      isAuthRequired: true,
    },
  ],

  targets: [
    {
      targetId: 'fnd-askbit-a01',
      findingId: 'fnd-askbit-a01',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/admin/users/role',
      method: 'POST',
      vulnerabilityType: 'A01 Broken Access Control',
      priorityScore: 9.8,
      rationale: 'Scout mapped unauthenticated POST route /api/admin/users/role in src/routes/admin.ts allowing privilege escalation.',
      estimatedRisk: 'CRITICAL',
    },
    {
      targetId: 'fnd-askbit-a03',
      findingId: 'fnd-askbit-a03',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/questions/search',
      method: 'GET',
      vulnerabilityType: 'A03 Injection',
      priorityScore: 9.2,
      rationale: 'Scout confirmed string interpolation of "q" parameter in src/controllers/questionController.ts.',
      estimatedRisk: 'CRITICAL',
    },
    {
      targetId: 'fnd-askbit-a10',
      findingId: 'fnd-askbit-a10',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/fetch-url',
      method: 'GET',
      vulnerabilityType: 'A10 Server-Side Request Forgery',
      priorityScore: 8.5,
      rationale: 'Scout verified unvalidated egress fetch in src/services/previewService.ts reaching internal metadata.',
      estimatedRisk: 'HIGH',
    },
  ],

  exploits: [
    {
      exploitId: 'exp-fnd-askbit-a01',
      targetId: 'fnd-askbit-a01',
      findingId: 'fnd-askbit-a01',
      scanId: 'scan_8f4a29c1',
      confirmed: true,
      endpoint: '/api/admin/users/role',
      method: 'POST',
      parameter: 'role',
      httpStatusCode: 200,
      payload: '{"userId":"usr_102", "role":"admin"}',
      responseSnippet: '{"success": true, "message": "Role elevated to admin", "user": "usr_102"}',
      verificationNotes: 'SNIPER CONFIRMED: Endpoint updated user privileges without administrative auth header.',
    },
    {
      exploitId: 'exp-fnd-askbit-a03',
      targetId: 'fnd-askbit-a03',
      findingId: 'fnd-askbit-a03',
      scanId: 'scan_8f4a29c1',
      confirmed: true,
      endpoint: '/api/questions/search',
      method: 'GET',
      parameter: 'q',
      httpStatusCode: 200,
      payload: "' UNION SELECT id, username, password_hash, email FROM users--",
      responseSnippet: '{"results": [{"id": 1, "username": "admin", "email": "admin@askbit.internal"}]}',
      verificationNotes: 'SNIPER CONFIRMED: SQL Syntax error bypass confirmed extraction of query result set.',
    },
  ],

  patches: [
    {
      patchId: 'patch-fnd-askbit-a01',
      findingId: 'fnd-askbit-a01',
      scanId: 'scan_8f4a29c1',
      filePath: 'src/routes/admin.ts',
      status: 'GENERATED',
      ragContextCount: 4,
      explanation: 'Added requireAdmin middleware to /api/admin/users/role route to strictly enforce authorization check before handling role mutations.',
      diffContent: `--- a/src/routes/admin.ts
+++ b/src/routes/admin.ts
@@ -42,7 +42,7 @@
-router.post('/users/role', async (req, res) => {
+router.post('/users/role', requireAuth, requireAdmin, async (req, res) => {
   const { userId, role } = req.body;
   const updated = await userService.updateUserRole(userId, role);
   return res.json({ success: true, updated });
 });`,
    },
  ],
};

// ============================================================================
// 2. GEOSPY TARGET FIXTURES (Generative Engine Optimization Platform)
// Domain: Project config, target URLs, competitor scraping, AI prompts, GEO score
// ============================================================================

export const GEOSPY_FIXTURE: DemoTargetFixture = {
  id: 'GeoSpy',
  name: 'GeoSpy (Generative Engine Optimization Platform)',
  repositoryUrl: 'https://github.com/Mayuresh1004/geospy',
  techStack: 'Python 3.11, FastAPI, SQLAlchemy, Playwright, Celery',
  description: 'Generative Engine Optimization (GEO) and search coverage analytics platform.',

  scan: {
    scanId: 'scan_3b7e91d0',
    repositoryUrl: 'https://github.com/Mayuresh1004/geospy',
    commitHash: 'e912d4a',
    status: 'COMPLETED',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    targetUrl: 'http://geospy-sandbox.internal:8000',
    isDemo: true,
  },

  sandbox: {
    id: 'sbx-geospy-3b7e',
    sandboxId: 'sbx-geospy-3b7e',
    scanId: 'scan_3b7e91d0',
    status: 'READY',
    runtime: 'docker-isolated',
    targetUrl: 'http://geospy-sandbox.internal:8000',
    internalHost: '172.28.0.9',
    internalPort: 8000,
    createdAt: new Date().toISOString(),
    repository: {
      name: 'GeoSpy',
      url: 'https://github.com/Mayuresh1004/geospy',
      path: '/workspace/geospy',
    },
  },

  findings: [
    {
      id: 'fnd-geospy-a01',
      findingId: 'fnd-geospy-a01',
      scanId: 'scan_3b7e91d0',
      ruleId: 'OWASP-A01-IDOR',
      title: 'A01: Insecure Direct Object Reference (IDOR) on Project Configuration',
      severity: 'CRITICAL',
      cwe: 'CWE-639',
      filePath: 'geospy/routers/projects.py',
      lineStart: 28,
      lineEnd: 38,
      endpoint: '/api/v1/projects/{id}/config',
      parameter: 'id',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'Endpoint returns sensitive project configuration, brand targets, and competitor URLs by ID without verifying project ownership.',
      evidence: 'GET /api/v1/projects/9902/config returns brand keyword list for non-authenticated session.',
    },
    {
      id: 'fnd-geospy-a03',
      findingId: 'fnd-geospy-a03',
      scanId: 'scan_3b7e91d0',
      ruleId: 'OWASP-A03-COMMAND-INJECTION',
      title: 'A03: OS Command Injection in Web Scraper Service',
      severity: 'CRITICAL',
      cwe: 'CWE-78',
      filePath: 'geospy/services/scraper.py',
      lineStart: 55,
      lineEnd: 64,
      endpoint: '/api/v1/scrape/fetch',
      parameter: 'url',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'Scraper service formats URL argument into headless renderer subprocess call without shell argument escaping.',
      evidence: 'POST /api/v1/scrape/fetch url="http://example.com; echo AMASS_PROBE" -> Command executed in sandbox container.',
    },
    {
      id: 'fnd-geospy-a10',
      findingId: 'fnd-geospy-a10',
      scanId: 'scan_3b7e91d0',
      ruleId: 'OWASP-A10-SSRF',
      title: 'A10: Server-Side Request Forgery (SSRF) in Competitor URL Analysis',
      severity: 'HIGH',
      cwe: 'CWE-918',
      filePath: 'geospy/services/competitor_analyzer.py',
      lineStart: 22,
      lineEnd: 34,
      endpoint: '/api/v1/analysis/competitors',
      parameter: 'competitor_url',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'Competitor analyzer fetches external URL strings without validating internal loopback or private IP ranges.',
      evidence: 'POST /api/v1/analysis/competitors competitor_url="http://127.0.0.1:8000/internal-metrics" -> Connected to internal loopback.',
    },
    {
      id: 'fnd-geospy-a08',
      findingId: 'fnd-geospy-a08',
      scanId: 'scan_3b7e91d0',
      ruleId: 'OWASP-A08-INSECURE-DESERIALIZATION',
      title: 'A08: Untrusted Prompt Template Deserialization',
      severity: 'HIGH',
      cwe: 'CWE-502',
      filePath: 'geospy/services/generator.py',
      lineStart: 40,
      lineEnd: 52,
      endpoint: '/api/v1/generate/answers',
      parameter: 'prompt_template',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'Answer generator parses untrusted prompt template structures without cryptographic signature validation.',
      evidence: 'POST /api/v1/generate/answers with crafted payload triggers unverified template class construction.',
    },
  ],

  endpoints: [
    {
      findingId: 'fnd-geospy-a01',
      path: '/api/v1/projects/{id}/config',
      method: 'GET',
      description: 'FastAPI project router in geospy/routers/projects.py',
      evidence: 'Identified GET route /api/v1/projects/{id}/config; fetches project config by ID without verifying project owner_id.',
      isAuthRequired: true,
    },
    {
      findingId: 'fnd-geospy-a03',
      path: '/api/v1/scrape/fetch',
      method: 'POST',
      description: 'Headless scraper service in geospy/services/scraper.py',
      evidence: 'Identified POST route /api/v1/scrape/fetch; url parameter formatted directly into Playwright subprocess command.',
      isAuthRequired: true,
    },
    {
      findingId: 'fnd-geospy-a10',
      path: '/api/v1/analysis/competitors',
      method: 'POST',
      description: 'Competitor content analyzer in geospy/services/competitor_analyzer.py',
      evidence: 'Identified POST route /api/v1/analysis/competitors; competitor_url parameter allows fetching internal loopback 127.0.0.1.',
      isAuthRequired: true,
    },
    {
      findingId: 'fnd-geospy-a08',
      path: '/api/v1/generate/answers',
      method: 'POST',
      description: 'AI answer generator service in geospy/services/generator.py',
      evidence: 'Identified POST route /api/v1/generate/answers; prompt_template parameter accepts untrusted template object structures.',
      isAuthRequired: true,
    },
  ],

  targets: [
    {
      targetId: 'fnd-geospy-a01',
      findingId: 'fnd-geospy-a01',
      scanId: 'scan_3b7e91d0',
      endpoint: '/api/v1/projects/{id}/config',
      method: 'GET',
      vulnerabilityType: 'A01 Broken Access Control',
      priorityScore: 9.9,
      rationale: 'Scout mapped unverified GET endpoint in geospy/routers/projects.py returning project config and target URLs.',
      estimatedRisk: 'CRITICAL',
    },
    {
      targetId: 'fnd-geospy-a03',
      findingId: 'fnd-geospy-a03',
      scanId: 'scan_3b7e91d0',
      endpoint: '/api/v1/scrape/fetch',
      method: 'POST',
      vulnerabilityType: 'A03 Injection',
      priorityScore: 9.5,
      rationale: 'Scout confirmed unescaped URL string in geospy/services/scraper.py passed into headless browser subprocess wrapper.',
      estimatedRisk: 'CRITICAL',
    },
    {
      targetId: 'fnd-geospy-a10',
      findingId: 'fnd-geospy-a10',
      scanId: 'scan_3b7e91d0',
      endpoint: '/api/v1/analysis/competitors',
      method: 'POST',
      vulnerabilityType: 'A10 Server-Side Request Forgery',
      priorityScore: 8.8,
      rationale: 'Scout verified unvalidated competitor URL in geospy/services/competitor_analyzer.py accessing localhost ports.',
      estimatedRisk: 'HIGH',
    },
  ],

  exploits: [
    {
      exploitId: 'exp-fnd-geospy-a01',
      targetId: 'fnd-geospy-a01',
      findingId: 'fnd-geospy-a01',
      scanId: 'scan_3b7e91d0',
      confirmed: true,
      endpoint: '/api/v1/projects/{id}/config',
      method: 'GET',
      parameter: 'id',
      httpStatusCode: 200,
      payload: '/api/v1/projects/9902/config',
      responseSnippet: '{"project_id": 9902, "target_url": "https://brand.internal", "brand_keywords": ["geo", "ai_search"]}',
      verificationNotes: 'SNIPER CONFIRMED: Returned sensitive project target configuration without authorization header.',
    },
    {
      exploitId: 'exp-fnd-geospy-a03',
      targetId: 'fnd-geospy-a03',
      findingId: 'fnd-geospy-a03',
      scanId: 'scan_3b7e91d0',
      confirmed: true,
      endpoint: '/api/v1/scrape/fetch',
      method: 'POST',
      parameter: 'url',
      httpStatusCode: 200,
      payload: 'http://example.com; echo AMASS_PROBE',
      responseSnippet: 'Scrape job initialized. Output: AMASS_PROBE',
      verificationNotes: 'SNIPER CONFIRMED: Shell metacharacter injected command into scraper subprocess wrapper.',
    },
  ],

  patches: [
    {
      patchId: 'patch-fnd-geospy-a01',
      findingId: 'fnd-geospy-a01',
      scanId: 'scan_3b7e91d0',
      filePath: 'geospy/routers/projects.py',
      status: 'GENERATED',
      ragContextCount: 5,
      explanation: 'Added current_user authorization ownership check to project config endpoint to strictly prevent IDOR access.',
      diffContent: `--- a/geospy/routers/projects.py
+++ b/geospy/routers/projects.py
@@ -28,5 +28,8 @@
 @router.get("/projects/{id}/config")
 async function get_project_config(id: str, current_user = Depends(get_current_user)):
+    project = await get_project(id)
+    if project.owner_id != current_user.id:
+        raise HTTPException(status_code=403, detail="Forbidden")
     return project.config`,
    },
  ],
};

export const DEMO_FIXTURES: Record<string, DemoTargetFixture> = {
  AskBit: ASKBIT_FIXTURE,
  GeoSpy: GEOSPY_FIXTURE,
};
