/** Domain errors for the Attack Planner. Only truly invalid inputs throw;
 * a scan without reconnaissance simply yields an (empty) plan. */

export class PlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlannerError';
  }
}

export class ScanNotFoundError extends PlannerError {
  constructor(scanId: string) {
    super(`Source scan not found: ${scanId}`);
    this.name = 'ScanNotFoundError';
  }
}

export class PlanNotFoundError extends PlannerError {
  constructor(planId: string) {
    super(`Attack plan not found: ${planId}`);
    this.name = 'PlanNotFoundError';
  }
}