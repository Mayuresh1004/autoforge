import { describe, expect, it } from 'vitest';
import { NmapPortScanner, parseNmapGrepable } from './nmap-port-scanner';
import type { ScoutToolRuntime } from '../../domain/ports/scout-tool-runtime';

describe('parseNmapGrepable', () => {
  it('parses open ports with service names', () => {
    const out = [
      '# Nmap 7.94 scan initiated',
      'Host: 127.0.0.1 (localhost) Ports: 22/open/tcp//ssh///, 80/open/tcp//http///, 443/filtered/tcp//https///',
      '# Nmap done',
    ].join('\n');
    const ports = parseNmapGrepable(out);
    expect(ports).toEqual([
      { port: 22, protocol: 'tcp', state: 'open', service: 'ssh' },
      { port: 80, protocol: 'tcp', state: 'open', service: 'http' },
    ]);
  });

  it('skips closed/filtered and malformed lines', () => {
    const out = [
      'Host: 127.0.0.1 (x) Ports: 8080/closed/tcp//http///, 9/filtered/tcp//tcpmux///',
    ].join('\n');
    expect(parseNmapGrepable(out)).toEqual([]);
  });
});

describe('NmapPortScanner', () => {
  it('degrades to empty when nmap is unavailable', async () => {
    const runtime: ScoutToolRuntime = {
      toolAvailable: async () => ({ available: false, version: null }),
      exec: async () => {
        throw new Error('should not run');
      },
      probe: async () => {
        throw new Error('unused');
      },
    };
    const scanner = new NmapPortScanner(runtime);
    expect(await scanner.scan('127.0.0.1', { timeoutMs: 1000, scope: 'top-1000' })).toEqual([]);
  });

  it('parses real nmap output through the runtime', async () => {
    const runtime: ScoutToolRuntime = {
      toolAvailable: async () => ({ available: true, version: '7.94' }),
      exec: async () => ({
        ok: true,
        exitCode: 0,
        stdout: 'Host: 127.0.0.1 (localhost) Ports: 3000/open/tcp//http///',
        stderr: '',
        timedOut: false,
        toolMissing: false,
      }),
      probe: async () => {
        throw new Error('unused');
      },
    };
    const scanner = new NmapPortScanner(runtime);
    const ports = await scanner.scan('127.0.0.1', { timeoutMs: 1000, scope: 'top-1000' });
    expect(ports).toEqual([{ port: 3000, protocol: 'tcp', state: 'open', service: 'http' }]);
  });

  it('returns empty when the command fails', async () => {
    const runtime: ScoutToolRuntime = {
      toolAvailable: async () => ({ available: true, version: '7.94' }),
      exec: async () => ({
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: 'connection refused',
        timedOut: false,
        toolMissing: false,
      }),
      probe: async () => {
        throw new Error('unused');
      },
    };
    const scanner = new NmapPortScanner(runtime);
    expect(await scanner.scan('127.0.0.1', { timeoutMs: 1000, scope: 'top-1000' })).toEqual([]);
  });
});