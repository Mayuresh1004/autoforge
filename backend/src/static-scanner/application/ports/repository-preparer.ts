import type { RepositoryProfile } from '../../../repository-analysis/domain/models/repository-profile';

export interface PreparedRepository {
  readonly profile: RepositoryProfile;
  readonly localPath: string;
}

/**
 * Application-boundary port that hands the scanner a workable repository
 * (a prepared profile + absolute working-tree path). Implemented by the
 * repository-analysis profile service; makes the scanner module independent
 * of that module's implementation.
 */
export interface RepositoryPreparer {
  prepareRepository(repositoryUrl: string): Promise<PreparedRepository>;
  disposeRepository(localPath: string): Promise<void>;
}