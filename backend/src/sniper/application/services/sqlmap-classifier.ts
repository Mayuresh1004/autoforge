import type { ToolExecResult } from '../../domain/ports/tool-runtime';
import type { VerificationStatus } from '../../domain/models/verification';
import type { ParsedSqlMapOutput } from '../../infrastructure/tools/sqlmap/sqlmap-output-parser';
import type { ConfidenceSignals } from './confidence-scorer';

/**
 * Deterministic verdict for one sqlmap run — no LLM, no luck. Maps tool
 * signals to an explicit state:
 *
 *   - timedOut               → FAILED (retryable: transient)
 *   - binary missing         → FAILED (NOT retryable)
 *   - crashed before verdict → FAILED (retryable: could be transient)
 *   - vulnerable             → CONFIRMED (never retried)
 *   - explicitly ruled out   → NOT_CONFIRMED (never retried)
 *   - connection-level issue → INCONCLUSIVE (retryable)
 *   - ambiguous              → INCONCLUSIVE
 */

export interface ClassifySqlMapInput {
  readonly parsed: ParsedSqlMapOutput;
  readonly execution: ToolExecResult;
  readonly staticCorrelation: 'confirmed' | 'partial' | 'none';
}

export interface SqlMapClassification {
  readonly status: VerificationStatus;
  readonly reason: string;
  readonly retryable: boolean;
  readonly signals: ConfidenceSignals;
}

export function classifySqlMap(input: ClassifySqlMapInput): SqlMapClassification {
  const { parsed, execution } = input;

  if (execution.timedOut) {
    return {
      status: 'FAILED',
      reason: 'sqlmap attempt hit the hard execution timeout',
      retryable: true,
      signals: baseSignals(input, false),
    };
  }

  if (isToolMissing(execution)) {
    return {
      status: 'FAILED',
      reason: 'sqlmap binary unavailable inside the sandbox (command not found)',
      retryable: false,
      signals: baseSignals(input, false),
    };
  }

  // Connection-level problems are INCONCLUSIVE, not tool failures — the
  // endpoint exists but could not be reached; transient retry is useful.
  if (parsed.connectionError) {
    return {
      status: 'INCONCLUSIVE',
      reason: 'sqlmap could not reach the endpoint (connection-level error)',
      retryable: true,
      signals: baseSignals(input, false),
    };
  }

  // A genuine tool crash before a verdict: failed, possibly transient (e.g.
  // OOM) — the retry policy may retry it.
  if (parsed.toolError) {
    return {
      status: 'FAILED',
      reason: 'sqlmap failed before reaching a verdict (tool error)',
      retryable: true,
      signals: baseSignals(input, false),
    };
  }

  if (execution.exitCode !== 0 && execution.exitCode !== null && !parsed.reached) {
    return {
      status: 'FAILED',
      reason: `sqlmap exited ${execution.exitCode} before testing (${firstStderrLine(execution)})`,
      retryable: true,
      signals: baseSignals(input, false),
    };
  }

  if (parsed.vulnerable) {
    const techniques =
      parsed.techniques.length > 0
        ? parsed.techniques.join(', ')
        : parsed.payloadCount > 0
          ? `${parsed.payloadCount} payload(s)`
          : 'technique unknown';
    return {
      status: 'CONFIRMED',
      reason: `sqlmap confirmed injection on '${parsed.parameter ?? '?'}' (${techniques})`,
      retryable: false,
      signals: {
        toolConfirmed: true,
        techniqueCount:
          parsed.techniques.length > 0
            ? parsed.techniques.length
            : parsed.payloadCount > 0
              ? 1
              : 0,
        responseMatched: parsed.dbms !== null,
        endpointReachable: parsed.reached,
        staticCorrelation: input.staticCorrelation,
      },
    };
  }

  if (parsed.noInjection) {
    return {
      status: 'NOT_CONFIRMED',
      reason: 'sqlmap completed and ruled out injection for every tested parameter',
      retryable: false,
      signals: baseSignals(input, false),
    };
  }

  return {
    status: 'INCONCLUSIVE',
    reason: 'sqlmap produced no clear verdict (ambiguous output)',
    retryable: false,
    signals: baseSignals(input, false),
  };
}

function baseSignals(input: ClassifySqlMapInput, toolConfirmed: boolean): ConfidenceSignals {
  const { parsed } = input;
  return {
    toolConfirmed,
    techniqueCount: parsed.techniques.length,
    responseMatched: parsed.dbms !== null,
    endpointReachable: parsed.reached,
    staticCorrelation: input.staticCorrelation,
  };
}

function isToolMissing(execution: ToolExecResult): boolean {
  return (
    execution.exitCode === 127 ||
    /command not found|no such file|ENOENT/i.test(`${execution.stderr} ${execution.stdout}`)
  );
}

function firstStderrLine(execution: ToolExecResult): string {
  const line = (execution.stderr.trim().split('\n')[0] ?? '').trim();
  return line.length > 120 ? `${line.slice(0, 117)}…` : line || 'unknown error';
}