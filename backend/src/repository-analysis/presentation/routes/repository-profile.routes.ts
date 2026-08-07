import { Router } from 'express';
import { analyzerConfig } from '../../../config';
import { RepositoryCloningService } from '../../application/services/repository-cloning.service';
import { RepositoryProfileService } from '../../application/services/repository-profile.service';
import { GitHubUrlResolver } from '../../infrastructure/git/github-url-resolver';
import { GitRepositoryCloner } from '../../infrastructure/git/git-repository-cloner';
import { DefaultFileSystemAnalyzer } from '../../infrastructure/fs/file-system-analyzer';
import { SignatureTechnologyDetector } from '../../infrastructure/detection/technology-detector';
import { DefaultDependencyAnalyzer } from '../../infrastructure/dependency-analyzer';
import { SignatureArchitectureAnalyzer } from '../../infrastructure/analyzers/architecture-analyzer';
import { RegexApiAnalyzer } from '../../infrastructure/analyzers/api-analyzer';
import { RegexAuthenticationAnalyzer } from '../../infrastructure/analyzers/authentication-analyzer';
import { RepositoryProfileController } from '../controllers/repository-profile.controller';

/**
 * Composition root for the repository-analysis feature. Instantiates the
 * concrete infrastructure implementations and wires the application service
 * → controller → route. No DI framework — explicit constructor injection.
 */
const profileService = new RepositoryProfileService({
  cloning: new RepositoryCloningService({
    resolver: new GitHubUrlResolver(),
    cloner: new GitRepositoryCloner({ timeoutMs: analyzerConfig.cloneTimeoutMs }),
    workspaceDir: analyzerConfig.workspaceDir,
    maxRepoBytes: analyzerConfig.maxRepoBytes,
  }),
  fileSystemAnalyzer: new DefaultFileSystemAnalyzer(),
  technologyDetector: new SignatureTechnologyDetector(),
  dependencyAnalyzer: new DefaultDependencyAnalyzer(),
  architectureAnalyzer: new SignatureArchitectureAnalyzer(),
  apiAnalyzer: new RegexApiAnalyzer(),
  authenticationAnalyzer: new RegexAuthenticationAnalyzer(),
  keepRepoDir: analyzerConfig.keepRepoDir,
});

const controller = new RepositoryProfileController(profileService);

const router = Router();

router.post('/repositories', controller.analyze);

export { router as repositoryProfileRoutes };