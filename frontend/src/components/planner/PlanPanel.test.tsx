import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlanPanel } from './PlanPanel';
import type { PlanModel } from '../../types/api-types';

describe('PlanPanel UI Component', () => {
  it('renders PlannedTarget with no Exploit as Planning=PLANNED and Verification=NOT RUN', () => {
    const plan: PlanModel = {
      targets: [
        {
          targetId: 'tgt_1',
          scanId: 'scan_1',
          endpoint: '/api/upload',
          method: 'POST',
          vulnerabilityType: 'Insecure File Upload',
          priorityScore: 80,
          status: 'PLANNED',
          verificationStatus: 'NOT_RUN',
        },
      ],
    };

    render(<PlanPanel plan={plan} />);
    expect(screen.getByText('Planning:')).toBeInTheDocument();
    expect(screen.getByText('PLANNED')).toBeInTheDocument();
    expect(screen.getByText('Verification:')).toBeInTheDocument();
    expect(screen.getByText('NOT RUN')).toBeInTheDocument();
  });

  it('renders PlannedTarget with NOT_TESTED Exploit with Planning=PLANNED, Verification=NOT TESTED and reason', () => {
    const plan: PlanModel = {
      targets: [
        {
          targetId: 'tgt_2',
          scanId: 'scan_1',
          endpoint: '/admin',
          method: 'GET',
          vulnerabilityType: 'UNKNOWN',
          priorityScore: 10,
          status: 'PLANNED',
          verificationStatus: 'NOT_TESTED',
          verificationReason: 'Unsupported candidate vulnerability (unknown)',
        },
      ],
    };

    render(<PlanPanel plan={plan} />);
    expect(screen.getByText('PLANNED')).toBeInTheDocument();
    expect(screen.getByText('NOT TESTED')).toBeInTheDocument();
    expect(screen.getByText(/Unsupported candidate vulnerability \(unknown\)/i)).toBeInTheDocument();
  });

  it('renders PlannedTarget with NOT_CONFIRMED Exploit with Planning=PLANNED and Verification=NOT CONFIRMED', () => {
    const plan: PlanModel = {
      targets: [
        {
          targetId: 'tgt_3',
          scanId: 'scan_1',
          endpoint: '/uploads',
          method: 'GET',
          vulnerabilityType: 'Insecure File Upload',
          priorityScore: 44,
          status: 'PLANNED',
          verificationStatus: 'NOT_CONFIRMED',
          verificationReason: 'no unrestricted file upload confirmed',
        },
      ],
    };

    render(<PlanPanel plan={plan} />);
    expect(screen.getByText('PLANNED')).toBeInTheDocument();
    expect(screen.getByText('NOT CONFIRMED')).toBeInTheDocument();
    expect(screen.getByText(/no unrestricted file upload confirmed/i)).toBeInTheDocument();
  });

  it('renders PlannedTarget with CONFIRMED Exploit with Planning=PLANNED and Verification=CONFIRMED', () => {
    const plan: PlanModel = {
      targets: [
        {
          targetId: 'tgt_4',
          scanId: 'scan_1',
          endpoint: '/api/query',
          method: 'POST',
          vulnerabilityType: 'SQL Injection',
          priorityScore: 99,
          status: 'PLANNED',
          verificationStatus: 'CONFIRMED',
          verificationReason: 'PoC exploit returned database version string',
        },
      ],
    };

    render(<PlanPanel plan={plan} />);
    expect(screen.getByText('PLANNED')).toBeInTheDocument();
    expect(screen.getByText('CONFIRMED')).toBeInTheDocument();
  });
});
