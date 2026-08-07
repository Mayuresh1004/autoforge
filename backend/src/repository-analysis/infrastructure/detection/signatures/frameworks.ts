import type { TechnologySignal } from '../signal';

/**
 * Frontend + backend framework detection. Relies on config files, language
 * extensions, and manifest dependencies.
 */
export const FRAMEWORK_SIGNALS: readonly TechnologySignal[] = [
  // --- Frontend
  {
    name: 'Next.js',
    category: 'framework',
    confidence: 1.0,
    globs: ['next.config.*'],
    pkgDependencies: ['next'],
  },
  {
    name: 'React',
    category: 'framework',
    confidence: 0.98,
    extensions: ['jsx', 'tsx'],
    pkgDependencies: ['react'],
    files: ['App.tsx', 'App.jsx'],
  },
  {
    name: 'Angular',
    category: 'framework',
    confidence: 0.98,
    paths: ['angular.json'],
    pkgDependencies: ['@angular/core'],
  },
  {
    name: 'Vue',
    category: 'framework',
    confidence: 0.98,
    extensions: ['vue'],
    globs: ['vue.config.*'],
    pkgDependencies: ['vue'],
  },
  {
    name: 'Svelte',
    category: 'framework',
    confidence: 0.95,
    extensions: ['svelte'],
    pkgDependencies: ['svelte'],
  },
  {
    name: 'Nuxt',
    category: 'framework',
    confidence: 0.95,
    globs: ['nuxt.config.*'],
    pkgDependencies: ['nuxt'],
  },
  {
    name: 'Gatsby',
    category: 'framework',
    confidence: 0.9,
    globs: ['gatsby-config.*'],
    pkgDependencies: ['gatsby'],
  },
  {
    name: 'Astro',
    category: 'framework',
    confidence: 0.98,
    extensions: ['astro'],
    globs: ['astro.config.*'],
    pkgDependencies: ['astro'],
  },
  {
    name: 'Remix',
    category: 'framework',
    confidence: 0.9,
    paths: ['remix.config.js'],
    pkgDependencies: ['@remix-run/react'],
  },
  { name: 'SolidJS', category: 'framework', confidence: 0.9, pkgDependencies: ['solid-js'] },

  // ── Backend (JavaScript/TypeScript)
  { name: 'Express', category: 'framework', confidence: 0.98, pkgDependencies: ['express'] },
  { name: 'NestJS', category: 'framework', confidence: 0.98, paths: ['nest-cli.json'], pkgDependencies: ['@nestjs/core'] },
  { name: 'Fastify', category: 'framework', confidence: 0.9, pkgDependencies: ['fastify'] },
  { name: 'Hapi', category: 'framework', confidence: 0.9, pkgDependencies: ['@hapi/hapi'] },
  { name: 'Koa', category: 'framework', confidence: 0.9, pkgDependencies: ['koa'] },
  { name: 'Ktor', category: 'framework', confidence: 0.85, pkgDependencies: ['io.ktor'] },

  // ── Backend (Python)
  { name: 'FastAPI', category: 'framework', confidence: 0.98, pyDependencies: ['fastapi'] },
  { name: 'Flask', category: 'framework', confidence: 0.98, pyDependencies: ['flask'] },
  { name: 'Django', category: 'framework', confidence: 0.98, pyDependencies: ['django'], files: ['manage.py'] },
  { name: 'Tornado', category: 'framework', confidence: 0.9, pyDependencies: ['tornado'] },

  // ── Backend (JVM / Microsoft / PHP / Ruby / Go)
  {
    name: 'Spring Boot',
    category: 'framework',
    confidence: 0.95,
    manifestContains: [
      { path: 'pom.xml', needle: 'spring-boot' },
      { path: 'build.gradle', needle: 'spring-boot' },
    ],
  },
  {
    name: 'Laravel',
    category: 'framework',
    confidence: 0.95,
    files: ['artisan'],
    manifestContains: [{ path: 'composer.json', needle: 'laravel/framework' }],
  },
  {
    name: 'Symfony',
    category: 'framework',
    confidence: 0.9,
    manifestContains: [{ path: 'composer.json', needle: 'symfony/framework-bundle' }],
  },
  { name: 'ASP.NET', category: 'framework', confidence: 0.9, globs: ['**/*.csproj', '**/*.sln'] },
  {
    name: 'Ruby on Rails',
    category: 'framework',
    confidence: 0.95,
    manifestContains: [{ path: 'Gemfile', needle: 'rails' }],
    directories: ['app'],
  },
  {
    name: 'Gin',
    category: 'framework',
    confidence: 0.9,
    manifestContains: [{ path: 'go.mod', needle: 'gin-gonic/gin' }],
  },
  {
    name: 'Echo',
    category: 'framework',
    confidence: 0.8,
    manifestContains: [{ path: 'go.mod', needle: 'labstack/echo' }],
  },
  {
    name: 'Actix Web',
    category: 'framework',
    confidence: 0.9,
    manifestContains: [{ path: 'Cargo.toml', needle: 'actix-web' }],
  },
];