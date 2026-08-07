import { describe, it, expect } from 'vitest';
import { buildContainerArgs, mapPathToContainer } from './container-sandbox';

describe('buildContainerArgs (container hardening profile)', () => {
  it('builds a hardened, egress-blocked run command by default', () => {
    const args = buildContainerArgs({
      engine: 'docker',
      image: 'amass-agent:latest',
      workspaceHostPath: '/tmp/ws',
      mountPath: '/workspace',
      argv: ['git', 'clone', '--depth', '1', 'https://x/repo.git', '.'],
      network: 'none',
    });

    const joined = args.join(' ');
    expect(joined.startsWith('run ')).toBe(true);
    expect(joined).toContain('--network none');
    expect(joined).toContain('--read-only');
    expect(joined).toContain('--cap-drop ALL');
    expect(joined).toContain('--security-opt no-new-privileges:true');
    expect(joined).toContain(`--volume /tmp/ws:/workspace`);
    expect(joined).toContain('--workdir /workspace');
    expect(args.slice(-8)).toEqual([
      '/workspace',
      'amass-agent:latest',
      'git',
      'clone',
      '--depth',
      '1',
      'https://x/repo.git',
      '.',
    ]);
    expect(joined).not.toContain('--network bridge');
  });

  it('enables bridge network only when explicitly requested', () => {
    const args = buildContainerArgs({
      engine: 'docker',
      image: 'i',
      workspaceHostPath: '/w',
      mountPath: '/workspace',
      argv: ['npm', 'audit'],
      network: 'net',
    });
    expect(args.join(' ')).toContain('--network bridge');
  });

  it('adds gVisor runtime, uid, resource limits and env when configured', () => {
    const args = buildContainerArgs({
      engine: 'docker',
      image: 'i',
      workspaceHostPath: '/w',
      mountPath: '/workspace',
      argv: ['true'],
      network: 'none',
      runtime: 'runsc',
      uid: 10001,
      memory: '256m',
      cpus: 2,
      env: { GIT_TERMINAL_PROMPT: '0' },
    });
    const joined = args.join(' ');
    expect(joined).toContain('--runtime runsc');
    expect(joined).toContain('--user 10001');
    expect(joined).toContain('--memory 256m');
    expect(joined).toContain('--cpus 2');
    expect(joined).toContain('--env GIT_TERMINAL_PROMPT=0');
  });
});

describe('mapPathToContainer (host ↔ container paths)', () => {
  it('maps paths under the workspace root into the mount', () => {
    expect(mapPathToContainer('/tmp/ws/repo/src/a.ts', '/tmp/ws', '/workspace')).toBe(
      '/workspace/repo/src/a.ts'
    );
    expect(mapPathToContainer('/tmp/ws', '/tmp/ws', '/workspace')).toBe('/workspace');
  });

  it('passes through paths outside the workspace unchanged', () => {
    expect(mapPathToContainer('/etc/hosts', '/tmp/ws', '/workspace')).toBe('/etc/hosts');
  });
});