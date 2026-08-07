import { AppError } from '../../../utils/errors';

/**
 * Raised when the supplied repository URL cannot be resolved to a valid,
 * supported public GitHub repository.
 */
export class InvalidRepositoryUrlError extends AppError {
  constructor(repositoryUrl: string) {
    super(
      `Invalid repository URL: ${repositoryUrl}`,
      422,
      'INVALID_REPOSITORY_URL',
      true,
      { repositoryUrl }
    );
  }
}

/**
 * Raised when `git clone` fails (network error, repository not found,
 * timeout, etc.).
 */
export class RepositoryCloneError extends AppError {
  constructor(url: string, cause?: unknown) {
    const message = cause instanceof Error ? cause.message : 'git clone failed';
    super(`Failed to clone repository: ${message}`, 502, 'REPOSITORY_CLONE_FAILED', true, {
      url,
    });
  }
}

/**
 * Raised when the cloned repository exceeds the configured size limit.
 */
export class RepositoryTooLargeError extends AppError {
  constructor(
    repositoryUrl: string,
    sizeBytes: number,
    maxBytes: number
  ) {
    super(
      `Repository exceeds the configured size limit`,
      413,
      'REPOSITORY_EXCEEDS_SIZE_LIMIT',
      true,
      { repositoryUrl, sizeBytes, maxBytes }
    );
  }
}