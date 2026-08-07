import { z } from 'zod';

/**
 * Request DTO for the analysis endpoint. The repository URL is validated at
 * the transport boundary; deeper URL safety is enforced by the resolver.
 */
export const AnalyzeRepositoryRequestSchema = z
  .object({
    url: z.string().min(1, 'url is required'),
  })
  .strict();

export type AnalyzeRepositoryRequest = z.infer<typeof AnalyzeRepositoryRequestSchema>;