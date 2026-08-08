import type { RuntimeSandbox } from '../entities/runtime-sandbox';

/**
 * In-process registry of LIVE runtime sandboxes. The single source of truth
 * for the concurrency ceiling: `register()` claims a slot (at CREATING), and
 * every terminal transition releases it via `remove()`. Backed by a durable
 * store; this is the fast accounting layer.
 */
export interface RuntimeSandboxRegistry {
  register(sandbox: RuntimeSandbox): Promise<void>;
  get(id: string): Promise<RuntimeSandbox | null>;
  remove(id: string): Promise<void>;
  /** Live (non-terminal) sandboxes that currently occupy capacity. */
  listActive(): Promise<readonly RuntimeSandbox[]>;
  /** Number of live sandboxes right now. */
  countActive(): Promise<number>;
}