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
      vulnerabilityType: 'A03 SQL Injection',
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
    {
      targetId: 'fnd-askbit-a07',
      findingId: 'fnd-askbit-a07',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/auth/login',
      method: 'POST',
      vulnerabilityType: 'A07 Identification & Authentication Failures',
      priorityScore: 8.0,
      rationale: 'Scout mapped login route lacking express-rate-limit throttling middleware.',
      estimatedRisk: 'HIGH',
    },
    {
      targetId: 'fnd-askbit-a05',
      findingId: 'fnd-askbit-a05',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/debug/env',
      method: 'GET',
      vulnerabilityType: 'A05 Security Misconfiguration',
      priorityScore: 7.5,
      rationale: 'Scout identified public debug route in src/server.ts exposing system environment.',
      estimatedRisk: 'MEDIUM',
    },
    {
      targetId: 'fnd-askbit-a08',
      findingId: 'fnd-askbit-a08',
      scanId: 'scan_8f4a29c1',
      endpoint: '/api/plugins/load',
      method: 'POST',
      vulnerabilityType: 'A08 Software and Data Integrity Failures',
      priorityScore: 7.0,
      rationale: 'Scout confirmed unvalidated JSON schema parsing in src/services/pluginLoader.ts.',
      estimatedRisk: 'MEDIUM',
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
    {
      exploitId: 'exp-fnd-askbit-a10',
      targetId: 'fnd-askbit-a10',
      findingId: 'fnd-askbit-a10',
      scanId: 'scan_8f4a29c1',
      confirmed: true,
      endpoint: '/api/fetch-url',
      method: 'GET',
      parameter: 'url',
      httpStatusCode: 200,
      payload: 'http://169.254.169.254/latest/meta-data/',
      responseSnippet: '{"ami-id": "ami-0c55b159cbfafe1f0", "instance-id": "i-0912ab8f"}',
      verificationNotes: 'SNIPER CONFIRMED: Service fetched AWS cloud instance metadata address via SSRF.',
    },
    {
      exploitId: 'exp-fnd-askbit-a07',
      targetId: 'fnd-askbit-a07',
      findingId: 'fnd-askbit-a07',
      scanId: 'scan_8f4a29c1',
      confirmed: true,
      endpoint: '/api/auth/login',
      method: 'POST',
      parameter: 'password',
      httpStatusCode: 200,
      payload: '50 consecutive POST /api/auth/login requests in 2 seconds',
      responseSnippet: '{"status": 200, "message": "Invalid credentials"} (No 429 Rate Limit)',
      verificationNotes: 'SNIPER CONFIRMED: Authentication route allowed unthrottled brute-force credential stuffing.',
    },
    {
      exploitId: 'exp-fnd-askbit-a05',
      targetId: 'fnd-askbit-a05',
      findingId: 'fnd-askbit-a05',
      scanId: 'scan_8f4a29c1',
      confirmed: true,
      endpoint: '/api/debug/env',
      method: 'GET',
      httpStatusCode: 200,
      payload: 'GET /api/debug/env',
      responseSnippet: '{"NODE_ENV": "production", "DB_PORT": 5432, "PROCESS_UPTIME": 1420}',
      verificationNotes: 'SNIPER CONFIRMED: Publicly accessible debug route exposed environment variables.',
    },
    {
      exploitId: 'exp-fnd-askbit-a08',
      targetId: 'fnd-askbit-a08',
      findingId: 'fnd-askbit-a08',
      scanId: 'scan_8f4a29c1',
      confirmed: true,
      endpoint: '/api/plugins/load',
      method: 'POST',
      parameter: 'pluginConfig',
      httpStatusCode: 200,
      payload: '{"pluginName": "custom", "schema": "__proto__.polluted=true"}',
      responseSnippet: '{"success": true, "pluginId": "plg_99"}',
      verificationNotes: 'SNIPER CONFIRMED: Plugin loader accepted untrusted prototype override object.',
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
      explanation: 'Added requireAuth and requireAdmin middleware to /api/admin/users/role route to strictly enforce authorization check before handling role mutations.',
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
    {
      patchId: 'patch-fnd-askbit-a03',
      findingId: 'fnd-askbit-a03',
      scanId: 'scan_8f4a29c1',
      filePath: 'src/controllers/questionController.ts',
      status: 'GENERATED',
      ragContextCount: 5,
      explanation: 'Replaced unsafe raw template string SQL query concatenation with parameterized query positional arguments using db.query(sql, [params]).',
      diffContent: `--- a/src/controllers/questionController.ts
+++ b/src/controllers/questionController.ts
@@ -88,4 +88,4 @@
-  const query = \`SELECT * FROM questions WHERE title LIKE '%\${q}%'\`;
-  const results = await db.query(query);
+  const query = 'SELECT * FROM questions WHERE title LIKE $1';
+  const results = await db.query(query, [\`%\${q}%\`]);
   return res.json({ results });`,
    },
    {
      patchId: 'patch-fnd-askbit-a10',
      findingId: 'fnd-askbit-a10',
      scanId: 'scan_8f4a29c1',
      filePath: 'src/services/previewService.ts',
      status: 'GENERATED',
      ragContextCount: 3,
      explanation: 'Added outbound destination validation function (isPrivateIP) preventing fetching of private IP addresses, loopback hosts, and cloud metadata endpoints.',
      diffContent: `--- a/src/services/previewService.ts
+++ b/src/services/previewService.ts
@@ -24,4 +24,6 @@
+  if (isPrivateIP(parsedUrl.hostname)) {
+    throw new Error('Access to private network address forbidden');
+  }
   const response = await fetch(targetUrl);
   return response.text();`,
    },
    {
      patchId: 'patch-fnd-askbit-a07',
      findingId: 'fnd-askbit-a07',
      scanId: 'scan_8f4a29c1',
      filePath: 'src/routes/auth.ts',
      status: 'GENERATED',
      ragContextCount: 4,
      explanation: 'Integrated express-rate-limit middleware restricting authentication login attempts to maximum 5 requests per 15 minutes per IP address.',
      diffContent: `--- a/src/routes/auth.ts
+++ b/src/routes/auth.ts
@@ -15,3 +15,3 @@
-router.post('/login', async (req, res) => {
+router.post('/login', loginRateLimiter, async (req, res) => {
   const { email, password } = req.body;
   const user = await authService.login(email, password);`,
    },
    {
      patchId: 'patch-fnd-askbit-a05',
      findingId: 'fnd-askbit-a05',
      scanId: 'scan_8f4a29c1',
      filePath: 'src/server.ts',
      status: 'GENERATED',
      ragContextCount: 2,
      explanation: 'Wrapped internal debug route registration in NODE_ENV condition ensuring environment debug routes are not exposed in production deployments.',
      diffContent: `--- a/src/server.ts
+++ b/src/server.ts
@@ -110,3 +110,5 @@
-app.use('/api/debug', debugRouter);
+if (process.env.NODE_ENV !== 'production') {
+  app.use('/api/debug', debugRouter);
+}`,
    },
    {
      patchId: 'patch-fnd-askbit-a08',
      findingId: 'fnd-askbit-a08',
      scanId: 'scan_8f4a29c1',
      filePath: 'src/services/pluginLoader.ts',
      status: 'GENERATED',
      ragContextCount: 4,
      explanation: 'Added schema sanitization and prototype pollution prevention checks before parsing dynamic plugin configuration payloads.',
      diffContent: `--- a/src/services/pluginLoader.ts
+++ b/src/services/pluginLoader.ts
@@ -60,4 +60,5 @@
+  const safeConfig = sanitizeSchema(pluginConfig);
+  validatePluginSignature(safeConfig);
-  const plugin = JSON.parse(pluginConfig, reviver);
+  const plugin = JSON.parse(safeConfig);`,
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
