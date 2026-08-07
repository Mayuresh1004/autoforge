import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileSystemAnalysis } from '../../domain/models/file-system';

const MAX_MANIFEST_BYTES = 512 * 1024;

function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Read-only view over a scanned working tree used by signature detection.
 *
 * Provides:
 * - fast name/path/extension/directory lookups,
 * - cached, size-capped reads of a safe set of manifest files so dependency
 *   hints can be matched (never secret files, never repository code).
 */
export class DetectionContext {
  private readonly fileCache = new Map<string, string | null>();
  private pkgDepsCache: string[] | null = null;
  private pyDepsCache: string[] | null = null;
  private enginesCache: Record<string, string> | null = null;

  private constructor(
    private readonly analysis: FileSystemAnalysis,
    private readonly rootPath: string
  ) {}

  static create(analysis: FileSystemAnalysis, rootPath: string): DetectionContext {
    return new DetectionContext(analysis, rootPath);
  }

  get allPaths(): readonly string[] {
    return this.analysis.files.map((f) => f.relativePath);
  }

  get allFileNames(): ReadonlySet<string> {
    const names = new Set<string>();
    for (const file of this.analysis.files) names.add(file.name);
    return names;
  }

  get extensions(): ReadonlySet<string> {
    const set = new Set<string>();
    for (const file of this.analysis.files) {
      if (file.extension !== '(none)') set.add(file.extension.toLowerCase());
    }
    return set;
  }

  get topLevelDirectories(): ReadonlySet<string> {
    const set = new Set<string>();
    for (const dir of this.analysis.tree.directories) set.add(dir.name);
    return set;
  }

  /**
   * Every directory name at any depth (e.g. `domain`, `controllers`) — used
   * to detect layered/hexagonal architecture regardless of nesting.
   */
  get allDirectories(): ReadonlySet<string> {
    const set = new Set<string>();
    for (const file of this.analysis.files) {
      const segments = file.relativePath.split('/');
      // Every segment except the trailing file name is a directory.
      for (let i = 0; i < segments.length - 1; i += 1) {
        set.add(segments[i]);
      }
    }
    return set;
  }

  hasFile(name: string): boolean {
    return this.allFileNames.has(name);
  }

  hasPath(relativePath: string): boolean {
    return this.analysis.files.some((f) => f.relativePath === relativePath);
  }

  hasGlob(glob: string): boolean {
    const regex = globToRegExp(glob);
    return this.analysis.files.some((f) => regex.test(f.relativePath));
  }

  hasExtension(extension: string): boolean {
    return this.extensions.has(extension.toLowerCase());
  }

  hasDirectory(name: string): boolean {
    return this.topLevelDirectories.has(name);
  }

  /**
   * Reads a manifest-like file (capped, cached). Returns null when missing,
   * unreadable, or too large.
   */
  async readManifest(relativePath: string): Promise<string | null> {
    const cached = this.fileCache.get(relativePath);
    if (cached !== undefined) return cached;

    let content: string | null = null;
    try {
      const stat = await fs.stat(path.join(this.rootPath, relativePath));
      if (stat.size <= MAX_MANIFEST_BYTES) {
        content = await fs.readFile(path.join(this.rootPath, relativePath), 'utf8');
      }
    } catch {
      content = null;
    }
    this.fileCache.set(relativePath, content);
    return content;
  }

  /**
   * Names of all dependencies declared in a root package.json
   * (dependencies + devDependencies + peerDependencies + optionalDependencies).
   */
  async packageDependencyNames(): Promise<string[]> {
    if (this.pkgDepsCache) return this.pkgDepsCache;
    const raw = await this.readManifest('package.json');
    if (raw === null) {
      this.pkgDepsCache = [];
      return this.pkgDepsCache;
    }
    try {
      const json = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      this.pkgDepsCache = [
        ...Object.keys(json.dependencies ?? {}),
        ...Object.keys(json.devDependencies ?? {}),
        ...Object.keys(json.peerDependencies ?? {}),
        ...Object.keys(json.optionalDependencies ?? {}),
      ];
    } catch {
      this.pkgDepsCache = [];
    }
    return this.pkgDepsCache;
  }

  /**
   * package.json `engines` object (e.g. { node: ">=20", npm: ">=10" }).
   */
  async packageEngines(): Promise<Record<string, string>> {
    if (this.enginesCache) return this.enginesCache;
    const raw = await this.readManifest('package.json');
    if (raw === null) {
      this.enginesCache = {};
      return this.enginesCache;
    }
    try {
      const json = JSON.parse(raw) as { engines?: Record<string, string> };
      this.enginesCache = json.engines ?? {};
    } catch {
      this.enginesCache = {};
    }
    return this.enginesCache;
  }

  /**
   * Names of python dependencies declared in requirements.txt or
   * pyproject.toml (both `[project].dependencies` and `[tool.poetry.dependencies]`).
   */
  async pythonDependencyNames(): Promise<string[]> {
    if (this.pyDepsCache) return this.pyDepsCache;
    const names = new Set<string>();
    const requirements = await this.readManifest('requirements.txt');
    if (requirements !== null) {
      for (const line of requirements.split(/\r?\n/)) {
        const clean = line.split('#')[0]?.trim();
        if (!clean) continue;
        const match = /^([A-Za-z0-9_.\-\[\]]+)/.exec(clean);
        if (match) names.add(match[1].toLowerCase());
      }
    }

    const pyproject = await this.readManifest('pyproject.toml');
    if (pyproject !== null) {
      for (const match of pyproject.matchAll(/"([A-Za-z0-9_.\-]+)"\s*[=~<>=!]|\b([A-Za-z0-9_]+)\s*=\s*"/g)) {
        const name = (match[1] ?? match[2]) as string | undefined;
        if (name && !['version', 'name', 'requires-python'].includes(name)) {
          names.add(name.toLowerCase());
        }
      }
    }
    this.pyDepsCache = [...names];
    return this.pyDepsCache;
  }

  /**
   * True when a dependency name matches a target. Matches exact names and
   * scoped/suffixed variants (react → react, react-dom, @types/react).
   */
  static dependencyMatches(dependency: string, target: string): boolean {
    const dep = dependency.toLowerCase();
    const wanted = target.toLowerCase();
    if (dep === wanted) return true;
    if (dep.startsWith(`${wanted}@`)) return true; // scoped @org/pkg@1 → treat as pkg
    if (dep.startsWith(`${wanted}-`)) return true;
    if (dep.startsWith(`${wanted}/`)) return true;
    if (dep.endsWith(`/${wanted}`)) return true;
    // Scoped packages, e.g. @aws-sdk/client-s3 vs target aws-sdk
    return dep.startsWith(`@${wanted}`);
  }
}