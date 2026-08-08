import { z } from 'zod';

/**
 * Body for POST /api/sniper/run.
 *
 * The Sniper never attacks outside the supplied sandbox: `baseUrl` is the
 * target application URL inside the sandbox, `targetIds` are planned target
 * ids that must belong to the same scan, and credentials are accepted ONLY
 * when explicitly provided here (never guessed or derived).
 */
export const RunSniperRequestSchema = z.object({
  /** The source static-scan this verification is attached to. */
  scanId: z.string().min(1),
  /** The sandbox the target application runs in (must host the scan). */
  sandboxId: z.string().min(1),
  /** Target application base URL inside the sandbox (same-origin scope). */
  baseUrl: z.string().url(),
  /** Planned target ids to verify (bounded; concurrency applies). */
  targetIds: z.array(z.string().min(1)).min(1).max(50),
  /** Explicitly provided credentials — never derived, guessed or bypassed. */
  credentials: z
    .object({
      username: z.string().optional(),
      password: z.string().optional(),
      cookie: z.string().optional(),
      header: z.string().optional(),
      sessionToken: z.string().optional(),
    })
    .strict()
    .optional(),
  options: z
    .object({
      /** Per-attempt hard timeout (ms). */
      timeoutMs: z.number().int().positive().max(600_000).optional(),
      /** Bounded concurrency across targets (1–10). */
      concurrency: z.number().int().min(1).max(10).optional(),
      /** Attempt cap for transient failures only (1–5). */
      maxAttempts: z.number().int().min(1).max(5).optional(),
    })
    .strict()
    .optional(),
});

export const SniperIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const SniperTargetParamsSchema = z.object({
  targetId: z.string().min(1),
});

export type RunSniperRequest = z.infer<typeof RunSniperRequestSchema>;
export type SniperIdParams = z.infer<typeof SniperIdParamsSchema>;
export type SniperTargetParams = z.infer<typeof SniperTargetParamsSchema>;