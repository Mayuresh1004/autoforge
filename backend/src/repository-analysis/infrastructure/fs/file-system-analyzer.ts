import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  DirectoryNode,
  FileInfo,
  FileSystemAnalysis,
  LargestEntry,
} from '../../domain/models/file-system';
import type {
  FileSystemAnalyzer,
  FileSystemAnalysisOptions,
} from '../../domain/ports/file-system-analyzer';
import { IgnoreRules } from './ignore-rules';
import { importantFileRegistry } from './important-files';

const NO_EXTENSION = '(none)';

/** Extensions treated as text for LOC estimation. */
const TEXT_EXTENSIONS = new Set([
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'rb',
  'php', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'swift', 'kt', 'kts', 'sh',
  'bash', 'zsh', 'yml', 'yaml', 'json', 'jsonc', 'md', 'markdown', 'html',
  'htm', 'css', 'scss', 'sass', 'less', 'sql', 'xml', 'toml', 'tf', 'gradle',
  'conf', 'ini', 'cfg', 'properties', 'vue', 'svelte', 'astro', 'dockerfile',
  'txt', 'csv', 'graphql', 'gql', 'proto', 'make', 'env',
]);

/** Extension-less files that are still text. */
const TEXT_NAMES = new Set([
  'Dockerfile', 'Makefile', 'Gemfile', 'Rakefile', 'Jenkinsfile', 'Procfile',
  'Vagrantfile', 'LICENSE', 'README', 'Dockerfile.dev', 'Dockerfile.prod',
]);

/** Skip LOC counting for files larger than this (assumed binary/generated). */
const MAX_TEXT_FILE_BYTES = 1024 * 1024;

interface WalkContext {
  fileCount: number;
  folderCount: number;
  linesOfCode: number;
  filesByExtension: Record<string, number>;
  files: FileInfo[];
  directories: Array<{ node: DirectoryNode }>;
  importantFiles: FileSystemAnalysis['importantFiles'];
}

function extensionOf(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) return NO_EXTENSION;
  return name.slice(dotIndex + 1).toLowerCase();
}

function isTextFile(name: string, extension: string): boolean {
  return TEXT_EXTENSIONS.has(extension) || TEXT_NAMES.has(name);
}

async function countLines(filePath: string, sizeBytes: number): Promise<number | null> {
  if (sizeBytes === 0) return 0;
  if (sizeBytes > MAX_TEXT_FILE_BYTES) return null;
  try {
    const content = await fs.readFile(filePath, 'utf8');
    let lines = 0;
    for (let i = 0; i < content.length; i += 1) {
      if (content.charCodeAt(i) === 10) lines += 1;
    }
    return lines;
  } catch {
    return null;
  }
}

function truncateTree(node: DirectoryNode, depth: number, maxDepth: number): DirectoryNode {
  if (depth >= maxDepth) {
    return {
      ...node,
      directories: [],
      files: [],
    };
  }
  return {
    ...node,
    directories: node.directories.map((child) => truncateTree(child, depth + 1, maxDepth)),
    files: node.files,
  };
}

/**
 * Single-pass file-system analyzer. Walks the working tree once, applying
 * ignore rules, and collects the tree, aggregates, and important-file
 * markers. Symlinks are never followed.
 */
export class DefaultFileSystemAnalyzer implements FileSystemAnalyzer {
  async analyze(
    rootPath: string,
    options: FileSystemAnalysisOptions = {}
  ): Promise<FileSystemAnalysis> {
    const rules = IgnoreRules.withDefaults(options.ignorePatterns ?? []);
    const topN = options.topN ?? 10;
    const maxTreeDepth = options.maxTreeDepth ?? 8;

    const context: WalkContext = {
      fileCount: 0,
      folderCount: 0,
      linesOfCode: 0,
      filesByExtension: {},
      files: [],
      directories: [],
      importantFiles: [],
    };

    const tree = await this.walk(rootPath, rootPath, '', 0, rules, context);

    context.files.sort((a, b) => b.sizeBytes - a.sizeBytes);
    context.directories.sort((a, b) => b.node.totalSizeBytes - a.node.totalSizeBytes);

    return {
      rootPath,
      tree: truncateTree(tree, 0, maxTreeDepth),
      files: context.files,
      fileCount: context.fileCount,
      folderCount: context.folderCount,
      totalSizeBytes: tree.totalSizeBytes,
      linesOfCode: context.linesOfCode,
      filesByExtension: context.filesByExtension,
      largestFiles: context.files.slice(0, topN),
      largestDirectories: context.directories.slice(0, topN).map(
        (entry): LargestEntry => ({
          relativePath: entry.node.relativePath,
          sizeBytes: entry.node.totalSizeBytes,
        })
      ),
      importantFiles: context.importantFiles,
    };
  }

  private async walk(
    rootPath: string,
    currentPath: string,
    relativePath: string,
    depth: number,
    rules: IgnoreRules,
    context: WalkContext
  ): Promise<DirectoryNode> {
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch (err) {
      // Unreadable directory: report it as empty rather than failing the run.
      return this.emptyNode(currentPath, relativePath, depth);
    }

    const directories: DirectoryNode[] = [];
    const files: FileInfo[] = [];
    let totalSize = 0;

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const childPath = path.join(currentPath, entry.name);
      const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (rules.isIgnored(childRelative, entry.isDirectory())) continue;

      if (entry.isDirectory()) {
        context.folderCount += 1;
        const child = await this.walk(
          rootPath,
          childPath,
          childRelative,
          depth + 1,
          rules,
          context
        );
        totalSize += child.totalSizeBytes;
        directories.push(child);
        continue;
      }

      if (!entry.isFile()) continue;

      let stat;
      try {
        stat = await fs.stat(childPath);
      } catch {
        continue;
      }

      const extension = extensionOf(entry.name);
      const linesOfCode = isTextFile(entry.name, extension)
        ? await countLines(childPath, stat.size)
        : null;

      const file: FileInfo = {
        name: entry.name,
        relativePath: childRelative,
        absolutePath: childPath,
        extension,
        sizeBytes: stat.size,
        linesOfCode,
      };

      totalSize += stat.size;
      context.fileCount += 1;
      if (linesOfCode !== null) context.linesOfCode += linesOfCode;
      context.filesByExtension[extension] = (context.filesByExtension[extension] ?? 0) + 1;
      context.files.push(file);
      files.push(file);

      const important = importantFileRegistry.lookupByName(entry.name);
      if (important) {
        context.importantFiles.push({
          name: important.name,
          relativePath: childRelative,
          category: important.category,
        });
      }
    }

    const prefixImportant = importantFileRegistry.lookupByPrefix(relativePath);
    if (prefixImportant && relativePath !== '') {
      context.importantFiles.push({
        name: prefixImportant.name,
        relativePath,
        category: prefixImportant.category,
      });
    }

    const node: DirectoryNode = {
      name: depth === 0 ? rootPath : path.basename(currentPath),
      relativePath,
      absolutePath: currentPath,
      directories,
      files,
      totalSizeBytes: totalSize,
    };

    if (relativePath !== '') {
      context.directories.push({ node });
    }

    return node;
  }

  private emptyNode(absolutePath: string, relativePath: string, depth: number): DirectoryNode {
    return {
      name: depth === 0 ? absolutePath : path.basename(absolutePath),
      relativePath,
      absolutePath,
      directories: [],
      files: [],
      totalSizeBytes: 0,
    };
  }
}