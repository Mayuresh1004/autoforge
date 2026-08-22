export type VerificationStatus =
  | 'NOT_RUN'
  | 'NOT_TESTED'
  | 'NOT_CONFIRMED'
  | 'CONFIRMED'
  | 'INCONCLUSIVE'
  | 'FAILED';

export interface VerificationStatusConfig {
  label: string;
  variant: 'default' | 'outline' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
  description: string;
}

export function getVerificationStatusConfig(rawStatus?: string | null): VerificationStatusConfig {
  const status = (rawStatus ?? 'NOT_RUN').toUpperCase().replace(/[\s-]+/g, '_');

  switch (status) {
    case 'CONFIRMED':
    case 'EXPLOIT_CONFIRMED':
      return {
        label: 'CONFIRMED',
        variant: 'danger',
        description: 'Vulnerability confirmed by verifier',
      };
    case 'NOT_CONFIRMED':
    case 'EXPLOIT_REJECTED':
    case 'REJECTED':
      return {
        label: 'NOT CONFIRMED',
        variant: 'outline',
        description: 'Verified safe / no exploit confirmed',
      };
    case 'NOT_TESTED':
      return {
        label: 'NOT TESTED',
        variant: 'warning',
        description: 'Skipped (unsupported candidate)',
      };
    case 'INCONCLUSIVE':
      return {
        label: 'INCONCLUSIVE',
        variant: 'warning',
        description: 'Verification inconclusive',
      };
    case 'FAILED':
      return {
        label: 'FAILED',
        variant: 'danger',
        description: 'Verifier execution failed',
      };
    case 'NOT_RUN':
    default:
      return {
        label: 'NOT RUN',
        variant: 'outline',
        description: 'Verification not yet executed',
      };
  }
}
