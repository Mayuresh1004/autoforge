import { describe, it, expect } from 'vitest';
import { GitHubUrlResolver } from './github-url-resolver';
import { InvalidRepositoryUrlError } from '../../domain/errors/repository-analysis.errors';

const resolver = new GitHubUrlResolver();

describe('GitHubUrlResolver', () => {
  it('parses a canonical github.com URL', () => {
    const identity = resolver.parse('https://github.com/facebook/react');

    expect(identity.provider).toBe('github');
    expect(identity.owner).toBe('facebook');
    expect(identity.name).toBe('react');
    expect(identity.cloneUrl).toBe('https://github.com/facebook/react.git');
    expect(identity.homepageUrl).toBe('https://github.com/facebook/react');
    expect(identity.defaultBranch).toBe('main');
  });

  it('strips .git suffix and trailing slash', () => {
    const identity = resolver.parse('https://github.com/facebook/react.git/');
    expect(identity.name).toBe('react');
    expect(identity.cloneUrl).toBe('https://github.com/facebook/react.git');
  });

  it('accepts github.com subdomains such as www.github.com', () => {
    const identity = resolver.parse('https://www.github.com/expressjs/express');
    expect(identity.owner).toBe('expressjs');
    expect(identity.name).toBe('express');
  });

  it('accepts owner/name with dots, hyphens and underscores', () => {
    const identity = resolver.parse('https://github.com/octo_org/My-Proj.2');
    expect(identity.owner).toBe('octo_org');
    expect(identity.name).toBe('My-Proj.2');
  });

  it('rejects non-github hosts', () => {
    expect(() => resolver.parse('https://gitlab.com/group/repo')).toThrow(
      InvalidRepositoryUrlError
    );
    expect(() => resolver.parse('https://github.com.evil.com/owner/repo')).toThrow(
      InvalidRepositoryUrlError
    );
  });

  it('rejects URLs carrying embedded credentials', () => {
    expect(() => resolver.parse('https://user:token@github.com/owner/repo')).toThrow(
      InvalidRepositoryUrlError
    );
  });

  it('rejects non-https/http schemes', () => {
    expect(() => resolver.parse('git@github.com:owner/repo.git')).toThrow(
      InvalidRepositoryUrlError
    );
    expect(() => resolver.parse('file:///tmp/repo')).toThrow(InvalidRepositoryUrlError);
  });

  it('rejects a URL missing the repository segment', () => {
    expect(() => resolver.parse('https://github.com/owner')).toThrow(
      InvalidRepositoryUrlError
    );
  });

  it('rejects empty, whitespace and garbage input', () => {
    expect(() => resolver.parse('')).toThrow(InvalidRepositoryUrlError);
    expect(() => resolver.parse('   ')).toThrow(InvalidRepositoryUrlError);
    expect(() => resolver.parse('not a url')).toThrow(InvalidRepositoryUrlError);
  });

  it('rejects encoded path-traversal like owner segments', () => {
    expect(() => resolver.parse('https://github.com/..%2F..%2Fetc/repo')).toThrow(
      InvalidRepositoryUrlError
    );
  });

  it('rejects non-default ports', () => {
    expect(() => resolver.parse('https://github.com:8443/owner/repo')).toThrow(
      InvalidRepositoryUrlError
    );
  });
});