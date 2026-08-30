import { describe, it, expect, vi } from 'vitest';
import { isSupportedConfirmedFinding } from '../src/engineer/application/services/engineer-selection';
import { validateEngineerResponse } from '../src/engineer/application/services/response-validator';
import { SecurityReviewGate } from '../src/engineer/application/services/security-review-gate';
import { BrokenAccessControlVerifier } from '../src/sniper/infrastructure/verifiers/broken-access-control/broken-access-control-verifier';

describe('Broken Access Control Isolation Verification', () => {
  it('identifies BROKEN_ACCESS_CONTROL as a supported confirmed finding for Engineer', () => {
    const finding: any = {
      vulnerabilityId: 'vuln_bac_101',
      status: 'CONFIRMED',
      type: 'BROKEN_ACCESS_CONTROL',
      severity: 'HIGH',
      confidence: 0.95,
      filePath: 'server/routes/users.js',
    };

    expect(isSupportedConfirmedFinding(finding)).toBe(true);
  });

  it('runs BrokenAccessControlVerifier correctly on target GET /api/users/1', async () => {
    const verifier = new BrokenAccessControlVerifier();
    const mockRuntime: any = {
      execute: vi.fn().mockImplementation(async ({ argv }: { argv: string[] }) => {
        // If owner request (user_A) -> return User A profile data
        if (argv.some((a) => a.includes('token_user_A'))) {
          return {
            exitCode: 0,
            stdout: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"id":1,"name":"Alice","owner":"user_A","email":"alice@example.com"}',
            stderr: '',
            durationMs: 30,
          };
        }
        // If attacker request (user_B) -> return User A profile data (IDOR vulnerability confirmed)
        return {
          exitCode: 0,
          stdout: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"id":1,"name":"Alice","owner":"user_A","email":"alice@example.com"}',
          stderr: '',
          durationMs: 30,
        };
      }),
    };

    const target: any = {
      targetId: 'tgt_bac_1',
      endpoint: 'http://localhost:3000/api/users/1',
      method: 'GET',
      vulnerabilityType: 'BROKEN_ACCESS_CONTROL',
      requiresAuthentication: true,
      credentials: { header: 'Authorization: Bearer token_user_A' },
      attackerCredentials: { header: 'Authorization: Bearer token_user_B' },
    };

    const context: any = {
      scanId: 'scan_bac_isolation',
      sandboxId: 'sbx_bac_1',
      runtime: mockRuntime,
      timeoutMs: 5000,
    };

    const outcome = await verifier.verify(target, context);
    expect(outcome.status).toBe('CONFIRMED');
    expect(outcome.reason).toContain('IDOR / Broken Access Control confirmed');
  });

  it('validates structured EngineerResponse and SecurityReviewGate for BROKEN_ACCESS_CONTROL', async () => {
    const rawLLMResponse = {
      vulnerabilityId: 'vuln_bac_101',
      status: 'GENERATED',
      filePath: 'server/routes/users.js',
      originalCode: "router.get('/users/:id', (req, res) => { const user = db.find(req.params.id); res.json(user); });",
      patchedCode: "router.get('/users/:id', authMiddleware, (req, res) => { if (req.user.id !== req.params.id && !req.user.isAdmin) return res.status(403).json({ error: 'Forbidden' }); const user = db.find(req.params.id); res.json(user); });",
      explanation: 'Enforces session authentication and authorization check before returning user profile data.',
      remediation: 'input validation boundary',
      assumptions: ['authMiddleware attaches req.user'],
    };

    const validated = validateEngineerResponse(rawLLMResponse, {
      vulnerabilityId: 'vuln_bac_101',
      filePath: 'server/routes/users.js',
    });

    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const mockRegistry: any = { get: vi.fn().mockResolvedValue('template content') };
    const gate = new SecurityReviewGate(mockRegistry);

    const reviewInput: any = {
      response: validated.response,
      finding: {
        vulnerabilityId: 'vuln_bac_101',
        type: 'BROKEN_ACCESS_CONTROL',
        filePath: 'server/routes/users.js',
      },
      sourceRead: true,
      ragDocsUsed: 1,
    };

    const review = await gate.run(reviewInput);
    expect(review.passed).toBe(true);
  });
});
