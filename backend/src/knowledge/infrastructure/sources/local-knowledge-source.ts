import fs from 'node:fs';
import path from 'node:path';
import type {
  KnowledgeDocument,
  KnowledgeSeverity,
  KnowledgeSourceType,
} from '../../domain/models/knowledge-document';
import type {
  KnowledgeFetchOptions,
  KnowledgeFetchResult,
  KnowledgeSource,
} from '../../domain/ports/knowledge-source';

export interface LocalKnowledgeSourceOptions {
  readonly dirPath?: string;
}

export class LocalKnowledgeSource implements KnowledgeSource {
  private readonly dirPath: string;

  constructor(options: LocalKnowledgeSourceOptions = {}) {
    this.dirPath =
      options.dirPath ?? path.resolve(process.cwd(), 'data/knowledge');
  }

  getName(): string {
    return 'local-kb';
  }

  getType(): KnowledgeSourceType {
    return 'amass-kb';
  }

  async fetch(options: KnowledgeFetchOptions = {}): Promise<KnowledgeFetchResult> {
    const documents: KnowledgeDocument[] = [];
    let malformed = 0;

    if (!fs.existsSync(this.dirPath)) {
      return { documents: [], hasMore: false, malformed: 0 };
    }

    const files = walkMarkdownFiles(this.dirPath);
    for (const filePath of files) {
      try {
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseFrontmatter(rawContent);
        if (!parsed.frontmatter.id || !parsed.content) {
          malformed += 1;
          continue;
        }

        const fm = parsed.frontmatter;
        const cwe = fm.cwe || fm.externalId || 'UNKNOWN';
        const doc: KnowledgeDocument = {
          id: fm.id,
          sourceType: 'amass-kb',
          externalId: fm.externalId || cwe,
          title: extractTitle(fm.id, fm.externalId, parsed.content),
          content: parsed.content,
          vulnerabilityType: fm.vulnerabilityType || cwe,
          severity: (fm.severity as KnowledgeSeverity) || 'HIGH',
          language: fm.language && fm.language !== 'generic' ? fm.language : null,
          framework: fm.framework && fm.framework !== 'generic' ? fm.framework : null,
          sourceUrl: fm.sourceUrl || null,
          metadata: {
            cwes: [cwe],
            cvssScore: 8.0,
            cvssVector: null,
            publishedAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            references: fm.sourceUrl ? [fm.sourceUrl] : [],
            description: parsed.content,
          },
        };

        documents.push(doc);
      } catch {
        malformed += 1;
      }
    }

    const maxItems = options.maxItems ?? documents.length;
    const sliced = documents.slice(0, maxItems);
    return {
      documents: sliced,
      hasMore: documents.length > maxItems,
      malformed,
    };
  }
}

function walkMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results.push(...walkMarkdownFiles(fullPath));
    } else if (file.endsWith('.md')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

interface ParsedFrontmatter {
  frontmatter: Record<string, string>;
  content: string;
}

function parseFrontmatter(text: string): ParsedFrontmatter {
  const frontmatter: Record<string, string> = {};
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---')) {
    return { frontmatter, content: text.trim() };
  }

  const endIndex = normalized.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter, content: text.trim() };
  }

  const yamlBlock = normalized.slice(3, endIndex).trim();
  const content = normalized.slice(endIndex + 4).trim();

  for (const line of yamlBlock.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const key = line.slice(0, colonIndex).trim();
      const val = line.slice(colonIndex + 1).trim();
      frontmatter[key] = val;
    }
  }

  return { frontmatter, content };
}

function extractTitle(id: string, externalId: string | undefined, content: string): string {
  const firstHeader = content.split('\n').find((l) => l.startsWith('# '));
  if (firstHeader) {
    return `${externalId || id}: ${firstHeader.replace(/^#\s+/, '').trim()}`;
  }
  return `${externalId || id}: ${id}`;
}
