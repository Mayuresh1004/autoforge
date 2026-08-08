/**
 * Engineer test fixtures — in-memory implementations of the Engineer's
 * ports (patch repo, confirmed-finding repo, source reader, RagService, LLM
 * provider) plus a READY runtime sandbox builder. Mirror helpers for other
 * modules; no network, no Prisma, no Docker.
 */

import type { RuntimeSandboxContext } from '../../src/sandbox/domain/entities/runtime-sandbox';
import type { ConfirmedFindingRepository } from '../../src/engineer/domain/ports/confirmed-finding-repository';
import type { ConfirmedVulnerabilityFinding } from '../../src/engineer/domain/ports/confirmed-finding-repository';
import type { EngineerPatchRecord, EngineerPatchRepository, SaveEngineerPatchInput } from '../../src/engineer/domain/ports/patch-repository';
import type { EngineerSourceReader, SourceReadRequest, SourceReadResult } from '../../src/engineer/domain/ports/source-reader';
import type { RagQuery, RagResult, RagService } from '../../src/knowledge/application/services/rag.service';
import type { LLMProvider, LLMResponse, LLMRequest, ModelInfo, ProviderHealth } from '../../src/llm/domain/ports/llm-provider';

// ---------------------------------------------------------------------------

export function readyRuntimeSandbox(overrides: Partial<RuntimeSandboxContext> = {}): RuntimeSandboxContext {
  return {
    id: 'rt-1',
    scanId: 'scan-1',
    sandboxId: 'sandbox-1',
    targetUrl: 'http://127.0.0.1:33001',
    internalHost: '10.0.0.5',
    internalPort: 3000,
    exposedPort: 33001,
    ...overrides,
  };
}

export function confirmedFinding(overrides: Partial<ConfirmedVulnerabilityFinding> = {}): ConfirmedVulnerabilityFinding {
  return {
    vulnerabilityId: 'vuln-1',
    scanId: 'scan-1',
    exploitId: 'exploit-1',
    type: 'SQL_INJECTION',
    status: 'CONFIRMED',
    severity: 'HIGH',
    confidence: 0.9,
    cwe: null,
    cve: null,
    title: 'SQL injection in search endpoint',
    message: 'String concatenation in SQL query',
    filePath: 'src/app.py',
    lineNumber: 42,
    endpoint: '/api/search',
    method: 'GET',
    parameter: 'q',
    evidence: 'sqlmap:injection_point@query: (GET) parameter #1',
    reason: 'sqlmap confirmed boolean-based blind injection',
    exploitDepth: 3,
    confirmedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

export class MemoryEngineerPatchRepository implements EngineerPatchRepository {
  private readonly rows = new Map<string, EngineerPatchRecord>();
  private nextId = 1;

  async saveGeneratedPatch(input: SaveEngineerPatchInput): Promise<EngineerPatchRecord> {
    const row: EngineerPatchRecord = {
      id: `patch-${this.nextId++}`,
      vulnerabilityId: input.vulnerabilityId,
      status: input.status,
      filePath: input.filePath,
      diffContent: input.diffContent,
      explanation: input.explanation,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(row.id, row);
    return row;
  }

  async getById(id: string): Promise<EngineerPatchRecord | null> {
    return this.rows.get(id) ?? null;
  }

  async getByVulnerabilityId(vulnerabilityId: string): Promise<EngineerPatchRecord | null> {
    return [...this.rows.values()].reverse().find((r) => r.vulnerabilityId === vulnerabilityId) ?? null;
  }

  all(): readonly EngineerPatchRecord[] {
    return [...this.rows.values()];
  }
}

export class MemoryConfirmedFindingRepository implements ConfirmedFindingRepository {
  private readonly rows: ConfirmedVulnerabilityFinding[];

  constructor(rows: readonly ConfirmedVulnerabilityFinding[] = []) {
    this.rows = [...rows];
  }

  async listConfirmed(scanId: string): Promise<readonly ConfirmedVulnerabilityFinding[]> {
    return this.rows.filter((f) => f.scanId === scanId);
  }

  async findByVulnerabilityId(
    scanId: string,
    vulnerabilityId: string,
  ): Promise<ConfirmedVulnerabilityFinding | null> {
    return this.rows.find((f) => f.scanId === scanId && f.vulnerabilityId === vulnerabilityId) ?? null;
  }
}

export class StubEngineerSourceReader implements EngineerSourceReader {
  readonly reads: Array<{ path: string; startLine: number | null; endLine: number | null; maxBytes?: number }> = [];
  private readonly files = new Map<string, SourceReadResult>();
  private throwOnRead: Error | null = null;

  constructor(files: Record<string, string | SourceReadResult> = {}) {
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === 'string') {
        const lines = content.split('\n');
        this.files.set(path, { filePath: path, lines, offset: 1, truncated: false, byteLength: content.length });
      } else {
        this.files.set(path, content);
      }
    }
  }

  failNext(error: Error): void {
    this.throwOnRead = error;
  }

  async read(context: RuntimeSandboxContext, request: SourceReadRequest): Promise<SourceReadResult> {
    this.reads.push({ path: request.path, startLine: request.startLine ?? null, endLine: request.endLine ?? null, maxBytes: request.maxBytes });
    if (this.throwOnRead) {
      const error = this.throwOnRead;
      this.throwOnRead = null;
      throw error;
    }
    const result = this.files.get(request.path);
    if (!result) throw new Error(`source not found: ${request.path}`);
    return result;
  }
}

export class StubRagService implements RagService {
  calls: Array<RagQuery> = [];
  private docs: RagResult['documents'] = [];
  private throwOnSearch: Error | null = null;

  constructor(docs: RagResult['documents'] = []) {
    this.docs = docs;
  }

  failNext(error: Error): void {
    this.throwOnSearch = error;
  }

  async search(query: RagQuery): Promise<RagResult> {
    this.calls.push(query);
    if (this.throwOnSearch) {
      const error = this.throwOnSearch;
      this.throwOnSearch = null;
      throw error;
    }
    return { query: query.query, documents: this.docs };
  }
}

export class ProgrammedLLMProvider implements LLMProvider {
  readonly requests: Array<{ messages: unknown; temperature?: number; maxTokens?: number }> = [];
  private nextText: string | null = null;
  private nextError: Error | null = null;

  constructor(private readonly model = 'fake/free') {}

  setText(text: string): void {
    this.nextText = text;
  }

  failNext(error: Error): void {
    this.nextError = error;
  }

  async generate(request: {
    readonly messages: readonly { role: string; content: string }[];
    readonly temperature?: number;
    readonly maxTokens?: number;
    readonly responseFormat?: string;
  }): Promise<LLMResponse> {
    this.requests.push({ messages: request.messages as unknown[], temperature: request.temperature, maxTokens: request.maxTokens });
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = null;
      throw error;
    }
    const text = this.nextText ?? '{"status":null}';
    this.nextText = null;
    return {
      text,
      finishReason: 'stop',
      model: this.model,
      usage: { inputTokens: 10, outputTokens: 20, estimatedCost: 0 },
    };
  }

  async healthCheck(): Promise<{ ok: true; latencyMs: 0 }> {
    return { ok: true, latencyMs: 0 };
  }

  getModelInfo(): ModelInfo {
    return { provider: 'gemini', model: this.model, freeAlias: false, supportsStructuredJson: true };
  }
}

/** A valid unified diff for the fixture finding. */
export const SQLI_PATCH_DIFF = `--- a/src/app.py
+++ b/src/app.py
@@ -40,7 +40,7 @@
 def search(q):
-    query = "SELECT * FROM items WHERE name = '" + q + "'"
-    cursor.execute(query)
+    query = "SELECT * FROM items WHERE name = %s"
+    cursor.execute(query, (q,))
`;

export const SQLI_PATCH_JSON = JSON.stringify({
  vulnerabilityId: 'vuln-1',
  status: 'GENERATED',
  filePath: 'src/app.py',
  diff: SQLI_PATCH_DIFF,
  explanation: 'Replaced string concatenation with a parameterized query so user input can never alter the SQL grammar.',
  remediation: 'parameterized query',
  assumptions: ['The search parameter is the only injection point'],
  reason: null,
});