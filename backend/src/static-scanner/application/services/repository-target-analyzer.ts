import type { ScanTargetProfile } from '../../domain/models/scan-target';
import { DefaultFileSystemAnalyzer } from '../../../repository-analysis/infrastructure/fs/file-system-analyzer';
import { SignatureTechnologyDetector } from '../../../repository-analysis/infrastructure/detection/technology-detector';
import { DefaultDependencyAnalyzer } from '../../../repository-analysis/infrastructure/dependency-analyzer';

export interface SandboxScanTarget {
  readonly name: string;
  readonly target: ScanTargetProfile;
}

/**
 * Builds the small scanner-selection profile from an already-materialized
 * working tree (the one the Sandbox Manager cloned into a sandbox). Uses only
 * the light analyzers the scanner needs — filesystem, technologies, manifests —
 * and never executes anything from the repo.
 */
export function createRepositoryTargetAnalyzer(): (
  localPath: string,
  repositoryUrl: string
) => Promise<SandboxScanTarget> {
  const fileSystemAnalyzer = new DefaultFileSystemAnalyzer();
  const technologyDetector = new SignatureTechnologyDetector();
  const dependencyAnalyzer = new DefaultDependencyAnalyzer();

  return async (localPath, repositoryUrl): Promise<SandboxScanTarget> => {
    const fileSystem = await fileSystemAnalyzer.analyze(localPath);
    const technologies = await technologyDetector.detect(fileSystem, localPath);
    const dependencies = await dependencyAnalyzer.analyze(fileSystem, localPath);

    const importantFiles = fileSystem.importantFiles.map((entry) => entry.name);
    const target: ScanTargetProfile = {
      languages: technologies.technologies
        .filter((tech) => tech.category === 'language')
        .map((tech) => tech.name),
      ecosystems: dependencies.summaries.map((summary) => summary.ecosystem.toLowerCase()),
      dependencySources: dependencies.summaries.map((summary) => summary.source),
      lockfiles: importantFiles.filter((file) =>
        /(package-lock|pnpm-lock|yarn\.lock|Cargo\.lock|Gemfile\.lock|poetry\.lock|composer\.lock)/i.test(
          file
        )
      ),
      importantFiles,
    };

    return { name: repositoryNameFromUrl(repositoryUrl), target };
  };
}

/** `https://github.com/acme/repo.git` → `acme/repo`. */
export function repositoryNameFromUrl(repositoryUrl: string): string {
  const cleaned = repositoryUrl.replace(/\.git$/, '');
  const parts = cleaned.split('/');
  return parts.slice(-2).join('/');
}