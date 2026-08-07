import type { TechnologySignal } from '../signal';

/**
 * Build-tool detection from config files and package dependencies.
 */
export const BUILD_TOOL_SIGNALS: readonly TechnologySignal[] = [
  { name: 'Vite', category: 'build-tool', confidence: 0.95, globs: ['vite.config.*'] },
  { name: 'Webpack', category: 'build-tool', confidence: 0.95, globs: ['webpack.config.*'] },
  { name: 'Rollup', category: 'build-tool', confidence: 0.9, globs: ['rollup.config.*'] },
  { name: 'Rspack', category: 'build-tool', confidence: 0.9, globs: ['rspack.config.*'] },
  { name: 'esbuild', category: 'build-tool', confidence: 0.8, globs: ['esbuild.config.*'], pkgDependencies: ['esbuild'] },
  { name: 'Turborepo', category: 'build-tool', confidence: 0.95, paths: ['turbo.json'], pkgDependencies: ['turbo'] },
  { name: 'Nx', category: 'build-tool', confidence: 0.9, paths: ['nx.json', 'workspace.json'], pkgDependencies: ['@nx/workspace'] },
  { name: 'Gulp', category: 'build-tool', confidence: 0.85, globs: ['gulpfile.*'] },
  { name: 'Grunt', category: 'build-tool', confidence: 0.85, files: ['Gruntfile.js', 'Gruntfile.coffee'] },
  { name: 'Make', category: 'build-tool', confidence: 0.85, files: ['Makefile', 'makefile'] },
  { name: 'CMake', category: 'build-tool', confidence: 0.85, paths: ['CMakeLists.txt'], files: ['CMakeLists.txt'] },
  { name: 'Bazel', category: 'build-tool', confidence: 0.8, paths: ['WORKSPACE', 'BUILD.bazel', 'BUILD'] },
];