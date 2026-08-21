import { describe, expect, it } from 'vitest';
import { DefaultSniperService } from './sniper.service';
import { DefaultVerifierRegistry } from '../../infrastructure/verifiers/verifier-registry';
import { FileUploadVerifier } from '../../infrastructure/verifiers/file-upload/file-upload-verifier';
import { SsrfVerifier } from '../../infrastructure/verifiers/ssrf/ssrf-verifier';
import { XssVerifier } from '../../infrastructure/verifiers/xss/xss-verifier';
import { BrokenAccessControlVerifier } from '../../infrastructure/verifiers/broken-access-control/broken-access-control-verifier';
import { SqlInjectionVerifier } from '../../infrastructure/verifiers/sql-injection/sql-injection-verifier';
import { MemorySniperRepository } from '../../../../test/helpers/sniper-repository-memory';
import { StubSandboxManager } from '../../../../test/helpers/stub-sandbox-manager';
import { stubSandbox, TEST_SNIPER_CONFIG } from '../../../../test/helpers/sniper-test-harness';
import { execResult } from '../../../../test/helpers/fake-tool-runtime';
import type { PlannedTargetSnapshot } from '../../domain/ports/sniper-repository';
import type { RunSniperInput } from '../../domain/ports/sniper-service';

const SCAN = 'scan-integration-1';
const SANDBOX = 'sbx_scan-integration-1_abcd';

function plannedTarget(
  targetId: string,
  candidate: string,
  endpoint: string,
  method = 'POST'
): PlannedTargetSnapshot {
  return {
    id: `row-${targetId}`,
    targetId,
    scanId: SCAN,
    endpoint,
    method,
    candidateVulnerabilities: [candidate],
    priority: 95,
    recommendedTool: 'prober',
    reason: 'planner hypothesis',
    requiresAuthentication: false,
    estimatedRisk: 'HIGH',
  };
}

describe('Sniper Real Pipeline Integration — Planner → Sniper Dispatch → Verifier → Persistence', () => {
  it('dispatches PLANNED FILE_UPLOAD to FileUploadVerifier and persists CONFIRMED result with evidence', async () => {
    const repository = new MemorySniperRepository();
    const manager = new StubSandboxManager();
    manager.seed(stubSandbox(SANDBOX, SCAN));

    repository.seedTarget(plannedTarget('t-upload', 'File Upload', 'http://app:8080/upload'));
    // Baseline -> 200 OK
    manager.execQueue.push(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"status":"ready"}' }));
    // Probe -> 201 Created with upload URL
    manager.execQueue.push(
      execResult({ stdout: 'HTTP/1.1 201 Created\r\n\r\n{"url":"/static/uploads/exploit_poc.py"}' })
    );

    const verifiers = new DefaultVerifierRegistry([
      new SqlInjectionVerifier(),
      new FileUploadVerifier(),
      new SsrfVerifier(),
      new XssVerifier(),
      new BrokenAccessControlVerifier(),
    ]);

    const service = new DefaultSniperService({
      repository,
      manager,
      verifiers,
      config: TEST_SNIPER_CONFIG,
    });

    const runInput: RunSniperInput = {
      scanId: SCAN,
      sandboxId: SANDBOX,
      baseUrl: 'http://app:8080',
      targetIds: ['t-upload'],
    };

    const report = await service.run(runInput);
    expect(report.results).toHaveLength(1);

    const poc = report.results[0].exploit;
    expect(poc.status).toBe('CONFIRMED');
    expect(poc.type).toBe('FILE_UPLOAD');
    expect(poc.evidence.length).toBeGreaterThan(0);
    expect(poc.evidence[0].indicator).toBe('file_upload:payload_acceptance_and_reachability_confirmed');

    // Verify persisted in repository
    const stored = await repository.getExploitForTarget('t-upload', 'FILE_UPLOAD');
    expect(stored).toBeDefined();
    expect(stored?.status).toBe('CONFIRMED');
  });

  it('dispatches PLANNED SSRF to SsrfVerifier and persists result', async () => {
    const repository = new MemorySniperRepository();
    const manager = new StubSandboxManager();
    manager.seed(stubSandbox(SANDBOX, SCAN));

    repository.seedTarget(plannedTarget('t-ssrf', 'SSRF', 'http://app:8080/fetch?url=test', 'GET'));
    manager.execQueue.push(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"status":"ready"}' }));
    manager.execQueue.push(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"content":"{\\"status\\":\\"UP\\"}"}' }));

    const verifiers = new DefaultVerifierRegistry([
      new SqlInjectionVerifier(),
      new FileUploadVerifier(),
      new SsrfVerifier(),
      new XssVerifier(),
      new BrokenAccessControlVerifier(),
    ]);

    const service = new DefaultSniperService({ repository, manager, verifiers, config: TEST_SNIPER_CONFIG });
    const report = await service.run({ scanId: SCAN, sandboxId: SANDBOX, baseUrl: 'http://app:8080', targetIds: ['t-ssrf'] });

    const poc = report.results[0].exploit;
    expect(poc.status).toBe('CONFIRMED');
    expect(poc.type).toBe('SSRF');
  });

  it('dispatches PLANNED XSS to XssVerifier and persists result', async () => {
    const repository = new MemorySniperRepository();
    const manager = new StubSandboxManager();
    manager.seed(stubSandbox(SANDBOX, SCAN));

    repository.seedTarget(plannedTarget('t-xss', 'Cross-Site Scripting', 'http://app:8080/search?q=test', 'GET'));
    manager.execQueue.push(execResult({ stdout: 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html></html>' }));
    manager.execQueue.push(
      execResult({ stdout: "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<script>alert('AMASS_XSS_VERIFIED')</script>" })
    );

    const verifiers = new DefaultVerifierRegistry([
      new SqlInjectionVerifier(),
      new FileUploadVerifier(),
      new SsrfVerifier(),
      new XssVerifier(),
      new BrokenAccessControlVerifier(),
    ]);

    const service = new DefaultSniperService({ repository, manager, verifiers, config: TEST_SNIPER_CONFIG });
    const report = await service.run({ scanId: SCAN, sandboxId: SANDBOX, baseUrl: 'http://app:8080', targetIds: ['t-xss'] });

    const poc = report.results[0].exploit;
    expect(poc.status).toBe('CONFIRMED');
    expect(poc.type).toBe('XSS');
  });

  it('dispatches PLANNED IDOR to BrokenAccessControlVerifier and persists result', async () => {
    const repository = new MemorySniperRepository();
    const manager = new StubSandboxManager();
    manager.seed(stubSandbox(SANDBOX, SCAN));

    const target = plannedTarget('t-idor', 'IDOR', 'http://app:8080/api/documents/doc_1', 'GET');
    target.requiresAuthentication = true;
    repository.seedTarget(target);

    manager.execQueue.push(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"id":"doc_1","owner":"user_A"}' }));
    manager.execQueue.push(execResult({ stdout: 'HTTP/1.1 200 OK\r\n\r\n{"id":"doc_1","owner":"user_A"}' }));

    const verifiers = new DefaultVerifierRegistry([
      new SqlInjectionVerifier(),
      new FileUploadVerifier(),
      new SsrfVerifier(),
      new XssVerifier(),
      new BrokenAccessControlVerifier(),
    ]);

    const service = new DefaultSniperService({ repository, manager, verifiers, config: TEST_SNIPER_CONFIG });
    const report = await service.run({
      scanId: SCAN,
      sandboxId: SANDBOX,
      baseUrl: 'http://app:8080',
      targetIds: ['t-idor'],
      credentials: { header: 'Authorization: Bearer token_user_A, Bearer token_user_B' },
    });

    const poc = report.results[0].exploit;
    expect(poc.status).toBe('CONFIRMED');
    expect(poc.type).toBe('IDOR');
  });

  it('returns NOT_TESTED for IDOR when dual session credentials are missing', async () => {
    const repository = new MemorySniperRepository();
    const manager = new StubSandboxManager();
    manager.seed(stubSandbox(SANDBOX, SCAN));

    const target = plannedTarget('t-idor-single', 'IDOR', 'http://app:8080/api/documents/doc_1', 'GET');
    target.requiresAuthentication = true;
    repository.seedTarget(target);

    const verifiers = new DefaultVerifierRegistry([
      new BrokenAccessControlVerifier(),
    ]);

    const service = new DefaultSniperService({ repository, manager, verifiers, config: TEST_SNIPER_CONFIG });
    const report = await service.run({
      scanId: SCAN,
      sandboxId: SANDBOX,
      baseUrl: 'http://app:8080',
      targetIds: ['t-idor-single'],
      credentials: { header: 'Authorization: Bearer token_user_A_only' },
    });

    const poc = report.results[0].exploit;
    expect(poc.status).toBe('NOT_TESTED');
    expect(poc.reason).toContain('Two authenticated authorization contexts are required');
  });

  it('handles unsupported vulnerability type cleanly by recording NOT_TESTED refusal', async () => {
    const repository = new MemorySniperRepository();
    const manager = new StubSandboxManager();
    manager.seed(stubSandbox(SANDBOX, SCAN));

    repository.seedTarget(plannedTarget('t-unsupported', 'UNKNOWN_FUTURE_VULN', 'http://app:8080/unknown'));

    const verifiers = new DefaultVerifierRegistry([new SqlInjectionVerifier()]);
    const service = new DefaultSniperService({ repository, manager, verifiers, config: TEST_SNIPER_CONFIG });

    const report = await service.run({ scanId: SCAN, sandboxId: SANDBOX, baseUrl: 'http://app:8080', targetIds: ['t-unsupported'] });
    const poc = report.results[0].exploit;

    expect(poc.status).toBe('NOT_TESTED');
    expect(poc.reason).toContain('unsupported candidate vulnerability');
  });
});
