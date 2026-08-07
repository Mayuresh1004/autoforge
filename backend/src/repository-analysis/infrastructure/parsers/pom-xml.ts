import { XMLParser } from 'fast-xml-parser';
import type { RawDependency, RawManifest } from './types';

interface XmlString { __text?: string; '#text'?: string }

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const v = value as XmlString;
    return (v.__text ?? v['#text']) ?? null;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
}

/**
 * Parses a Maven `pom.xml` (groupId:artifactId:version [+ scope]) and the
 * declared Java/Scala version, resolving `${property}` placeholders.
 */
export function parsePomXml(raw: string): RawManifest {
  const parser = new XMLParser({ ignoreAttributes: false });
  let root: { project?: Record<string, unknown> };
  try {
    root = parser.parse(raw) as { project?: Record<string, unknown> };
  } catch {
    return { runtimes: {}, dependencies: [] };
  }
  const project = root.project ?? {};
  const properties = (project.properties ?? {}) as Record<string, unknown>;
  const resolve = (value: string | null): string | null => {
    if (!value) return null;
    const match = /^\$\{([^}]+)\}$/.exec(value.trim());
    if (match) {
      const resolved = text(properties[match[1]]);
      return resolved ?? value;
    }
    return value;
  };

  const dependencies: RawDependency[] = [];
  const depObj = project.dependencies as Record<string, unknown> | undefined;
  if (depObj) {
    for (const dep of asArray(depObj.dependency)) {
      const d = dep as Record<string, unknown>;
      const groupId = text(d.groupId);
      const artifactId = text(d.artifactId);
      const version = resolve(text(d.version));
      const scope = text(d.scope) === 'test' ? ('development' as const) : ('runtime' as const);
      if (groupId && artifactId) {
        dependencies.push({ name: `${groupId}:${artifactId}`, version, scope });
      }
    }
  }

  const javaVersion =
    resolve(text(properties['java.version'])) ??
    resolve(text(properties['maven.compiler.source']));
  const runtimes = { java: javaVersion };

  return { runtimes, dependencies };
}