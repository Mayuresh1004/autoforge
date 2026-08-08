import { describe, expect, it } from 'vitest';
import type { SandboxManager } from '../../../sandbox/domain/ports/sandbox-manager';
import type { ExecRequest, ExecResult } from '../../../sandbox/domain/models/sandbox';
import type { RuntimeSandboxContext } from '../../../sandbox/domain/entities/runtime-sandbox';
import { EngineerSourceError } from '../../domain/errors/engineer.errors';
import { ManagerSourceReader } from './manager-source-reader';

/** Sandbox manager stub responding to the exact wc/cat protocol. */
class FakeSandbox {
  readonly executions: ExecRequest[] = [];
  private readonly files = new Map<string, string>();

  constructor(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) this.files.set(path, content);
  }

  async execute(_id: string, request: ExecRequest): Promise<ExecResult> {
    this.executions.push(request);
    const tool = request.argv[0];
    const path = request.argv[request.argv.length - 1];
    const content = this.files.get(path);
    if (content === undefined) {
      return { stdout: '', stderr: `${tool}: ${path}: No such file`, exitCode: 1, timedOut: false };
    }
    if (tool === 'wc') return { stdout: `${Buffer.byteLength(content, 'utf8')}\n`, stderr: '', exitCode: 0, timedOut: false };
    if (tool === 'cat') return { stdout: content, stderr: '', exitCode: 0, timedOut: false };
    throw new Error(`unexpected argv[0]=${tool}`);
  }
}

const asManager = (fake: FakeSandbox): SandboxManager => fake as unknown as SandboxManager;

const CONTEXT: RuntimeSandboxContext = {
  id: 'rt-1', scanId: 'scan-1', sandboxId: 'sandbox-1', targetUrl: 'http://127.0.0.1:1',
  internalHost: '10.0.0.5', internalPort: 3000, exposedPort: null,
};

const BOUNDS = { maxSourceBytes: 64_000, maxContextLines: 150 };

describe('manager-source-reader', () => {
  it('reads a bounded line window of a file', async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line${i + 1}`).join('\n');
    const result = await new ManagerSourceReader(asManager(new FakeSandbox({ 'src/app.py': lines })), BOUNDS)
      .read(CONTEXT, { path: 'src/app.py', startLine: 10, endLine: 12 });
    expect(result.lines).toEqual(['line10', 'line11', 'line12']);
    expect(result.offset).toBe(10);
    expect(result.truncated).toBe(false);
  });

  it('reads to EOF when no window is given and caps at maxContextLines', async () => {
    const content = Array.from({ length: 200 }, (_, i) => `l${i + 1}`).join('\n');
    const result = await new ManagerSourceReader(asManager(new FakeSandbox({ 'a.py': content })), BOUNDS)
      .read(CONTEXT, { path: 'a.py' });
    expect(result.lines.length).toBe(150);
    expect(result.truncated).toBe(true);
  });

  it('rejects absolute paths, traversal and drive letters', async () => {
    const reader = new ManagerSourceReader(asManager(new FakeSandbox({})), BOUNDS);
    for (const bad of ['/etc/passwd', '../secrets.txt', 'C:\\x.py', 'src/../outside.py']) {
      await expect(reader.read(CONTEXT, { path: bad })).rejects.toMatchObject({ code: 'SOURCE_INVALID_PATH' });
    }
    await expect(reader.read(CONTEXT, { path: '../src/app.py' })).rejects.toBeInstanceOf(EngineerSourceError);
  });

  it('rejects unsupported source types (lockfiles, binaries)', async () => {
    const reader = new ManagerSourceReader(asManager(new FakeSandbox({})), BOUNDS);
    for (const bad of ['package-lock.json', 'img/logo.png', 'lib/app.jar']) {
      await expect(reader.read(CONTEXT, { path: bad })).rejects.toMatchObject({ code: 'SOURCE_INVALID_PATH' });
    }
  });

  it('normalizes backslash paths to forward slashes before reading', async () => {
    const reader = new ManagerSourceReader(asManager(new FakeSandbox({ 'src/app.py': 'ok' })), BOUNDS);
    const result = await reader.read(CONTEXT, { path: 'src\\app.py' });
    expect(result.filePath).toBe('src/app.py');
    expect(result.lines).toEqual(['ok']);
  });

  it('rejects files over maxSourceBytes via the wc size probe', async () => {
    const fake = new FakeSandbox({ 'big.py': 'x'.repeat(100_000) });
    await expect(
      new ManagerSourceReader(asManager(fake), { maxSourceBytes: 1_000, maxContextLines: 5 }).read(CONTEXT, { path: 'big.py' }),
    ).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' });
    expect(fake.executions[0].argv[0]).toBe('wc');
  });

  it('issues only argv-list wc/cat calls with a hard timeout (no shell)', async () => {
    const fake = new FakeSandbox({ 'src/app.py': 'def x():\n    pass\n' });
    const result = await new ManagerSourceReader(asManager(fake), BOUNDS).read(CONTEXT, {
      path: 'src/app.py', startLine: 1, endLine: 1,
    });
    expect(result.lines).toEqual(['def x():']);
    for (const req of fake.executions) {
      expect(['wc', 'cat']).toContain(req.argv[0]);
      expect(req.argv).toContain('--');
      expect(req.timeoutMs).toBeGreaterThan(0);
      expect(req.network).toBeUndefined();
    }
  });

  it('surfaces missing files as SOURCE_UNAVAILABLE', async () => {
    const reader = new ManagerSourceReader(asManager(new FakeSandbox({})), BOUNDS);
    await expect(reader.read(CONTEXT, { path: 'missing.py' })).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
  });
});