import type { Technology, TechnologyCategory } from '../../domain/models/technology';
import { DetectionContext } from './detection-context';
import type { TechnologySignal } from './signal';

const MAX_EVIDENCE_PER_SIGNAL = 3;

const CATEGORY_ORDER: readonly TechnologyCategory[] = [
  'language',
  'runtime',
  'framework',
  'package-manager',
  'build-tool',
  'database',
  'container',
  'ci-cd',
  'cloud',
];

/**
 * Evaluates one signal against the context. Returns the observed evidence
 * (empty array = no match).
 */
export async function collectEvidence(
  signal: TechnologySignal,
  ctx: DetectionContext
): Promise<string[]> {
  const evidence: string[] = [];

  for (const name of signal.files ?? []) {
    if (ctx.hasFile(name)) evidence.push(`file: ${name}`);
  }
  for (const p of signal.paths ?? []) {
    if (ctx.hasPath(p)) evidence.push(`path: ${p}`);
  }
  for (const glob of signal.globs ?? []) {
    if (ctx.hasGlob(glob)) evidence.push(`glob: ${glob}`);
  }
  for (const ext of signal.extensions ?? []) {
    if (ctx.hasExtension(ext)) evidence.push(`extension: .${ext}`);
  }
  for (const dir of signal.directories ?? []) {
    if (ctx.hasDirectory(dir)) evidence.push(`directory: ${dir}`);
  }

  for (const target of signal.pkgDependencies ?? []) {
    const deps = await ctx.packageDependencyNames();
    const hit = deps.find((d) => DetectionContext.dependencyMatches(d, target));
    if (hit) evidence.push(`dependency: ${hit}`);
  }

  for (const target of signal.pyDependencies ?? []) {
    const deps = await ctx.pythonDependencyNames();
    const hit = deps.find((d) => DetectionContext.dependencyMatches(d, target));
    if (hit) evidence.push(`python dependency: ${hit}`);
  }

  for (const key of signal.engines ?? []) {
    const engines = await ctx.packageEngines();
    if (engines[key]) evidence.push(`engines.${key}: ${engines[key]}`);
  }

  for (const rule of signal.manifestContains ?? []) {
    const raw = await ctx.readManifest(rule.path);
    if (raw !== null && raw.includes(rule.needle)) {
      evidence.push(`${rule.path} contains "${rule.needle}"`);
    }
  }

  return evidence.slice(0, MAX_EVIDENCE_PER_SIGNAL);
}

/**
 * Runs a set of signals and returns matched technologies ordered by category
 * then by confidence (descending).
 */
export async function detectTechnologies(
  signals: readonly TechnologySignal[],
  ctx: DetectionContext
): Promise<Technology[]> {
  const matches: Technology[] = [];

  for (const signal of signals) {
    const evidence = await collectEvidence(signal, ctx);
    if (evidence.length > 0) {
      matches.push({
        name: signal.name,
        category: signal.category,
        confidence: signal.confidence,
        evidence,
      });
    }
  }

  matches.sort((a, b) => {
    const catDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (catDiff !== 0) return catDiff;
    return b.confidence - a.confidence;
  });

  return matches;
}