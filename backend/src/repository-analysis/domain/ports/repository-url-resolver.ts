import type { RepositoryIdentity } from '../models/repository';

/**
 * Port that turns a caller-supplied repository URL into a validated,
 * normalized RepositoryIdentity.
 *
 * Implementations MUST:
 * - reject non-GitHub / non-HTTPS inputs,
 * - never pass secrets or user-provided URLs to a shell,
 * - reconstruct the clone URL from parsed components rather than echoing
 *   the raw input (defence against path/scheme injection).
 */
export interface RepositoryUrlResolver {
  parse(repositoryUrl: string): RepositoryIdentity;
}