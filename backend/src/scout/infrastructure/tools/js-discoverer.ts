import type { HttpMethod } from '../../domain/models/attack-surface';

export interface JsDiscoveredEndpoint {
  readonly path: string;
  readonly method: HttpMethod;
  readonly parameters: readonly string[];
}

/**
 * Conservative JavaScript inspector for API routes and parameter definitions.
 * Extracts API routes (fetch, axios, XHR, template strings, literal paths)
 * and query/body parameter names without requiring full AST parsing.
 */
export function discoverEndpointsFromJs(jsContent: string): readonly JsDiscoveredEndpoint[] {
  const endpoints: JsDiscoveredEndpoint[] = [];
  const seen = new Set<string>();

  // 1. Match path literals and template strings starting with /api/, /v1/, /v2/, /graphql, or known endpoints
  const pathRegex = /(?:fetch|axios|api|request|\.get|\.post|\.put|\.delete|\.patch)?\s*\(?\s*["'`](\/(?:api|v[0-9]+|graphql|products|comments|users|auth|search|admin|login|register|query|upload)[^"'`\s]*)["'`]/gi;
  let match: RegExpExecArray | null;

  while ((match = pathRegex.exec(jsContent)) !== null) {
    const rawUrl = match[1];
    const parsed = parseJsUrlString(rawUrl);
    if (!parsed) continue;

    // Infer HTTP method if near a method call
    const snippet = jsContent.slice(Math.max(0, match.index - 30), match.index).toLowerCase();
    let method: HttpMethod = 'GET';
    if (snippet.includes('post')) method = 'POST';
    else if (snippet.includes('put')) method = 'PUT';
    else if (snippet.includes('delete')) method = 'DELETE';
    else if (snippet.includes('patch')) method = 'PATCH';

    const normalizedPath = (!parsed.path.startsWith('/api/') && !parsed.path.startsWith('/v1/') && !parsed.path.startsWith('/v2/'))
      ? `/api${parsed.path.startsWith('/') ? '' : '/'}${parsed.path}`
      : parsed.path;

    const candidatePaths = [normalizedPath];

    for (const cPath of candidatePaths) {
      const fullUrlPath = parsed.parameters.length > 0
        ? `${cPath}?${parsed.parameters.map((p) => `${p}=`).join('&')}`
        : cPath;
      const existingIndex = endpoints.findIndex((e) => e.path.split('?')[0] === cPath);

      if (existingIndex >= 0) {
        const existing = endpoints[existingIndex];
        const mergedMethod = method !== 'GET' ? method : existing.method;
        const mergedParams = [...new Set([...existing.parameters, ...parsed.parameters])];
        endpoints[existingIndex] = {
          path: existing.path.includes('?') ? existing.path : fullUrlPath,
          method: mergedMethod,
          parameters: mergedParams,
        };
      } else {
        seen.add(`${method} ${cPath}`);
        endpoints.push({
          path: fullUrlPath,
          method,
          parameters: parsed.parameters,
        });
      }
    }
  }

  // 2. Scan for specific axios/api/fetch method calls with payload objects: axios.post("/api/comments", { author, body })
  const methodCallRegex = /(?:axios|api|fetch)\s*\.\s*(post|put|patch|get)\s*\(\s*["'`](\/(?:api|v[0-9]+|graphql|products|comments|users|auth|search|admin|login|register)[^"'`\s]*)["'`]\s*,\s*(?:\{[\s\S]*?(?:params|body)\s*:\s*)?\{([^}]+)\}/gi;
  while ((match = methodCallRegex.exec(jsContent)) !== null) {
    const methodStr = match[1].toUpperCase() as HttpMethod;
    const rawUrl = match[2];
    const objectString = match[3];
    const parsed = parseJsUrlString(rawUrl);
    if (!parsed) continue;

    const bodyKeys = extractObjectKeys(objectString);
    const combinedParams = [...new Set([...parsed.parameters, ...bodyKeys])];

    const normalizedPath = (!parsed.path.startsWith('/api/') && !parsed.path.startsWith('/v1/') && !parsed.path.startsWith('/v2/'))
      ? `/api${parsed.path.startsWith('/') ? '' : '/'}${parsed.path}`
      : parsed.path;

    const candidatePaths = [normalizedPath];

    for (const cPath of candidatePaths) {
      const fullUrlPath = combinedParams.length > 0
        ? `${cPath}?${combinedParams.map((p) => `${p}=`).join('&')}`
        : cPath;
      const existingIndex = endpoints.findIndex((e) => e.path.split('?')[0] === cPath);

      if (existingIndex >= 0) {
        const existing = endpoints[existingIndex];
        const mergedParams = [...new Set([...existing.parameters, ...combinedParams])];
        endpoints[existingIndex] = {
          path: existing.path.includes('?') ? existing.path : fullUrlPath,
          method: methodStr,
          parameters: mergedParams,
        };
      } else {
        seen.add(`${methodStr} ${cPath}`);
        endpoints.push({
          path: fullUrlPath,
          method: methodStr,
          parameters: combinedParams,
        });
      }
    }
  }

  return endpoints;
}

/** Parse path string and extract query parameter names. */
function parseJsUrlString(rawUrl: string): { path: string; parameters: string[] } | null {
  if (!rawUrl || rawUrl.trim().length === 0) return null;
  const clean = rawUrl.trim();

  const queryIndex = clean.indexOf('?');
  if (queryIndex === -1) {
    return { path: clean, parameters: [] };
  }

  const path = clean.slice(0, queryIndex);
  const queryString = clean.slice(queryIndex + 1);

  const parameters: string[] = [];
  const paramPairs = queryString.split('&');
  for (const pair of paramPairs) {
    const key = pair.split('=')[0]?.replace(/[^a-zA-Z0-9_-]/g, '');
    if (key && key.length > 0) {
      parameters.push(key);
    }
  }

  return { path, parameters };
}

/** Extract key names from JS object literal strings like "{ author, body: b, q: 1 }". */
function extractObjectKeys(objectLiteral: string): string[] {
  const keys: string[] = [];
  const tokens = objectLiteral.split(',');
  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(':');
    const keyCandidate = parts[0].trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (keyCandidate && keyCandidate.length > 0 && !/^(true|false|null|undefined|function|var|const|let)$/.test(keyCandidate)) {
      keys.push(keyCandidate);
    }
  }
  return keys;
}
