import type { FileSystemAnalysis } from '../../domain/models/file-system';
import type {
  ApiEndpoint,
  ApiInventory,
  ApiProtocol,
} from '../../domain/models/api';
import type { ApiAnalyzer } from '../../domain/ports/api-analyzer';
import { DetectionContext } from '../detection/detection-context';

const MAX_FILE_BYTES = 200_000;
const MAX_FILES = 500;
const MAX_ENDPOINTS = 200;

interface MatchResult {
  method?: string;
  path: string;
}

interface RoutePattern {
  readonly exts: readonly string[];
  readonly regex: RegExp;
  readonly apply: (match: RegExpExecArray) => MatchResult | null;
  readonly pathCheck?: (path: string, file: string) => boolean;
}

const ROUTE_PATTERNS: readonly RoutePattern[] = [
  // Express/Fastify/Koa/Hapi call-sites: .get('/x', ...)
  {
    exts: ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'],
    regex: /\.(get|post|put|delete|patch|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    apply: (m) => ({ method: m[1].toUpperCase(), path: m[2] }),
  },
  // Express router mount: app.use('/users', router)
  {
    exts: ['js', 'ts', 'tsx', 'jsx'],
    regex: /\.(?:use)\s*\(\s*['"`](\/[^'"`]+)['"`]/g,
    apply: (m) => ({ path: m[1] }),
    pathCheck: (p) => p.length > 1,
  },
  // Python (FastAPI/Flask decorators): @app.get('/x')
  {
    exts: ['py'],
    regex: /@\w+\.(get|post|put|delete|patch|options|websocket)\(\s*['"]([^'"`]+)['"]/g,
    apply: (m) => ({ method: m[1] === 'websocket' ? 'WS' : m[1].toUpperCase(), path: m[2] }),
  },
  // Flask with explicit methods: @app.route('/x', methods=['POST'])
  {
    exts: ['py'],
    regex: /@\w+\.route\(\s*['"]([^'"`]+)['"]\s*,\s*methods\s*=\s*\[?\s*['"]?([A-Za-z, ]+)['"]?\s*\]?\s*\)/g,
    apply: (m) => ({ method: (m[2] ?? '').trim().toUpperCase() || 'ANY', path: m[1] }),
  },
  // Spring (Java/Kotlin) mapping annotations: @GetMapping('/x') / @RequestMapping(value="/x")
  {
    exts: ['java', 'kt'],
    regex: /@((?:Get|Post|Put|Delete|Patch)Mapping|RequestMapping)\(\s*(?:value\s*=\s*)?['"]?([^'"]*)['"]?\)?/g,
    apply: (m) => {
      const kind = m[1];
      const method = kind === 'RequestMapping' ? 'ANY' : kind.replace('Mapping', '').toUpperCase();
      return { method, path: m[2] ?? '/' };
    },
  },
  // Go (Gin/Echo-style): router.GET("/x", ...)
  {
    exts: ['go'],
    regex: /\.((?:GET|POST|PUT|DELETE|PATCH|HEAD))\s*\(\s*['"]([^'"`]+)['"]/g,
    apply: (m) => ({ method: m[1], path: m[2] }),
  },
  // Go net/http: mux.HandleFunc("/x", h)
  {
    exts: ['go'],
    regex: /\.Handle(?:Func)?\s*\(\s*['"]([^'"`]+)['"]/g,
    apply: (m) => ({ path: m[1] }),
  },
  // Laravel routes files: Route::post('/x', ...)
  {
    exts: ['php'],
    regex: /Route::(get|post|put|delete|patch|options|match|any)\s*\(\s*['"]([^'"`]+)['"]/g,
    apply: (m) => ({ method: m[1].toUpperCase() === 'MATCH' || m[1] === 'any' ? 'ANY' : m[1].toUpperCase(), path: m[2] }),
    pathCheck: (_p, file) => file.toLowerCase().includes('route'),
  },
  // Rails routes.rb: get '/x', to: ...
  {
    exts: ['rb'],
    regex: /\b(get|post|put|patch|delete|match)\s+['"]([^'"`]+)['"]/g,
    apply: (m) => ({ method: m[1].toUpperCase(), path: m[2] }),
    pathCheck: (_p, file) => file.toLowerCase().includes('route'),
  },
];

/**
 * Discovers REST routes and communication protocols by scanning source
 * files for framework-independent declarations. Read-only and size-bounded.
 */
export class RegexApiAnalyzer implements ApiAnalyzer {
  async analyze(analysis: FileSystemAnalysis, rootPath: string): Promise<ApiInventory> {
    const ctx = DetectionContext.create(analysis, rootPath);
    const endpoints: ApiEndpoint[] = [];
    const seen = new Set<string>();
    let filesScanned = 0;

    for (const file of analysis.files) {
      if (filesScanned >= MAX_FILES || endpoints.length >= MAX_ENDPOINTS) break;
      if (file.sizeBytes > MAX_FILE_BYTES) continue;

      const patterns = ROUTE_PATTERNS.filter((p) => p.exts.includes(file.extension));
      if (patterns.length === 0) continue;

      const content = await ctx.readManifest(file.relativePath);
      if (content === null) continue;
      filesScanned += 1;

      outer: for (const pattern of patterns) {
        pattern.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        let iterations = 0;
        while ((match = pattern.regex.exec(content)) && iterations++ < 2000) {
          const result = pattern.apply(match);
          if (!result || !result.path) continue;
          if (pattern.pathCheck && !pattern.pathCheck(result.path, file.relativePath)) continue;

          const method = result.method ?? 'ANY';
          const key = `${method} ${result.path}`;
          if (seen.has(key)) continue;
          seen.add(key);
          endpoints.push({ method, path: result.path, file: file.relativePath });
          if (endpoints.length >= MAX_ENDPOINTS) break outer;
        }
      }
    }

    const protocols = await this.detectProtocols(ctx);
    const graphqlSources = analysis.files
      .filter((f) => /\.(graphql|gql)$/.test(f.extension) || /schema(\.graphql|\.gql)?$/.test(f.name))
      .map((f) => f.relativePath);

    if (endpoints.length > 0 && !protocols.includes('rest')) protocols.push('rest');

    return {
      endpoints,
      protocols,
      graphqlSources,
    };
  }

  private async detectProtocols(ctx: DetectionContext): Promise<ApiProtocol[]> {
    const protocols: ApiProtocol[] = [];
    const jsDeps = await ctx.packageDependencyNames();
    const pyDeps = await ctx.pythonDependencyNames();

    const matches = (...targets: string[]) =>
      jsDeps.some((d) => targets.some((t) => DetectionContext.dependencyMatches(d, t))) ||
      pyDeps.some((d) => targets.some((t) => DetectionContext.dependencyMatches(d, t)));

    if (
      ctx.hasGlob('**/*.graphql') ||
      ctx.hasGlob('**/*.gql') ||
      matches('graphql', 'apollo-server', 'graphql-yoga', 'type-graphql')
    ) {
      protocols.push('graphql');
    }
    if (matches('socket.io', 'ws', 'sockjs', 'uWebSockets', 'websockets')) {
      protocols.push('websocket');
    }
    if (ctx.hasGlob('**/*.proto') || matches('grpc', '@grpc/client', '@trpc/server', '@connectrpc/connect')) {
      protocols.push('rpc');
    }
    return protocols;
  }
}