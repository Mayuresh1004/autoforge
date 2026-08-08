import { z } from 'zod';

/** DTO for POST /scout/run. Recon parameters only — nothing offensive. */
export const RunScoutRequestSchema = z.object({
  /** The source static-scan this recon is attached to (must exist). */
  scanId: z.string().min(1),
  /** The running application URL inside the sandbox. */
  targetUrl: z.string().url(),
  options: z
    .object({
      timeoutMs: z.number().int().positive().optional(),
      maxPages: z.number().int().positive().optional(),
      maxDepth: z.number().int().nonnegative().optional(),
      probeCommonPaths: z.boolean().optional(),
      portScan: z.boolean().optional(),
    })
    .optional(),
});

export type RunScoutRequest = z.infer<typeof RunScoutRequestSchema>;