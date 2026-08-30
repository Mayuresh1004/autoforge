/**
 * AMASS Demo Mode Fixtures.
 * 
 * Production-like target fixtures providing realistic findings, recon endpoints,
 * attack plans, exploitation evidence, patches, and critic verification data.
 * 
 * GeoSpy domain: Generative Engine Optimization (GEO) platform (Python/FastAPI).
 * AskBit domain: TypeScript/React Q&A Platform (Node.js/Express).
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
      id: 'fnd-askbit-bac',
      findingId: 'fnd-askbit-bac',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A01-BROKEN-ACCESS-CONTROL',
      title: 'BROKEN_ACCESS_CONTROL',
      severity: 'HIGH',
      cwe: 'CWE-285',
      filePath: 'server/routes/comments.js',
      lineStart: 15,
      lineEnd: 28,
      endpoint: '/api/comments/:id',
      parameter: 'id',
      isConfirmed: true,
      status: 'CONFIRMED',
      isDemo: true,
      description: 'The endpoint allows a user to delete a comment without verifying that the authenticated user owns the comment.',
      evidence: 'DELETE /api/comments/42 (authenticated as user_B) -> HTTP 200 OK (Deleted comment owned by user_A)',
    },
    {
      id: 'fnd-askbit-misconfig',
      findingId: 'fnd-askbit-misconfig',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A05-SECURITY-MISCONFIGURATION',
      title: 'SECURITY_MISCONFIGURATION',
      severity: 'MEDIUM',
      cwe: 'CWE-200',
      filePath: 'server/routes/misconfig.js',
      lineStart: 10,
      lineEnd: 22,
      endpoint: '/api/debug/config',
      isConfirmed: true,
      status: 'CONFIRMED',
      isDemo: true,
      description: 'A debug/configuration endpoint is exposed in the application and returns internal configuration information.',
      evidence: 'GET /api/debug/config -> HTTP 200 OK (Exposed internal database connection parameters & API keys)',
    },
    {
      id: 'fnd-askbit-sqli',
      findingId: 'fnd-askbit-sqli',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A03-SQL-INJECTION',
      title: 'SQL_INJECTION',
      severity: 'CRITICAL',
      cwe: 'CWE-89',
      filePath: 'server/routes/questions.js',
      lineStart: 42,
      lineEnd: 58,
      endpoint: '/api/questions/search',
      parameter: 'q',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'Unsanitized search input directly interpolated into SQL query string.',
      evidence: "GET /api/questions/search?q=' OR 1=1-- -> Discovered raw SQL query string interpolation",
    },
    {
      id: 'fnd-askbit-xss',
      findingId: 'fnd-askbit-xss',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A03-CROSS-SITE-SCRIPTING',
      title: 'XSS',
      severity: 'HIGH',
      cwe: 'CWE-79',
      filePath: 'server/routes/answers.js',
      lineStart: 30,
      lineEnd: 45,
      endpoint: '/api/answers/preview',
      parameter: 'content',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'Reflected user content returned without sanitization in HTML preview mode.',
      evidence: 'POST /api/answers/preview -> Discovered unsanitized HTML innerHTML rendering context',
    },
    {
      id: 'fnd-askbit-ssrf',
      findingId: 'fnd-askbit-ssrf',
      scanId: 'scan_8f4a29c1',
      ruleId: 'OWASP-A10-SERVER-SIDE-REQUEST-FORGERY',
      title: 'SSRF',
      severity: 'HIGH',
      cwe: 'CWE-918',
      filePath: 'server/routes/avatars.js',
      lineStart: 18,
      lineEnd: 32,
      endpoint: '/api/users/avatar-import',
      parameter: 'url',
      isConfirmed: false,
      status: 'DISCOVERED',
      isDemo: true,
      description: 'User-controlled image URL fetched server-side without intranet IP restriction.',
      evidence: 'POST /api/users/avatar-import -> Identified server-side HTTP fetch without internal network block',
    },
  ],

  endpoints: [
    {
      findingId: 'fnd-askbit-bac',
      path: '/api/comments/:id',
      method: 'DELETE',
      description: 'Comment deletion route in server/routes/comments.js',
      evidence: 'Identified DELETE route /api/comments/:id missing user ownership validation.',
      isAuthRequired: true,
    },
    {
      findingId: 'fnd-askbit-misconfig',
      path: '/api/debug/config',
      method: 'GET',
      description: 'Internal debug endpoint in server/routes/misconfig.js',
      evidence: 'Identified GET route /api/debug/config publicly accessible.',
      isAuthRequired: false,
    },
    {
      findingId: 'fnd-askbit-sqli',
      path: '/api/questions/search',
      method: 'GET',
      description: 'Question search query handler in server/routes/questions.js',
      evidence: 'Identified GET parameter q passed to raw database query.',
      isAuthRequired: false,
    },
    {
      findingId: 'fnd-askbit-xss',
      path: '/api/answers/preview',
      method: 'POST',
      description: 'Markdown preview parser in server/routes/answers.js',
      evidence: 'Identified POST handler returning raw unescaped HTML content.',
      isAuthRequired: true,
    },
    {
      findingId: 'fnd-askbit-ssrf',
      path: '/api/users/avatar-import',
      method: 'POST',
      description: 'Remote avatar importer in server/routes/avatars.js',
      evidence: 'Identified POST handler executing HTTP client request to arbitrary user-supplied URL.',
      isAuthRequired: true,
    },
  ],

  targets: [
    {
      targetId: 'fnd-askbit-bac',
      findingId: 'fnd-askbit-bac',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/comments/:id',
      method: 'DELETE',
      vulnerabilityType: 'BROKEN_ACCESS_CONTROL',
      priorityScore: 9.2,
      rationale: 'Missing authorization check on sensitive comment removal endpoint.',
      estimatedRisk: 'HIGH',
    },
    {
      targetId: 'fnd-askbit-misconfig',
      findingId: 'fnd-askbit-misconfig',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/debug/config',
      method: 'GET',
      vulnerabilityType: 'SECURITY_MISCONFIGURATION',
      priorityScore: 6.5,
      rationale: 'Exposed debug configuration endpoint returning system information.',
      estimatedRisk: 'MEDIUM',
    },
    {
      targetId: 'fnd-askbit-sqli',
      findingId: 'fnd-askbit-sqli',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/questions/search',
      method: 'GET',
      vulnerabilityType: 'SQL_INJECTION',
      priorityScore: 9.8,
      rationale: 'High priority SQL query string concatenation on search endpoint.',
      estimatedRisk: 'CRITICAL',
    },
    {
      targetId: 'fnd-askbit-xss',
      findingId: 'fnd-askbit-xss',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/answers/preview',
      method: 'POST',
      vulnerabilityType: 'XSS',
      priorityScore: 8.5,
      rationale: 'Reflected cross-site scripting in answer rendering preview.',
      estimatedRisk: 'HIGH',
    },
    {
      targetId: 'fnd-askbit-ssrf',
      findingId: 'fnd-askbit-ssrf',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/users/avatar-import',
      method: 'POST',
      vulnerabilityType: 'SSRF',
      priorityScore: 8.1,
      rationale: 'Server-side request forgery through remote avatar fetcher.',
      estimatedRisk: 'HIGH',
    },
  ],

  exploits: [
    {
      exploitId: 'exp-fnd-askbit-bac',
      targetId: 'fnd-askbit-bac',
      findingId: 'fnd-askbit-bac',
      scanId: 'scan_8f4a29c1',
      confirmed: true,
      endpoint: '/api/comments/:id',
      method: 'DELETE',
      parameter: 'id',
      httpStatusCode: 200,
      payload: 'DELETE /api/comments/42 Authorization: Bearer <user_B_token>',
      responseSnippet: '{"success": true, "deletedId": 42}',
      verificationNotes: 'SNIPER CONFIRMED: Unauthorized deletion of comment 42 succeeded without ownership verification.',
    },
    {
      exploitId: 'exp-fnd-askbit-misconfig',
      targetId: 'fnd-askbit-misconfig',
      findingId: 'fnd-askbit-misconfig',
      scanId: 'scan_8f4a29c1',
      confirmed: true,
      endpoint: '/api/debug/config',
      method: 'GET',
      httpStatusCode: 200,
      payload: 'GET /api/debug/config',
      responseSnippet: '{"NODE_ENV": "production", "DATABASE_URL": "postgres://...", "SECRET_KEY": "***"}',
      verificationNotes: 'SNIPER CONFIRMED: Exposed debug route returned sensitive environment configuration data.',
    },
  ],

  patches: [
    {
      patchId: 'patch-fnd-askbit-bac',
      findingId: 'fnd-askbit-bac',
      scanId: 'scan_8f4a29c1',
      filePath: 'server/routes/comments.js',
      status: 'APPROVED',
      ragContextCount: 3,
      explanation: 'Verify comment ownership before deletion and return HTTP 403 when the authenticated user is not authorized.',
      prNumber: 1,
      prUrl: 'https://github.com/Mayuresh1004/AskBit/pull/1',
      prBranch: 'amass/remediation/fix-security-remediation',
      prCommitSha: '64d4089c1234567890abcdef',
      prStatus: 'OPEN',
      prDeliveredAt: new Date().toISOString(),
      diffContent: `--- a/server/routes/comments.js
+++ b/server/routes/comments.js
@@ -15,7 +15,11 @@ router.delete('/comments/:id', requireAuth, async (req, res) => {
   const comment = await db.comments.findUnique({ where: { id: req.params.id } });
   if (!comment) return res.status(404).json({ error: 'Not found' });
+  if (comment.userId !== req.user.id) {
+    return res.status(403).json({ error: 'Forbidden: You do not own this comment' });
+  }
   await db.comments.delete({ where: { id: req.params.id } });
   return res.json({ success: true });
 });`,
    },
    {
      patchId: 'patch-fnd-askbit-misconfig',
      findingId: 'fnd-askbit-misconfig',
      scanId: 'scan_8f4a29c1',
      filePath: 'server/routes/misconfig.js',
      status: 'APPROVED',
      ragContextCount: 2,
      explanation: 'Disable the endpoint in production or restrict access and return HTTP 403/404 when it is not available.',
      prNumber: 1,
      prUrl: 'https://github.com/Mayuresh1004/AskBit/pull/1',
      prBranch: 'amass/remediation/fix-security-remediation',
      prCommitSha: '64d4089c1234567890abcdef',
      prStatus: 'OPEN',
      prDeliveredAt: new Date().toISOString(),
      diffContent: `--- a/server/routes/misconfig.js
+++ b/server/routes/misconfig.js
@@ -10,5 +10,8 @@ router.get('/debug/config', (req, res) => {
+  if (process.env.NODE_ENV === 'production') {
+    return res.status(403).json({ error: 'Access to debug configuration is disabled in production' });
+  }
   return res.json(config);
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
      vulnerabilityType: 'A01 Broken Access Control (IDOR)',
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
      vulnerabilityType: 'A03 Command Injection',
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
    {
      targetId: 'fnd-geospy-a08',
      findingId: 'fnd-geospy-a08',
      scanId: 'scan_3b7e91d0',
      endpoint: '/api/v1/generate/answers',
      method: 'POST',
      vulnerabilityType: 'A08 Untrusted Deserialization',
      priorityScore: 8.2,
      rationale: 'Scout confirmed template generator in geospy/services/generator.py parses untrusted prompt structures.',
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
    {
      exploitId: 'exp-fnd-geospy-a10',
      targetId: 'fnd-geospy-a10',
      findingId: 'fnd-geospy-a10',
      scanId: 'scan_3b7e91d0',
      confirmed: true,
      endpoint: '/api/v1/analysis/competitors',
      method: 'POST',
      parameter: 'competitor_url',
      httpStatusCode: 200,
      payload: 'http://127.0.0.1:8000/internal-metrics',
      responseSnippet: '{"internal_metrics": {"active_workers": 4, "redis_queue_size": 12}}',
      verificationNotes: 'SNIPER CONFIRMED: Competitor analyzer fetched loopback interface internal metrics.',
    },
    {
      exploitId: 'exp-fnd-geospy-a08',
      targetId: 'fnd-geospy-a08',
      findingId: 'fnd-geospy-a08',
      scanId: 'scan_3b7e91d0',
      confirmed: true,
      endpoint: '/api/v1/generate/answers',
      method: 'POST',
      parameter: 'prompt_template',
      httpStatusCode: 200,
      payload: '{"__class__": "UnsafeTemplate", "eval": "import os"}',
      responseSnippet: '{"status": "eval_executed", "template_id": "tpl_331"}',
      verificationNotes: 'SNIPER CONFIRMED: Answer generator instantiated unverified template class object.',
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
    {
      patchId: 'patch-fnd-geospy-a03',
      findingId: 'fnd-geospy-a03',
      scanId: 'scan_3b7e91d0',
      filePath: 'geospy/services/scraper.py',
      status: 'GENERATED',
      ragContextCount: 4,
      explanation: 'Replaced shell string formatting in subprocess call with an escaped argument list (shell=False) to eliminate OS command injection.',
      diffContent: `--- a/geospy/services/scraper.py
+++ b/geospy/services/scraper.py
@@ -55,4 +55,4 @@
-    cmd = f"playwright-cli fetch {url}"
-    subprocess.run(cmd, shell=True)
+    cmd = ["playwright-cli", "fetch", url]
+    subprocess.run(cmd, shell=False)`,
    },
    {
      patchId: 'patch-fnd-geospy-a10',
      findingId: 'fnd-geospy-a10',
      scanId: 'scan_3b7e91d0',
      filePath: 'geospy/services/competitor_analyzer.py',
      status: 'GENERATED',
      ragContextCount: 3,
      explanation: 'Integrated IP address validation check ensuring target URL does not resolve to local loopback (127.0.0.0/8) or private RFC1918 ranges.',
      diffContent: `--- a/geospy/services/competitor_analyzer.py
+++ b/geospy/services/competitor_analyzer.py
@@ -22,4 +22,6 @@
 async def analyze_competitor(competitor_url: str):
+    if is_internal_ip(competitor_url):
+        raise ValueError("Internal loopback targets are prohibited")
     response = await httpx_client.get(competitor_url)`,
    },
    {
      patchId: 'patch-fnd-geospy-a08',
      findingId: 'fnd-geospy-a08',
      scanId: 'scan_3b7e91d0',
      filePath: 'geospy/services/generator.py',
      status: 'GENERATED',
      ragContextCount: 4,
      explanation: 'Replaced unsafe YAML deserialization with safe_load and strict template class whitelist validation.',
      diffContent: `--- a/geospy/services/generator.py
+++ b/geospy/services/generator.py
@@ -40,4 +40,5 @@
+    validate_template_schema(prompt_template)
-    template = yaml.unsafe_load(prompt_template)
+    template = yaml.safe_load(prompt_template)`,
    },
  ],
};

export const DEMO_FIXTURES: Record<string, DemoTargetFixture> = {
  AskBit: ASKBIT_FIXTURE,
  GeoSpy: GEOSPY_FIXTURE,
};
