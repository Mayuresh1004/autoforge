/**
 * Prompt registry errors.
 */

export class PromptNotFoundError extends Error {
  readonly id: string;
  readonly version: string;
  constructor(id: string, version: string) {
    super(`prompt '${id}' not found in version '${version}'`);
    this.name = 'PromptNotFoundError';
    this.id = id;
    this.version = version;
  }
}

export class PromptVersionError extends Error {
  readonly version: string;
  constructor(version: string, detail: string) {
    super(`prompt version '${version}' unavailable: ${detail}`);
    this.name = 'PromptVersionError';
    this.version = version;
  }
}