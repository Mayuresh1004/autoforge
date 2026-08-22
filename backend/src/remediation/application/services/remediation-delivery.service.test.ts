import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { RemediationDeliveryService } from './remediation-delivery.service';
import type { PullRequestGateway } from '../../domain/ports/pull-request-gateway';

describe('RemediationDeliveryService', () => {
  let mockPrisma: any;
  let mockGateway: PullRequestGateway;
  let mockEvents: any;
  let service: RemediationDeliveryService;

  const SCAN_ID = 'scan-123';
  const PATCH_ID = 'patch-abc';
  const VULN_ID = 'vuln-456';

  const sampleApprovedPatch = {
    id: PATCH_ID,
    vulnerabilityId: VULN_ID,
    status: 'APPROVED',
    filePath: 'server/routes/users.js',
    diffContent: '--- a/server/routes/users.js\n+++ b/server/routes/users.js\n@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;',
    explanation: 'Parameterized query fix',
    vulnerability: {
      id: VULN_ID,
      title: 'SQL injection in users route',
      vulnType: 'SQL_INJECTION',
      severity: 'HIGH',
      cweId: 'CWE-89',
      scan: {
        id: SCAN_ID,
        repositories: [
          {
            repository: {
              url: 'https://github.com/Mayuresh1004/owasp-vuln-lab.git',
              branch: 'main',
            },
          },
        ],
      },
    },
  };

  beforeEach(() => {
    mockPrisma = {
      patch: {
        findUnique: vi.fn().mockResolvedValue(sampleApprovedPatch),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    mockGateway = {
      createPullRequest: vi.fn().mockResolvedValue({
        prNumber: 42,
        prUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/42',
        commitSha: 'abc123def456',
        headBranch: `amass/remediation/${PATCH_ID}`,
        prStatus: 'OPEN',
      }),
    };

    mockEvents = {
      publish: vi.fn(),
    };

    service = new RemediationDeliveryService({
      prisma: mockPrisma as unknown as PrismaClient,
      gateway: mockGateway,
      events: mockEvents,
    });
  });

  it('delivers APPROVED patch, creates PR, updates DB, and emits REMEDIATION_PR_CREATED event', async () => {
    const result = await service.deliver({ scanId: SCAN_ID, patchId: PATCH_ID });

    expect(result.status).toBe('DELIVERED');
    expect(result.prNumber).toBe(42);
    expect(result.prUrl).toBe('https://github.com/Mayuresh1004/owasp-vuln-lab/pull/42');
    expect(result.prBranch).toBe(`amass/remediation/${PATCH_ID}`);
    expect(result.prCommitSha).toBe('abc123def456');

    // Gateway invoked with exact approved diff and branch
    expect(mockGateway.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        baseBranch: 'main',
        headBranch: `amass/remediation/${PATCH_ID}`,
        filePath: 'server/routes/users.js',
        diffContent: sampleApprovedPatch.diffContent,
        patchId: PATCH_ID,
        cloneUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab.git',
      })
    );

    // Database updated with PR metadata
    expect(mockPrisma.patch.update).toHaveBeenCalledWith({
      where: { id: PATCH_ID },
      data: expect.objectContaining({
        prNumber: 42,
        prUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/42',
        prBranch: `amass/remediation/${PATCH_ID}`,
        prCommitSha: 'abc123def456',
        prStatus: 'OPEN',
        prError: null,
      }),
    });

    // Event published
    expect(mockEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'REMEDIATION_PR_CREATED',
        scanId: SCAN_ID,
        status: 'SUCCEEDED',
        metadata: expect.objectContaining({
          patchId: PATCH_ID,
          prNumber: 42,
          prUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/42',
        }),
      })
    );
  });

  it('is idempotent: APPROVED patch with existing PR metadata returns existing result without calling gateway', async () => {
    mockPrisma.patch.findUnique.mockResolvedValueOnce({
      ...sampleApprovedPatch,
      prNumber: 42,
      prUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/42',
      prBranch: `amass/remediation/${PATCH_ID}`,
      prCommitSha: 'abc123def456',
    });

    const result = await service.deliver({ scanId: SCAN_ID, patchId: PATCH_ID });

    expect(result.status).toBe('DELIVERED');
    expect(result.prNumber).toBe(42);
    expect(result.prUrl).toBe('https://github.com/Mayuresh1004/owasp-vuln-lab/pull/42');
    expect(mockGateway.createPullRequest).not.toHaveBeenCalled();
    expect(mockPrisma.patch.update).not.toHaveBeenCalled();
  });

  it('refuses delivery for GENERATED patches', async () => {
    mockPrisma.patch.findUnique.mockResolvedValueOnce({
      ...sampleApprovedPatch,
      status: 'GENERATED',
    });

    await expect(service.deliver({ scanId: SCAN_ID, patchId: PATCH_ID })).rejects.toThrow(
      /Delivery refused: patch patch-abc status is GENERATED/
    );

    expect(mockGateway.createPullRequest).not.toHaveBeenCalled();
  });

  it('refuses delivery for REJECTED patches', async () => {
    mockPrisma.patch.findUnique.mockResolvedValueOnce({
      ...sampleApprovedPatch,
      status: 'REJECTED',
    });

    await expect(service.deliver({ scanId: SCAN_ID, patchId: PATCH_ID })).rejects.toThrow(
      /Delivery refused: patch patch-abc status is REJECTED/
    );

    expect(mockGateway.createPullRequest).not.toHaveBeenCalled();
  });

  it('handles delivery failure gracefully: preserves APPROVED status, populates prError, emits REMEDIATION_DELIVERY_FAILED', async () => {
    mockGateway.createPullRequest = vi.fn().mockRejectedValueOnce(new Error('GitHub API permission denied'));

    const result = await service.deliver({ scanId: SCAN_ID, patchId: PATCH_ID });

    expect(result.status).toBe('FAILED');
    expect(result.error).toContain('GitHub API permission denied');

    // Updates patch prError without changing Patch.status away from APPROVED
    expect(mockPrisma.patch.update).toHaveBeenCalledWith({
      where: { id: PATCH_ID },
      data: { prError: expect.stringContaining('GitHub API permission denied') },
    });

    // Event published
    expect(mockEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'REMEDIATION_DELIVERY_FAILED',
        scanId: SCAN_ID,
        status: 'FAILED',
      })
    );
  });
});
