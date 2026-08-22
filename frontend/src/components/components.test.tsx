import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AgentPipeline } from './pipeline/AgentPipeline';
import { EventItem } from './timeline/EventItem';
import { FindingCard } from './findings/FindingCard';
import { PatchView } from './remediation/PatchView';
import { ValidationMatrix } from './critic/ValidationMatrix';
import type { AmassEvent } from '../types/amass-events';
import type { FindingModel, PatchModel } from '../types/api-types';
import type { AgentState, CriticStageState } from '../hooks/useScanStore';

describe('Frontend UI Components', () => {
  it('renders AgentPipeline with agent stages', () => {
    const mockAgents: Record<string, AgentState> = {
      ANALYZER: { type: 'ANALYZER', status: 'COMPLETED' },
      SCANNER: { type: 'SCANNER', status: 'COMPLETED' },
      SANDBOX: { type: 'SANDBOX', status: 'COMPLETED' },
      SCOUT: { type: 'SCOUT', status: 'COMPLETED' },
      PLANNER: { type: 'PLANNER', status: 'COMPLETED' },
      SNIPER: { type: 'SNIPER', status: 'COMPLETED' },
      ENGINEER: { type: 'ENGINEER', status: 'RUNNING' },
      CRITIC: { type: 'CRITIC', status: 'IDLE' },
    } as any;

    render(<AgentPipeline agents={mockAgents} />);
    expect(screen.getByText('Analyzer')).toBeInTheDocument();
    expect(screen.getByText('Engineer')).toBeInTheDocument();
    expect(screen.getByText('Critic')).toBeInTheDocument();
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

  it('renders AgentPipeline with 9th PR Created step and clickable PR link when delivered', () => {
    const mockAgents: Record<string, AgentState> = {
      ANALYZER: { type: 'ANALYZER', status: 'COMPLETED' },
      SCANNER: { type: 'SCANNER', status: 'COMPLETED' },
      SANDBOX: { type: 'SANDBOX', status: 'COMPLETED' },
      SCOUT: { type: 'SCOUT', status: 'COMPLETED' },
      PLANNER: { type: 'PLANNER', status: 'COMPLETED' },
      SNIPER: { type: 'SNIPER', status: 'COMPLETED' },
      ENGINEER: { type: 'ENGINEER', status: 'COMPLETED' },
      CRITIC: { type: 'CRITIC', status: 'COMPLETED' },
      REMEDIATION: { type: 'REMEDIATION', status: 'COMPLETED' },
    } as any;

    const mockPatches: PatchModel[] = [
      {
        patchId: 'patch_1',
        scanId: 'scan_1',
        filePath: 'src/routes/auth.ts',
        diffContent: 'diff',
        status: 'APPROVED',
        prNumber: 7,
        prUrl: 'https://github.com/test/repo/pull/7',
        prBranch: 'amass/remediation/patch_1',
      },
    ];

    render(<AgentPipeline agents={mockAgents} patches={mockPatches} />);
    expect(screen.getByText('PR Created')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /view ↗/i });
    expect(link).toHaveAttribute('href', 'https://github.com/test/repo/pull/7');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders FindingCard with ✓ PR CREATED and clickable View Pull Request link', () => {
    const mockFinding: FindingModel = {
      id: 'f_1',
      scanId: 'scan_1',
      title: 'SQL Injection in /api/login',
      severity: 'CRITICAL',
      filePath: 'src/routes/auth.ts',
      status: 'CRITIC_VERIFIED',
      patch: {
        patchId: 'patch_1',
        scanId: 'scan_1',
        filePath: 'src/routes/auth.ts',
        diffContent: 'diff',
        status: 'APPROVED',
        prNumber: 7,
        prUrl: 'https://github.com/test/repo/pull/7',
      },
    };

    render(<FindingCard finding={mockFinding} />);
    expect(screen.getByText('✓ PR CREATED #7')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /view pull request ↗/i });
    expect(link).toHaveAttribute('href', 'https://github.com/test/repo/pull/7');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders FindingCard with ✕ PR DELIVERY FAILED when PR delivery fails', () => {
    const mockFinding: FindingModel = {
      id: 'f_2',
      scanId: 'scan_1',
      title: 'XSS in comment field',
      severity: 'HIGH',
      filePath: 'src/routes/comments.ts',
      status: 'CRITIC_VERIFIED',
      patch: {
        patchId: 'patch_2',
        scanId: 'scan_1',
        filePath: 'src/routes/comments.ts',
        diffContent: 'diff',
        status: 'APPROVED',
        prError: 'GitHub API HTTP 403 Forbidden',
      },
    };

    render(<FindingCard finding={mockFinding} />);
    expect(screen.getByText('✕ PR DELIVERY FAILED')).toBeInTheDocument();
    expect(screen.getByText('GitHub API HTTP 403 Forbidden')).toBeInTheDocument();
  });

  it('renders ValidationMatrix with Pull Request column and clickable link', () => {
    const mockFindings: FindingModel[] = [
      {
        id: 'fnd-1',
        title: 'SQL Injection',
        severity: 'CRITICAL',
        filePath: 'src/routes/search.ts',
        status: 'CRITIC_VERIFIED',
        patch: {
          patchId: 'patch_1',
          scanId: 'scan_1',
          filePath: 'src/routes/search.ts',
          diffContent: 'diff',
          status: 'APPROVED',
          prNumber: 7,
          prUrl: 'https://github.com/test/repo/pull/7',
          prBranch: 'amass/remediation/patch_1',
        },
      },
    ];

    render(<ValidationMatrix findings={mockFindings} />);
    expect(screen.getByText('Pull Request')).toBeInTheDocument();
    expect(screen.getByText('✓ PR #7')).toBeInTheDocument();
    expect(screen.getByText('amass/remediation/patch_1')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /view pull request ↗/i });
    expect(link).toHaveAttribute('href', 'https://github.com/test/repo/pull/7');
  });
});
