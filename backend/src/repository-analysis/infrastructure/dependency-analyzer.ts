import type { FileSystemAnalysis } from '../domain/models/file-system';
import type {
  DependencyAnalysis,
  DependencyCategory,
  EcosystemSummary,
  ParsedDependency,
} from '../domain/models/dependencies';
import type { DependencyAnalyzer } from '../domain/ports/dependency-analyzer';
import { DetectionContext } from './detection/detection-context';
import { classifyDependency } from './detection/dependency-classifier';
import { MANIFEST_DEFINITIONS } from './parsers';
import type { ManifestDefinition } from './parsers';

type DependencyClassifier = (name: string) => readonly DependencyCategory[];

/**
 * Parses every supported dependency manifest present in a repository and
 * produces categorized, dependency-summary per ecosystem.
 *
 * Reads only declaration files via the size-capped DetectionContext — never
 * secrets, never repository code.
 */
export class DefaultDependencyAnalyzer implements DependencyAnalyzer {
  constructor(
    private readonly definitions: readonly ManifestDefinition[] = MANIFEST_DEFINITIONS,
    private readonly classify: DependencyClassifier = classifyDependency
  ) {}

  async analyze(analysis: FileSystemAnalysis, rootPath: string): Promise<DependencyAnalysis> {
    const context = DetectionContext.create(analysis, rootPath);
    const summaries: EcosystemSummary[] = [];

    for (const definition of this.definitions) {
      const raw = await context.readManifest(definition.path);
      if (raw === null) continue;

      const parsed = definition.parse(raw);
      const dependencies: ParsedDependency[] = parsed.dependencies.map((dep) => ({
        scope: dep.scope,
        name: dep.name,
        version: dep.version,
        categories: this.classify(dep.name),
      }));

      summaries.push(this.toSummary(definition, parsed, dependencies));
    }

    return { summaries };
  }

  private toSummary(
    definition: ManifestDefinition,
    parsed: { runtimes: Record<string, string | null> },
    dependencies: ParsedDependency[]
  ): EcosystemSummary {
    const librariesByCategory: Partial<Record<DependencyCategory, string[]>> = {};
    const seen = new Map<DependencyCategory, Set<string>>();

    for (const dependency of dependencies) {
      for (const category of dependency.categories) {
        let bucket = seen.get(category);
        if (!bucket) {
          bucket = new Set();
          seen.set(category, bucket);
        }
        bucket.add(dependency.name);
      }
    }
    for (const [category, names] of seen) {
      librariesByCategory[category] = [...names];
    }

    const runtimes: Partial<Record<string, string>> = {};
    for (const [key, value] of Object.entries(parsed.runtimes)) {
      if (value !== null) runtimes[key] = value;
    }

    return {
      ecosystem: definition.ecosystem,
      source: definition.path,
      count: dependencies.length,
      runtimes,
      librariesByCategory,
      dependencies,
    };
  }
}