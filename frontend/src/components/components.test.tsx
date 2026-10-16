import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AgentPipeline } from './pipeline/AgentPipeline';
import { EventItem } from './timeline/EventItem';
import { FindingCard } from './findings/FindingCard';
import { PatchView } from './remediation/PatchView';
import { PullRequestPanel } from './remediation/PullRequestPanel';
import { ValidationMatrix } from './critic/ValidationMatrix';
import type { AmassEvent } from '../types/amass-events';
import type { FindingModel, PatchModel } from '../types/api-types';
import type { AgentState, CriticStageState } from '../hooks/useScanStore';

describe('Frontend UI Components', () => {
  it('renders AgentPipeline with agent stages including PR Created', () => {
    const mockAgents: Record<string, AgentState> = {
      ANALYZER: { type: 'ANALYZER', status: 'COMPLETED' },
      SCANNER: { type: 'SCANNER', status: 'COMPLETED' },
      SANDBOX: { type: 'SANDBOX', status: 'COMPLETED' },
      SCOUT: { type: 'SCOUT', status: 'COMPLETED' },
      PLANNER: { type: 'PLANNER', status: 'COMPLETED' },
      SNIPER: { type: 'SNIPER', status: 'COMPLETED' },
      ENGINEER: { type: 'ENGINEER', status: 'COMPLETED' },
      CRITIC: { type: 'CRITIC', status: 'COMPLETED' },
      REMEDIATION_DELIVERY: {
        type: 'REMEDIATION_DELIVERY',
        status: 'COMPLETED',
        prNumber: 7,
        prUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/7',
      },
    } as any;

    render(<AgentPipeline agents={mockAgents} />);
    expect(screen.getByText('Analyzer')).toBeInTheDocument();
    expect(screen.getByText('Engineer')).toBeInTheDocument();
    expect(screen.getByText('Critic')).toBeInTheDocument();
    expect(screen.getByText('PR Created')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('View PR ↗')).toHaveAttribute(
      'href',
      'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/7'
    );
  });

  it('renders EventItem with sequence number and message', () => {
    const mockEvent: AmassEvent = {
      eventId: 'evt_99',
      scanId: 'scan_1',
      sequence: 42,
      timestamp: '2026-08-09T12:30:00Z',
      eventType: 'ENGINEER_PATCH_GENERATED',
      agentType: 'ENGINEER',
      phase: 'remediation',
      level: 'INFO',
      status: 'SUCCEEDED',
      message: 'Generated patch for SQL Injection',
    };

    render(<EventItem event={mockEvent} onInspect={() => {}} />);
    expect(screen.getByText('#0042')).toBeInTheDocument();
    expect(screen.getByText('ENGINEER_PATCH_GENERATED')).toBeInTheDocument();
    expect(screen.getByText('Generated patch for SQL Injection')).toBeInTheDocument();
  });

  it('renders FindingCard with severity badge and title', () => {
    const mockFinding: FindingModel = {
      id: 'f_1',
      scanId: 'scan_1',
      ruleId: 'sqli-01',
      title: 'SQL Injection in /api/login',
      description: 'Unsanitized input passed directly to database query.',
      severity: 'CRITICAL',
      confidence: 'HIGH',
      filePath: 'src/routes/auth.ts',
      lineStart: 45,
      lineEnd: 48,
      endpoint: '/api/login',
      isConfirmed: true,
    };

    render(<FindingCard finding={mockFinding} />);
    expect(screen.getByText('CRITICAL')).toBeInTheDocument();
    expect(screen.getByText('SQL Injection in /api/login')).toBeInTheDocument();
    expect(screen.getByText('🎯 CONFIRMED')).toBeInTheDocument();
  });

  it('renders FindingCard with PR CREATED badge and clickable link when delivered', () => {
    const mockFinding: FindingModel = {
      id: 'f_pr',
      scanId: 'scan_1',
      title: 'A01: Broken Access Control',
      severity: 'HIGH',
      status: 'CRITIC_VERIFIED',
      patch: {
        patchId: 'patch_1',
        findingId: 'f_pr',
        scanId: 'scan_1',
        filePath: 'src/routes/admin.ts',
        diffContent: 'diff',
        status: 'APPROVED',
        prNumber: 7,
        prUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/7',
        prBranch: 'amass/remediation/patch_1',
      },
    };

    render(<FindingCard finding={mockFinding} />);
    expect(screen.getByText('✓ PR CREATED #7')).toBeInTheDocument();
    const link = screen.getByText('View Pull Request ↗');
    expect(link).toHaveAttribute('href', 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/7');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders FindingCard with PR DELIVERY FAILED badge and error message when failed', () => {
    const mockFinding: FindingModel = {
      id: 'f_fail',
      scanId: 'scan_1',
      title: 'A03: SQL Injection',
      severity: 'HIGH',
      status: 'CRITIC_VERIFIED',
      patch: {
        patchId: 'patch_fail',
        findingId: 'f_fail',
        scanId: 'scan_1',
        filePath: 'src/routes/search.ts',
        diffContent: 'diff',
        status: 'APPROVED',
        prError: 'GitHub API 403 Forbidden',
      },
    };

    render(<FindingCard finding={mockFinding} />);
    expect(screen.getByText('✕ PR DELIVERY FAILED')).toBeInTheDocument();
    expect(screen.getByText('GitHub API 403 Forbidden')).toBeInTheDocument();
  });

  it('renders PatchView with diff content', () => {
    const mockPatches: PatchModel[] = [
      {
        patchId: 'patch_1',
        scanId: 'scan_1',
        filePath: 'src/routes/auth.ts',
        diffContent: '- const query = raw;\n+ const query = sanitize(raw);',
        status: 'GENERATED',
        explanation: 'Replaced string concatenation with parameterized query',
      },
    ];

    render(<PatchView patches={mockPatches} />);
    expect(screen.getAllByText('src/routes/auth.ts')[0]).toBeInTheDocument();
    expect(screen.getByText('Replaced string concatenation with parameterized query')).toBeInTheDocument();
  });

  it('renders PullRequestPanel with delivered PR details and clickable link', () => {
    const mockPatches: PatchModel[] = [
      {
        patchId: 'patch_pr_1',
        scanId: 'scan_1',
        filePath: 'src/routes/admin.ts',
        diffContent: '+ requireAdmin',
        status: 'APPROVED',
        prNumber: 7,
        prUrl: 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/7',
        prBranch: 'amass/remediation/patch_pr_1',
        prCommitSha: 'a7b3c9f1234',
        prStatus: 'OPEN',
      },
    ];

    render(<PullRequestPanel patches={mockPatches} />);
    expect(screen.getByText('Pull Request Remediation Delivery')).toBeInTheDocument();
    expect(screen.getByText('✓ PR CREATED #7')).toBeInTheDocument();
    expect(screen.getByText('amass/remediation/patch_pr_1')).toBeInTheDocument();

    const prButton = screen.getByText('View Pull Request ↗');
    expect(prButton).toHaveAttribute('href', 'https://github.com/Mayuresh1004/owasp-vuln-lab/pull/7');
    expect(prButton).toHaveAttribute('target', '_blank');
  });

  it('renders ValidationMatrix with per-vulnerability QA matrix', () => {
    const mockFindings: FindingModel[] = [
      {
        id: 'fnd-1',
        title: 'Broken Access Control',
        severity: 'CRITICAL',
        filePath: 'src/routes/admin.ts',
        status: 'CRITIC_VERIFIED',
      },
    ];

    const mockStages: CriticStageState[] = [
      { name: 'Baseline System Check', key: 'baseline', status: 'PASSED' },
      { name: 'Patch Application', key: 'patch_apply', status: 'PASSED' },
      { name: 'Sandbox Build', key: 'build', status: 'PASSED' },
      { name: 'Test Suite Execution', key: 'tests', status: 'PASSED' },
      { name: 'Exploit Retest Verification', key: 'retest', status: 'PASSED' },
      { name: 'Final Security Verdict', key: 'approval', status: 'PASSED' },
    ];

    render(<ValidationMatrix findings={mockFindings} stages={mockStages} />);
    expect(screen.getByText('Broken Access Control')).toBeInTheDocument();
    expect(screen.getByText('APPROVED')).toBeInTheDocument();
  });

  it('renders PullRequestPanel with simulated demo PR without clickable external link', () => {
    const mockPatches: PatchModel[] = [
      {
        patchId: 'patch-fnd-webgoat-pathtraversal',
        scanId: 'scan_wg8e12f0',
        filePath: 'src/main/java/org/owasp/webgoat/lessons/pathtraversal/ProfileUpload.java',
        diffContent: '+ targetPath.startsWith',
        status: 'APPROVED',
        prNumber: 102,
        prUrl: null,
        isSimulated: true,
        prBranch: 'amass/remediation/fix-path-traversal-profile-upload',
        prCommitSha: '9b3c41a2e5d7f8c1234567890abcdef123456790',
        prStatus: 'OPEN',
      },
    ];

    render(<PullRequestPanel patches={mockPatches} />);
    expect(screen.getByText('✓ SIMULATED PR #102')).toBeInTheDocument();
    expect(screen.getByText('Simulated Pull Request Generated (Demo Fixture)')).toBeInTheDocument();
    expect(screen.getByText('Simulated Demo PR (No Upstream PR)')).toBeInTheDocument();

    // Verify there are no clickable external links to upstream PR 102
    const links = screen.queryAllByRole('link');
    const pr102Link = links.find((l) => l.getAttribute('href')?.includes('102'));
    expect(pr102Link).toBeUndefined();
  });

  it('renders ValidationMatrix with simulated demo PR as non-clickable badge', () => {
    const mockFindings: FindingModel[] = [
      {
        id: 'fnd-webgoat-pathtraversal',
        title: 'Path Traversal',
        severity: 'HIGH',
        filePath: 'src/main/java/org/owasp/webgoat/lessons/pathtraversal/ProfileUpload.java',
        status: 'CRITIC_VERIFIED',
        patch: {
          patchId: 'patch-fnd-webgoat-pathtraversal',
          scanId: 'scan_wg8e12f0',
          filePath: 'src/main/java/org/owasp/webgoat/lessons/pathtraversal/ProfileUpload.java',
          diffContent: '+ test',
          status: 'APPROVED',
          prNumber: 102,
          prUrl: null,
          isSimulated: true,
        },
      },
    ];

    const mockStages: CriticStageState[] = [
      { name: 'Final Security Verdict', key: 'approval', status: 'PASSED' },
    ];

    render(<ValidationMatrix findings={mockFindings} stages={mockStages} />);
    expect(screen.getByText('✓ PR #102 (demo)')).toBeInTheDocument();

    // Verify no anchor link for PR 102
    const links = screen.queryAllByRole('link');
    const pr102Link = links.find((l) => l.getAttribute('href')?.includes('102'));
    expect(pr102Link).toBeUndefined();
  });

  it('renders PullRequestPanel and ValidationMatrix with real WebGoat PR delivery on Mayuresh1004/WebGoat', () => {
    const mockWebGoatPatch: PatchModel = {
      patchId: 'patch-fnd-webgoat-pathtraversal',
      findingId: 'fnd-webgoat-pathtraversal',
      scanId: 'scan_wg8e12f0',
      filePath: 'src/main/java/org/owasp/webgoat/lessons/pathtraversal/ProfileUpload.java',
      diffContent: '+ fullName.replace("../", "")',
      status: 'APPROVED',
      prNumber: 1,
      prUrl: 'https://github.com/Mayuresh1004/WebGoat/pull/1',
      prBranch: 'amass/remediation/fix-path-traversal-profile-upload',
      prBaseBranch: 'main',
      prCommitSha: 'bde003e5114759d7453a26ee6716372dd1f1f0b8',
      prStatus: 'OPEN',
      isSimulated: false,
    };

    const { unmount } = render(<PullRequestPanel patches={[mockWebGoatPatch]} />);
    expect(screen.getByText('✓ PR CREATED #1')).toBeInTheDocument();
    expect(screen.getByText('GitHub Pull Request Delivered')).toBeInTheDocument();
    expect(screen.getByText('amass/remediation/fix-path-traversal-profile-upload')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.queryByText(/SIMULATED/i)).not.toBeInTheDocument();

    const prLink = screen.getByText('View Pull Request ↗');
    expect(prLink).toHaveAttribute('href', 'https://github.com/Mayuresh1004/WebGoat/pull/1');
    expect(prLink).toHaveAttribute('target', '_blank');

    unmount();

    const mockFinding: FindingModel = {
      id: 'fnd-webgoat-pathtraversal',
      title: 'Path Traversal',
      severity: 'HIGH',
      filePath: 'src/main/java/org/owasp/webgoat/lessons/pathtraversal/ProfileUpload.java',
      status: 'CRITIC_VERIFIED',
      patch: mockWebGoatPatch,
    };

    render(
      <ValidationMatrix
        findings={[mockFinding]}
        stages={[{ name: 'Final Security Verdict', key: 'approval', status: 'PASSED' }]}
      />
    );
    const matrixLink = screen.getByText('✓ PR #1 ↗');
    expect(matrixLink).toHaveAttribute('href', 'https://github.com/Mayuresh1004/WebGoat/pull/1');
    expect(matrixLink).toHaveAttribute('target', '_blank');
  });
});

