import { logger } from '../../../config/logger';
import type { ClonedRepository } from '../../domain/models/repository';
import type { FileSystemAnalysis } from '../../domain/models/file-system';
import type { TechnologyDetection } from '../../domain/models/technology';
import type { DependencyAnalysis } from '../../domain/models/dependencies';
import type { ArchitectureDetection } from '../../domain/models/architecture';
import type { ApiInventory } from '../../domain/models/api';
import type { AuthenticationDetection } from '../../domain/models/authentication';
import type {
  ProfileTechnology,
  RepositoryProfile,
} from '../../domain/models/repository-profile';
import type { RepositoryCloningService } from './repository-cloning.service';
import type { FileSystemAnalyzer } from '../../domain/ports/file-system-analyzer';
import type { TechnologyDetector } from '../../domain/ports/technology-detector';
import type { DependencyAnalyzer } from '../../domain/ports/dependency-analyzer';
import type { ArchitectureAnalyzer } from '../../domain/ports/architecture-analyzer';
import type { ApiAnalyzer } from '../../domain/ports/api-analyzer';
import type { AuthenticationAnalyzer } from '../../domain/ports/authentication-analyzer';

export interface RepositoryProfileServiceOptions {
  readonly cloning: RepositoryCloningService;
  readonly fileSystemAnalyzer: FileSystemAnalyzer;
  readonly technologyDetector: TechnologyDetector;
  readonly dependencyAnalyzer: DependencyAnalyzer;
  readonly architectureAnalyzer: ArchitectureAnalyzer;
  readonly apiAnalyzer: ApiAnalyzer;
  readonly authenticationAnalyzer: AuthenticationAnalyzer;
  readonly keepRepoDir?: boolean;
}

/**
 * Application service orchestrating the entire analysis pipeline:
 * clone → file-system → technology → dependencies → architecture → API →
 * auth, then assembles a single RepositoryProfile.
 *
 * It owns the repository lifecycle: the working tree is cleaned up at the
 * end unless `keepRepoDir` is enabled.
 */
export class RepositoryProfileService {
  private readonly cloning: RepositoryCloningService;
  private readonly fileSystemAnalyzer: FileSystemAnalyzer;
  private readonly technologyDetector: TechnologyDetector;
  private readonly dependencyAnalyzer: DependencyAnalyzer;
  private readonly architectureAnalyzer: ArchitectureAnalyzer;
  private readonly apiAnalyzer: ApiAnalyzer;
  private readonly authenticationAnalyzer: AuthenticationAnalyzer;
  private readonly keepRepoDir: boolean;

  constructor(options: RepositoryProfileServiceOptions) {
    this.cloning = options.cloning;
    this.fileSystemAnalyzer = options.fileSystemAnalyzer;
    this.technologyDetector = options.technologyDetector;
    this.dependencyAnalyzer = options.dependencyAnalyzer;
    this.architectureAnalyzer = options.architectureAnalyzer;
    this.apiAnalyzer = options.apiAnalyzer;
    this.authenticationAnalyzer = options.authenticationAnalyzer;
    this.keepRepoDir = options.keepRepoDir ?? false;
  }

  async analyzeRepository(repositoryUrl: string): Promise<RepositoryProfile> {
    logger.info({ repositoryUrl }, 'repository.profile:started');
    const step = <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const start = Date.now();
      return fn().then((value) => {
        logger.debug({ label, durationMs: Date.now() - start }, 'repository.profile:step');
        return value;
      });
    };

    const cloned = await step('clone', () => this.cloning.clone(repositoryUrl));

    const cleanups: Promise<void>[] = [];
    try {
      const fileSystem = await step('file-system', () => this.fileSystemAnalyzer.analyze(cloned.localPath));
      const technologies = await step('technology', () => this.technologyDetector.detect(fileSystem, cloned.localPath));
      const dependencies = await step('dependencies', () => this.dependencyAnalyzer.analyze(fileSystem, cloned.localPath));
      const architecture = await step('architecture', () => this.architectureAnalyzer.analyze(fileSystem, cloned.localPath));
      const api = await step('api', () => this.apiAnalyzer.analyze(fileSystem, cloned.localPath));
      const authentication = await step('authentication', () =>
        this.authenticationAnalyzer.analyze(fileSystem, cloned.localPath)
      );

      const profile = this.assemble(cloned, {
        fileSystem,
        technologies,
        dependencies,
        architecture,
        api,
        authentication,
      });

      logger.info(
        { owner: cloned.identity.owner, name: cloned.identity.name, commit: cloned.commitSha },
        'repository.profile:complete'
      );
      return profile;
    } finally {
      if (!this.keepRepoDir) {
        await this.cloning.cleanup(cloned.localPath).catch(() => undefined);
      }
    }
  }

  private assemble(cloned: ClonedRepository, bundle: AnalysisBundle): RepositoryProfile {
    return {
      meta: {
        provider: cloned.identity.provider,
        owner: cloned.identity.owner,
        name: cloned.identity.name,
        homepageUrl: cloned.identity.homepageUrl,
        cloneUrl: cloned.identity.cloneUrl,
        commitSha: cloned.commitSha,
        sizeBytes: cloned.sizeBytes,
        clonedAt: cloned.clonedAt.toISOString(),
        analyzedAt: new Date().toISOString(),
      },
      fileSystem: this.projectFileSystem(bundle.fileSystem),
      technologies: {
        primary: bundle.technologies.technologies[0]
          ? projectTechnology(bundle.technologies.technologies[0])
          : null,
        all: bundle.technologies.technologies.map(projectTechnology),
      },
      dependencies: bundle.dependencies.summaries.map((s) => ({
        ecosystem: s.ecosystem,
        source: s.source,
        count: s.count,
        runtimes: compactRuntimes(s.runtimes),
        librariesByCategory: { ...s.librariesByCategory },
      })),
      architecture: {
        primary: bundle.architecture.primary?.type ?? 'Unknown',
        candidates: bundle.architecture.candidates.map((c) => ({
          type: c.type,
          confidence: c.confidence,
        })),
      },
      api: {
        endpointCount: bundle.api.endpoints.length,
        protocols: [...bundle.api.protocols],
        graphqlSources: [...bundle.api.graphqlSources],
        endpoints: bundle.api.endpoints.map((e) => ({ method: e.method, path: e.path, file: e.file })),
      },
      authentication: {
        schemes: [...bundle.authentication.schemes],
        libraries: [...bundle.authentication.libraries],
        middleware: [...bundle.authentication.middleware],
      },
    };
  }

  private projectFileSystem(analysis: FileSystemAnalysis): RepositoryProfile['fileSystem'] {
    const extensionCounts = Object.entries(analysis.filesByExtension)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5) as [string, number][];
    return {
      fileCount: analysis.fileCount,
      folderCount: analysis.folderCount,
      totalSizeBytes: analysis.totalSizeBytes,
      linesOfCode: analysis.linesOfCode,
      topExtensions: extensionCounts,
      importantFiles: analysis.importantFiles
        .filter((f) => f.relativePath !== null)
        .map((f) => f.relativePath as string),
    };
  }
}

export interface AnalysisBundle {
  readonly fileSystem: FileSystemAnalysis;
  readonly technologies: TechnologyDetection;
  readonly dependencies: DependencyAnalysis;
  readonly architecture: ArchitectureDetection;
  readonly api: ApiInventory;
  readonly authentication: AuthenticationDetection;
}

function projectTechnology(tech: {
  name: string;
  category: string;
  confidence: number;
}): ProfileTechnology {
  return { name: tech.name, category: tech.category, confidence: tech.confidence };
}

function compactRuntimes(input: Partial<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}