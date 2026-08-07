import type { FileSystemAnalysis } from '../../domain/models/file-system';
import type { AuthenticationDetection } from '../../domain/models/authentication';
import type { AuthenticationAnalyzer } from '../../domain/ports/authentication-analyzer';
import { DetectionContext } from '../detection/detection-context';

const MAX_FILE_BYTES = 100_000;
const MAX_FILES = 200;
const MAX_MIDDLEWARE_EVIDENCE = 5;

interface AuthRule {
  readonly name: string;
  readonly scheme: string;
  readonly targets: readonly string[];
}

const AUTH_RULES: readonly AuthRule[] = [
  { name: 'jsonwebtoken', scheme: 'JWT', targets: ['jsonwebtoken', 'jose', 'pyjwt', '@nestjs/jwt', 'jwt-decode', 'passport-jwt', 'jose-next'] },
  { name: 'passport', scheme: 'OAuth2', targets: ['passport', 'passport-google-oauth20', 'passport-azure-ad'] },
  { name: 'oauth', scheme: 'OAuth2', targets: ['oauth2', 'oauth', 'oidc-client', '@auth/core', 'keycloak'] },
  { name: 'session', scheme: 'Session', targets: ['express-session', 'iron-session', 'cookie-session', 'flask-session'] },
  { name: 'next-auth', scheme: 'NextAuth', targets: ['next-auth'] },
  { name: 'clerk', scheme: 'Clerk', targets: ['@clerk/nextjs', '@clerk/clerk-react', '@clerk/clerk-js'] },
  { name: 'supabase', scheme: 'Supabase', targets: ['@supabase/supabase-js', '@supabase/ssr'] },
  { name: 'firebase', scheme: 'Firebase', targets: ['firebase', '@firebase/auth'] },
  { name: 'keycloak', scheme: 'SSO', targets: ['keycloak-js'] },
];

const AUTH_MIDDLEWARE_REGEX =
  /(requireAuth|ensureAuthenticated|verifyToken|isAuthenticated|authenticate|passport\.authenticate|@UseGuards|authMiddleware|requireToken|checkAuth|protect\b|authorize\b)/gi;

/**
 * Detects authentication approach: libraries and schemes from dependency
 * manifests, plus files that look like auth middleware/guards.
 */
export class RegexAuthenticationAnalyzer implements AuthenticationAnalyzer {
  async analyze(analysis: FileSystemAnalysis, rootPath: string): Promise<AuthenticationDetection> {
    const ctx = DetectionContext.create(analysis, rootPath);
    const jsDeps = await ctx.packageDependencyNames();
    const pyDeps = await ctx.pythonDependencyNames();
    const allDeps = [...jsDeps, ...pyDeps];

    const libraries: string[] = [];
    const schemes = new Set<string>();
    for (const rule of AUTH_RULES) {
      if (rule.targets.some((t) => allDeps.some((d) => DetectionContext.dependencyMatches(d, t)))) {
        libraries.push(rule.name);
        schemes.add(rule.scheme);
      }
    }

    const middleware = await this.findMiddlewareFiles(analysis, ctx);

    return { schemes: [...schemes], libraries, middleware };
  }

  private async findMiddlewareFiles(
    analysis: FileSystemAnalysis,
    ctx: DetectionContext
  ): Promise<string[]> {
    const evidence: string[] = [];
    let filesScanned = 0;

    for (const file of analysis.files) {
      if (filesScanned >= MAX_FILES || evidence.length >= MAX_MIDDLEWARE_EVIDENCE) break;
      if (!this.looksLikeSource(file.extension)) continue;
      if (file.sizeBytes > MAX_FILE_BYTES) continue;

      // Name-based hint first: middleware/auth-named files.
      if (/auth|passport|guard|session/i.test(file.relativePath)) {
        evidence.push(file.relativePath);
        continue;
      }

      const content = await ctx.readManifest(file.relativePath);
      if (content === null) continue;
      filesScanned += 1;

      if (AUTH_MIDDLEWARE_REGEX.test(content)) {
        evidence.push(file.relativePath);
      }
    }

    return [...new Set(evidence)].slice(0, MAX_MIDDLEWARE_EVIDENCE);
  }

  private looksLikeSource(extension: string): boolean {
    return ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'java', 'kt', 'rb', 'php', 'cs'].includes(
      extension
    );
  }
}