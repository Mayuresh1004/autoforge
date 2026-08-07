import type { FileSystemAnalysis } from '../../domain/models/file-system';
import type {
  ArchitectureCandidate,
  ArchitectureDetection,
  ArchitectureType,
} from '../../domain/models/architecture';
import type { ArchitectureAnalyzer } from '../../domain/ports/architecture-analyzer';
import { DetectionContext } from '../detection/detection-context';

/**
 * Infers architecture from structural signals. Deliberately conservative:
 * candidates are only emitted when the evidence is meaningful, and the
 * primary is null (→ "Unknown") when nothing is strong enough.
 */
export class SignatureArchitectureAnalyzer implements ArchitectureAnalyzer {
  async analyze(analysis: FileSystemAnalysis, rootPath: string): Promise<ArchitectureDetection> {
    const ctx = DetectionContext.create(analysis, rootPath);
    const candidates: ArchitectureCandidate[] = [];
    const topDirs = ctx.topLevelDirectories;
    const allDirs = ctx.allDirectories;
    const allPaths = ctx.allPaths;

    const cleanArch = this.layeredArchitecture('clean', ['domain', 'application', 'infrastructure', 'presentation'], allDirs);
    if (cleanArch) candidates.push(cleanArch);

    const hexagonal = this.layeredArchitecture('hexagonal', ['adapters', 'ports', 'application', 'domain'], allDirs);
    if (hexagonal) candidates.push(hexagonal);

    const layered = this.layeredArchitecture('layered', ['controllers', 'services', 'repositories'], allDirs);
    if (layered) candidates.push(layered);

    this.maybePush(candidates, this.mvcCandidate(allDirs));
    this.maybePush(candidates, this.clientServerCandidate(allDirs));
    this.maybePush(candidates, this.monorepoCandidate(allPaths));
    this.maybePush(candidates, this.microservicesCandidate(topDirs, ctx));
    this.maybePush(candidates, this.monolithCandidate(ctx, allPaths));
    this.maybePush(candidates, this.serverlessCandidate(ctx));

    return {
      candidates,
      primary: this.pickPrimary(candidates),
    };
  }

  private pickPrimary(candidates: ArchitectureCandidate[]): ArchitectureCandidate | null {
    const relevant = candidates
      // "monorepo"/"microservices" are treated as higher-order than plain app shape.
      .filter((c) => c.confidence >= 0.6)
      .sort((a, b) => b.confidence - a.confidence);
    // Prefer specific topologies over a generic monorepo label.
    const topology = ['microservices', 'client-server', 'monorepo'].find((t) =>
      relevant.some((c) => c.type === t)
    );
    if (topology) {
      return relevant.find((c) => c.type === topology) ?? relevant[0];
    }
    return relevant[0] ?? null;
  }

  private layeredArchitecture(
    type: ArchitectureType,
    layers: string[],
    dirs: ReadonlySet<string>
  ): ArchitectureCandidate | null {
    const present = layers.filter((layer) => dirs.has(layer));
    if (present.length < 2) return null;
    return {
      type,
      confidence: present.length >= 3 ? 0.85 : 0.6,
      evidence: present.map((layer) => `directory: ${layer}`),
    };
  }

  private mvcCandidate(dirs: ReadonlySet<string>): ArchitectureCandidate | null {
    const present = ['controllers', 'models', 'views'].filter((d) => dirs.has(d));
    if (present.length >= 2) {
      return {
        type: 'mvc',
        confidence: 0.7,
        evidence: present.map((d) => `directory: ${d}`),
      };
    }
    return null;
  }

  private clientServerCandidate(dirs: ReadonlySet<string>): ArchitectureCandidate | null {
    const pairs = [
      ['client', 'server'],
      ['frontend', 'backend'],
      ['front-end', 'back-end'],
    ];
    for (const [a, b] of pairs) {
      if (dirs.has(a) && dirs.has(b)) {
        return {
          type: 'client-server',
          confidence: 0.8,
          evidence: [`directory: ${a}`, `directory: ${b}`],
        };
      }
    }
    return null;
  }

  private monorepoCandidate(allPaths: readonly string[]): ArchitectureCandidate | null {
    const manifests = allPaths.filter(
      (p) => p === 'package.json' || /^[^/]+\/package\.json$/.test(p)
    );
    const hasWorkspace = allPaths.some((p) =>
      ['pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'lerna.json', 'rush.json'].includes(p)
    );
    if (hasWorkspace || manifests.length >= 2) {
      return {
        type: 'monorepo',
        confidence: hasWorkspace || manifests.length >= 3 ? 0.9 : 0.7,
        evidence: [
          ...(hasWorkspace ? ['workspace manifest'] : []),
          `${manifests.length} package.json manifests`,
        ],
      };
    }
    return null;
  }

  private microservicesCandidate(
    dirs: ReadonlySet<string>,
    ctx: DetectionContext
  ): ArchitectureCandidate | null {
    const serviceManifest = ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'requirements.txt'];
    const serviceDirs = [...dirs].filter((dir) =>
      serviceManifest.some((m) => ctx.hasPath(`${dir}/${m}`))
    );
    if (serviceDirs.length >= 3) {
      return {
        type: 'microservices',
        confidence: 0.7,
        evidence: serviceDirs.map((d) => `service: ${d}`),
      };
    }
    return null;
  }

  private monolithCandidate(
    ctx: DetectionContext,
    allPaths: readonly string[]
  ): ArchitectureCandidate | null {
    const rootManifests = ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml'].filter((p) =>
      ctx.hasPath(p)
    );
    const onlyRootManifests =
      rootManifests.length > 0 &&
      allPaths.filter((p) => p.endsWith('package.json')).length <= 1 &&
      !allPaths.some((p) => p.includes('/package.json'));
    const hasServices = ctx.topLevelDirectories.has('services') || ctx.topLevelDirectories.has('api');
    if (onlyRootManifests && !hasServices) {
      return {
        type: 'monolith',
        confidence: 0.6,
        evidence: rootManifests.map((p) => `root manifest: ${p}`),
      };
    }
    return null;
  }

  private serverlessCandidate(ctx: DetectionContext): ArchitectureCandidate | null {
    const serverless = ['serverless.yml', 'serverless.yaml', 'vercel.json', 'netlify.toml', 'wrangler.toml', 'package.json'].filter(
      (p) => ctx.hasPath(p)
    ).filter((p) => p !== 'package.json');
    if (serverless.length >= 1) {
      return { type: 'serverless', confidence: 0.6, evidence: serverless.map((p) => `file: ${p}`) };
    }
    return null;
  }

  private maybePush(
    list: ArchitectureCandidate[],
    candidate: ArchitectureCandidate | null
  ): void {
    if (candidate) list.push(candidate);
  }
}