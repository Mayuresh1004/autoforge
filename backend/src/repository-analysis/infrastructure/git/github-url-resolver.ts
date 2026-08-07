import type { RepositoryIdentity } from '../../domain/models/repository';
import type { RepositoryUrlResolver } from '../../domain/ports/repository-url-resolver';
import { InvalidRepositoryUrlError } from '../../domain/errors/repository-analysis.errors';

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const GITHUB_SCHEMES = new Set(['https:', 'http:']);
const OWNER_REPO_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Resolves GitHub repository URLs into a safe, normalized identity.
 *
 * Accepted forms:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/
 *
 * The clone URL is always reconstructed from the parsed owner/name, never
 * echoed from the raw input, so embedded credentials, ports, or path
 * tricks cannot leak through.
 */
export class GitHubUrlResolver implements RepositoryUrlResolver {
  parse(repositoryUrl: string): RepositoryIdentity {
    const trimmed = repositoryUrl.trim();
    if (trimmed.length === 0) {
      throw new InvalidRepositoryUrlError(repositoryUrl);
    }

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new InvalidRepositoryUrlError(repositoryUrl);
    }

    if (!GITHUB_SCHEMES.has(url.protocol)) {
      throw new InvalidRepositoryUrlError(repositoryUrl);
    }
    if (!GITHUB_HOSTS.has(url.hostname)) {
      throw new InvalidRepositoryUrlError(repositoryUrl);
    }
    // Reject URLs carrying credentials or a non-default port.
    if (url.username || url.password || url.port) {
      throw new InvalidRepositoryUrlError(repositoryUrl);
    }

    const segments = url.pathname.split('/').filter((s) => s.length > 0);
    if (segments.length < 2) {
      throw new InvalidRepositoryUrlError(repositoryUrl);
    }

    const [owner, repoRaw] = segments;
    const name = repoRaw.replace(/\.git$/, '');

    if (!OWNER_REPO_PATTERN.test(owner) || !OWNER_REPO_PATTERN.test(name)) {
      throw new InvalidRepositoryUrlError(repositoryUrl);
    }

    return {
      provider: 'github',
      owner,
      name,
      cloneUrl: `https://github.com/${owner}/${name}.git`,
      homepageUrl: `https://github.com/${owner}/${name}`,
      defaultBranch: 'main',
    };
  }
}