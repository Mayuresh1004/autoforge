import { z } from 'zod';

/**
 * Request DTO for `POST /scan/static`. Validation happens at the transport
 * boundary; the actual URL is re-validated by the GitHub resolver.
 */
export const ScanStaticRequestSchema = z
  .object({
    url: z.string().min(1, 'url is required'),
  })
  .strict();

export type ScanStaticRequest = z.infer<typeof ScanStaticRequestSchema>;