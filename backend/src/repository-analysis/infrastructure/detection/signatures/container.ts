import type { TechnologySignal } from '../signal';

/**
 * Containerization and orchestration detection (Docker, Kubernetes, ...).
 */
export const CONTAINER_SIGNALS: readonly TechnologySignal[] = [
  {
    name: 'Docker',
    category: 'container',
    confidence: 1.0,
    files: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', '.dockerignore'],
  },
  {
    name: 'Kubernetes',
    category: 'container',
    confidence: 0.8,
    files: ['kustomization.yaml'],
    directories: ['k8s', 'deploy'],
    globs: ['**/*.k8s.yaml', '**/*.k8s.yml'],
  },
  {
    name: 'Helm',
    category: 'container',
    confidence: 0.9,
    files: ['Chart.yaml', 'values.yaml'],
    globs: ['**/Chart.yaml'],
  },
  {
    name: 'Kustomize',
    category: 'container',
    confidence: 0.9,
    files: ['kustomization.yaml', 'kustomization.yml'],
  },
  {
    name: 'Dev Containers',
    category: 'container',
    confidence: 0.95,
    paths: ['.devcontainer/devcontainer.json', '.devcontainer/devcontainer.jsonc'],
  },
  {
    name: 'docker-compose',
    category: 'container',
    confidence: 0.98,
    files: ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
  },
];