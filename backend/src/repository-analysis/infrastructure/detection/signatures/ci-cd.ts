import type { TechnologySignal } from '../signal';

/**
 * CI/CD system detection from workflow/config file locations.
 */
export const CI_CD_SIGNALS: readonly TechnologySignal[] = [
  {
    name: 'GitHub Actions',
    category: 'ci-cd',
    confidence: 1.0,
    globs: ['.github/workflows/*.yml', '.github/workflows/*.yaml'],
  },
  { name: 'GitLab CI', category: 'ci-cd', confidence: 1.0, paths: ['.gitlab-ci.yml'] },
  { name: 'CircleCI', category: 'ci-cd', confidence: 1.0, paths: ['.circleci/config.yml'] },
  { name: 'Azure Pipelines', category: 'ci-cd', confidence: 0.95, globs: ['azure-pipelines*.yml', 'azure-pipelines*.yaml'] },
  { name: 'Jenkins', category: 'ci-cd', confidence: 0.95, files: ['Jenkinsfile'] },
  { name: 'Travis CI', category: 'ci-cd', confidence: 0.9, paths: ['.travis.yml'] },
  { name: 'Bitbucket Pipelines', category: 'ci-cd', confidence: 0.95, paths: ['bitbucket-pipelines.yml'] },
  { name: 'Buildkite', category: 'ci-cd', confidence: 0.9, paths: ['buildkite.yml', '.buildkite/pipeline.yml'] },
  { name: 'AppVeyor', category: 'ci-cd', confidence: 0.85, paths: ['.appveyor.yml'] },
  { name: 'Drone', category: 'ci-cd', confidence: 0.85, paths: ['.drone.yml'] },
];