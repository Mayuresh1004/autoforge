import { SandboxRuntimeUnsupportedError } from '../../domain/errors/sandbox-runtime.errors';
import {
  InvalidRuntimeRepositoryError,
  UnsupportedRuntimeError,
  type RuntimeFailureStage,
} from '../../domain/errors/runtime-sandbox.errors';

/**
 * Map any error to the lifecycle stage it belongs to. Used to persist the
 * FAILED record with a precise failureStage and a structured error.
 */
export function classifyStage(error: unknown): RuntimeFailureStage {
  if (error instanceof UnsupportedRuntimeError) return 'RUNTIME_DETECTION';
  if (error instanceof SandboxRuntimeUnsupportedError) return 'BACKEND';
  if (error instanceof InvalidRuntimeRepositoryError) return 'REPOSITORY';
  const message = error instanceof Error ? error.message : String(error);
  if (/workspace|prepare|clone|copy/i.test(message)) return 'WORKSPACE';
  if (/health|probe|reachable|no network address/i.test(message)) return 'HEALTH_CHECK';
  if (/build/i.test(message)) return 'IMAGE_BUILD';
  if (/container|sandbox|start/i.test(message)) return 'CONTAINER_START';
  return 'BACKEND';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Scan ids become docker-safe name/image components (bounded length). */
export function sanitizeKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12);
}

/** Host-exposed sandboxes advertise 127.0.0.1; internal ones use the IP. */
export function buildTargetUrl(publishedPort: number | null, ip: string, port: number): string {
  return publishedPort ? `http://127.0.0.1:${publishedPort}` : `http://${ip}:${port}`;
}