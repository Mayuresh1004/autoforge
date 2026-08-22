/**
 * SourceResolver — dynamic vulnerability source code file resolution service (application layer).
 *
 * Resolves the target repository source file for a confirmed vulnerability using:
 *  1. Direct file path if finding.filePath is present on the vulnerability record.
 *  2. Route, HTTP method, parameter, and query-sink search across workspace candidate files
 *     for dynamic endpoints (e.g. /api/products/search?q=).
 *
 * Unambiguous scoring guarantees that ambiguous or low-confidence matches return null,
 * triggering the safe REJECTED outcome without fabricating source file paths.
 */

import type { ConfirmedVulnerabilityFinding } from '../../domain/ports/confirmed-finding-repository';
import type { EngineerSourceReader } from '../../domain/ports/source-reader';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import { isSupportedCodeFile, normalizeRepoPath } from '../../domain/models/repo-path';

export type ResolutionMethod = 'DIRECT_FILE' | 'ENDPOINT_SEARCH' | 'STATIC_CORRELATION';

export interface SourceResolutionResult {
  readonly filePath: string;
  readonly resolutionMethod: ResolutionMethod;
  readonly confidence: number;
  readonly candidateCount: number;
  readonly evidenceSummary: string;
}

export interface CandidateScore {
  readonly filePath: string;
  readonly score: number;
  readonly matches: readonly string[];
}

export class SourceResolver {
  async resolve(
    finding: ConfirmedVulnerabilityFinding,
    context: RuntimeSandboxContext | null,
    sourceReader: EngineerSourceReader | null,
    candidateFiles?: readonly string[],
    fileContents?: Readonly<Record<string, string>>,
    emit?: (event: import('../../../observability/domain/ports/event-bus').AmassEventInput) => void,
  ): Promise<SourceResolutionResult | null> {
    // 1. Direct file path on finding
    if (finding.filePath && finding.filePath.trim().length > 0) {
      const norm = normalizeRepoPath(finding.filePath);
      if (norm && isSupportedCodeFile(norm)) {
        const res: SourceResolutionResult = {
          filePath: norm,
          resolutionMethod: 'DIRECT_FILE',
          confidence: 1.0,
          candidateCount: 1,
          evidenceSummary: `Direct finding filePath: ${norm}`,
        };
        emit?.({
          scanId: finding.scanId,
          eventType: 'ENGINEER_SOURCE_RESOLVED',
          agentType: 'ENGINEER',
          phase: 'remediation',
          status: 'SUCCEEDED',
          message: `resolved source file directly from finding: ${norm}`,
          metadata: {
            selectedFilePath: norm,
            resolutionMethod: 'DIRECT_FILE',
            confidence: 1.0,
            candidateCount: 1,
            evidenceSummary: res.evidenceSummary,
          },
        });
        return res;
      }
    }

    // 2. Dynamic Endpoint Search
    const endpoint = finding.endpoint;
    const cleanPath = endpoint ? parseEndpointPath(endpoint) : null;
    const method = (finding.method ?? 'GET').toUpperCase();
    const parameter = finding.parameter;

    emit?.({
      scanId: finding.scanId,
      eventType: 'ENGINEER_SOURCE_RESOLUTION_STARTED',
      agentType: 'ENGINEER',
      phase: 'remediation',
      status: 'STARTED',
      message: `resolving repository source file for ${method} ${cleanPath ?? endpoint ?? 'unknown'}`,
      metadata: {
        endpoint: cleanPath ?? endpoint ?? undefined,
        method,
        parameter: parameter ?? undefined,
        vulnerabilityId: finding.vulnerabilityId,
      },
    });

    if (!endpoint || !cleanPath) {
      emit?.({
        scanId: finding.scanId,
        eventType: 'ENGINEER_SOURCE_RESOLUTION_FAILED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        status: 'FAILED',
        message: 'no endpoint path available on finding for dynamic resolution',
        metadata: {
          endpoint: endpoint ?? undefined,
          method,
          parameter: parameter ?? undefined,
          candidateCount: 0,
          failureReason: 'no endpoint path available on finding for dynamic resolution',
        },
      });
      return null;
    }

    // Gather candidate contents to search
    const filesToSearch: Record<string, string> = {};

    if (fileContents) {
      for (const [k, v] of Object.entries(fileContents)) {
        const norm = normalizeRepoPath(k);
        if (norm && isSupportedCodeFile(norm)) {
          filesToSearch[norm] = v;
        }
      }
    } else if (context && sourceReader) {
      const pathsToQuery = candidateFiles ?? (sourceReader.listAllFiles ? await sourceReader.listAllFiles(context) : []);
      for (const path of pathsToQuery) {
        const norm = normalizeRepoPath(path);
        if (norm && isSupportedCodeFile(norm)) {
          try {
            const whole = await sourceReader.readWholeFile(context, { path: norm, maxBytes: 500_000 });
            filesToSearch[norm] = whole.content;
          } catch {
            // ignore unreadable files during search
          }
        }
      }
    }

    if (Object.keys(filesToSearch).length === 0) {
      emit?.({
        scanId: finding.scanId,
        eventType: 'ENGINEER_SOURCE_RESOLUTION_FAILED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        status: 'FAILED',
        message: 'no candidate source code files found in repository to search',
        metadata: {
          endpoint: cleanPath,
          method,
          parameter: parameter ?? undefined,
          candidateCount: 0,
          failureReason: 'no candidate source code files found in repository to search',
        },
      });
      return null;
    }

    const scored: CandidateScore[] = [];

    for (const [filePath, content] of Object.entries(filesToSearch)) {
      const scoreResult = scoreCandidateFile(filePath, content, cleanPath, method, parameter, finding);
      if (scoreResult.score >= 40) {
        scored.push(scoreResult);
      }
    }

    if (scored.length === 0) {
      emit?.({
        scanId: finding.scanId,
        eventType: 'ENGINEER_SOURCE_RESOLUTION_FAILED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        status: 'FAILED',
        message: `no repository file matched route ${cleanPath} (method: ${method}, parameter: ${parameter ?? 'none'})`,
        metadata: {
          endpoint: cleanPath,
          method,
          parameter: parameter ?? undefined,
          candidateCount: 0,
          failureReason: `no repository file matched route ${cleanPath} (method: ${method}, parameter: ${parameter ?? 'none'})`,
        },
      });
      return null;
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    const top = scored[0];
    const second = scored[1];

    emit?.({
      scanId: finding.scanId,
      eventType: 'ENGINEER_SOURCE_CANDIDATE',
      agentType: 'ENGINEER',
      phase: 'remediation',
      status: 'SUCCEEDED',
      message: `evaluated top candidate ${top.filePath} (score: ${top.score})`,
      metadata: {
        filePath: top.filePath,
        score: top.score,
        matches: top.matches.join(', '),
        candidateCount: scored.length,
      },
    });

    if (top.score < 50) {
      emit?.({
        scanId: finding.scanId,
        eventType: 'ENGINEER_SOURCE_RESOLUTION_FAILED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        status: 'FAILED',
        message: `top candidate score ${top.score} below required confidence threshold 50`,
        metadata: {
          endpoint: cleanPath,
          method,
          parameter: parameter ?? undefined,
          candidateCount: scored.length,
          failureReason: `top candidate score ${top.score} below required confidence threshold 50`,
        },
      });
      return null;
    }

    // If second candidate is within 10 points of top score, it's ambiguous
    if (second && top.score <= second.score + 10) {
      emit?.({
        scanId: finding.scanId,
        eventType: 'ENGINEER_SOURCE_RESOLUTION_FAILED',
        agentType: 'ENGINEER',
        phase: 'remediation',
        status: 'FAILED',
        message: `ambiguous match between top candidates (${top.filePath} vs ${second.filePath})`,
        metadata: {
          endpoint: cleanPath,
          method,
          parameter: parameter ?? undefined,
          candidateCount: scored.length,
          failureReason: `ambiguous match between top candidates (${top.filePath} vs ${second.filePath})`,
        },
      });
      return null;
    }

    const confidence = Math.min(1.0, top.score / 100);
    const summary = `Matched route/parameter in ${top.filePath}: ${top.matches.join(', ')}`;

    emit?.({
      scanId: finding.scanId,
      eventType: 'ENGINEER_SOURCE_RESOLVED',
      agentType: 'ENGINEER',
      phase: 'remediation',
      status: 'SUCCEEDED',
      message: `dynamically resolved source file: ${top.filePath} (${summary})`,
      metadata: {
        selectedFilePath: top.filePath,
        resolutionMethod: 'ENDPOINT_SEARCH',
        confidence,
        candidateCount: scored.length,
        evidenceSummary: summary,
      },
    });

    return {
      filePath: top.filePath,
      resolutionMethod: 'ENDPOINT_SEARCH',
      confidence,
      candidateCount: scored.length,
      evidenceSummary: summary,
    };
  }
}

export function parseEndpointPath(rawEndpoint: string): string | null {
  try {
    let urlString = rawEndpoint.trim();
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      urlString = `http://localhost${urlString.startsWith('/') ? '' : '/'}${urlString}`;
    }
    const parsed = new URL(urlString);
    const path = parsed.pathname;
    return path && path !== '/' ? path : null;
  } catch {
    const withoutQuery = rawEndpoint.split('?')[0].trim();
    const slash = withoutQuery.indexOf('/');
    if (slash !== -1) {
      return withoutQuery.slice(slash);
    }
    return null;
  }
}

export function scoreCandidateFile(
  filePath: string,
  content: string,
  endpointPath: string,
  method: string,
  parameter: string | null,
  finding: ConfirmedVulnerabilityFinding,
): CandidateScore {
  let score = 0;
  const matches: string[] = [];

  const lowerContent = content.toLowerCase();
  const lowerPath = endpointPath.toLowerCase();

  // Extract path segments (e.g. /api/products/search -> ["api", "products", "search"])
  const segments = lowerPath.split('/').filter(Boolean);

  // 1. Path Match
  let pathMatched = false;
  if (lowerContent.includes(lowerPath)) {
    score += 45;
    matches.push(`exact path match '${lowerPath}'`);
    pathMatched = true;
  } else if (segments.length > 0) {
    const lastSegment = segments[segments.length - 1];
    if (lowerContent.includes(`'/${lastSegment}'`) || lowerContent.includes(`"/${lastSegment}"`) || lowerContent.includes(`\`/${lastSegment}\``) || lowerContent.includes(`/${lastSegment}`)) {
      score += 35;
      matches.push(`segment match '/${lastSegment}'`);
      pathMatched = true;
    }
  }

  // File basename / path similarity
  const fileName = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (segments.some((seg) => fileName.includes(seg))) {
    score += 10;
    matches.push(`file name match '${fileName}'`);
  }

  // 2. HTTP Method Match
  const lowerMethod = method.toLowerCase();
  if (pathMatched && (lowerContent.includes(`.${lowerMethod}(`) || lowerContent.includes(`@${lowerMethod}`) || lowerContent.includes(`method: '${method}'`))) {
    score += 15;
    matches.push(`HTTP method '${method}'`);
  }

  // 3. Parameter Match
  if (parameter && parameter.trim().length > 0) {
    const p = parameter.trim();
    if (
      lowerContent.includes(`req.query.${p}`) ||
      lowerContent.includes(`req.body.${p}`) ||
      lowerContent.includes(`req.params.${p}`) ||
      lowerContent.includes(`['${p}']`) ||
      lowerContent.includes(`["${p}"]`) ||
      lowerContent.includes(`get('${p}')`) ||
      lowerContent.includes(`get("${p}")`) ||
      lowerContent.includes(`${p}:`) ||
      lowerContent.includes(`.${p}`)
    ) {
      score += 25;
      matches.push(`parameter match '${p}'`);
    }
  }

  // 4. Query Sink Match
  if (
    lowerContent.includes('select ') ||
    lowerContent.includes('where ') ||
    lowerContent.includes('db.query') ||
    lowerContent.includes('db.execute') ||
    lowerContent.includes('cursor.execute') ||
    lowerContent.includes('sequelize') ||
    lowerContent.includes('prisma') ||
    lowerContent.includes('knex')
  ) {
    score += 15;
    matches.push('database query sink');
  }

  return { filePath, score, matches };
}
