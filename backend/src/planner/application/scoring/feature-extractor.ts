import type { SurfaceInput, StaticVulnInput, ProfileInput } from '../../domain/models/plan-input';
import type { PlannerRisk } from '../../domain/models/plan';

export interface TargetFeatures {
  readonly url: string;
  readonly method: string;
  readonly source: string;
  readonly statusCode: number | null;
  readonly scoutRisk: PlannerRisk;
  readonly authentication: boolean;
  readonly hasParameters: boolean;
  readonly hasQuery: boolean;
  readonly isApi: boolean;
  readonly isAdmin: boolean;
  readonly isUpload: boolean;
  readonly isLogin: boolean;
  readonly isSearch: boolean;
  readonly isDbRelated: boolean;
  readonly isStatic: boolean;
  readonly isHealth: boolean;
  readonly isDocs: boolean;
  readonly parameters: readonly string[];
  readonly profileHint: ProfileInput;
}

const DB_PATH_RE = /(sql|query|db|database|search|filter|sort|report|graphql|lookup|find)/i;
const SEARCH_RE = /(search|query|filter|lookup)/i;

const RISK_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Extract the deterministic feature set the scorer reasons over. */
export function extractFeatures(
  surface: SurfaceInput,
  profile: ProfileInput,
): TargetFeatures {
  const path = pathOf(surface.url);
  const hasQuery = surface.url.includes('?');
  const hasParameters = surface.parameters.length > 0 || hasQuery;
  const isApi = /^\/(api|v[0-9]|rest|graphql|rpc)(\/|$)/i.test(path);
  const isAdmin = /(^|\/)(admin|administrator|console|wp-admin)(\/|$)/i.test(path);
  const isUpload =
    /(^|\/)(upload|uploads|file-upload|attachment)(\/|$)/i.test(path);
  const isLogin = /(^|\/)(login|signin|sign-in|auth|sso)(\/|$)/i.test(path);
  const isSearch = SEARCH_RE.test(path);
  const isDbRelated = DB_PATH_RE.test(path) || (hasParameters && (isApi || isSearch));
  const isStatic = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|map|pdf|zip)$/i.test(path);
  const isHealth = /(health|healthz|status|ready|ping)$/i.test(path);
  const isDocs = /(openapi|swagger|api-docs|redoc)/i.test(path);

  return {
    url: surface.url,
    method: surface.method.toUpperCase(),
    source: surface.source,
    statusCode: surface.statusCode,
    scoutRisk: normalizeRisk(surface.risk),
    authentication: surface.authentication,
    hasParameters,
    hasQuery,
    isApi,
    isAdmin,
    isUpload,
    isLogin,
    isSearch,
    isDbRelated,
    isStatic,
    isHealth,
    isDocs,
    parameters: surface.parameters,
    profileHint: profile,
  };
}

/** Summarize static findings into the severity/category signals used by the scorer. */
export interface StaticSummary {
  readonly count: number;
  readonly maxSeverity: PlannerRisk | null;
  readonly criticalCount: number;
  readonly highCount: number;
  /** Derived candidate-vuln categories present in static findings. */
  readonly categories: readonly string[];
}

export function summarizeFindings(findings: readonly StaticVulnInput[]): StaticSummary {
  const rank: Record<string, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  let maxSeverity: PlannerRisk | null = null;
  let criticalCount = 0;
  let highCount = 0;
  const categories = new Set<string>();

  for (const f of findings) {
    const sev = (f.severity ?? 'INFO').toUpperCase() as PlannerRisk;
    if (maxSeverity === null || rank[sev] > rank[maxSeverity]) maxSeverity = sev;
    if (sev === 'CRITICAL') criticalCount += 1;
    if (sev === 'HIGH') highCount += 1;
    for (const c of categorizeFinding(f)) categories.add(c);
  }

  return {
    count: findings.length,
    maxSeverity,
    criticalCount,
    highCount,
    categories: [...categories],
  };
}

/** Map one finding's type/CWE/message to planner hypothesis categories. */
export function categorizeFinding(f: StaticVulnInput): readonly string[] {
  const hay = `${f.type ?? ''} ${f.cwe ?? ''} ${f.cve ?? ''} ${f.message ?? ''}`.toLowerCase();
  const out: string[] = [];
  if (/(sql|sqli|injection)/i.test(hay)) out.push('SQL Injection');
  if (/(xss|cross-site|scripting|reflect)/i.test(hay)) out.push('Cross-Site Scripting');
  if (/(auth|login|session|bypass|idor|access control)/i.test(hay)) out.push('Authentication Bypass');
  if (/(ssrf|server-side request)/i.test(hay)) out.push('Server-Side Request Forgery');
  if (/(upload|file upload)/i.test(hay)) out.push('Insecure File Upload');
  if (/(traversal|path traversal|\.\.\/)/i.test(hay)) out.push('Path Traversal');
  if (/(deserial)/i.test(hay)) out.push('Insecure Deserialization');
  return [...new Set(out)];
}

function normalizeRisk(value: string): PlannerRisk {
  const upper = (value ?? 'LOW').toUpperCase();
  return RISK_RANK[upper] !== undefined ? (upper as PlannerRisk) : 'LOW';
}

function pathOf(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    return url;
  }
}