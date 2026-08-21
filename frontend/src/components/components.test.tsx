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
});
