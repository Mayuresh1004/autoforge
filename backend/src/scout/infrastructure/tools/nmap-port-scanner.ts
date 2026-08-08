import type { OpenPort } from '../../domain/models/attack-surface';
import type { PortScanner, PortScanOptions } from '../../domain/ports/port-scanner';
import type { ScoutToolRuntime } from '../../domain/ports/scout-tool-runtime';

/**
 * Port scanner over the nmap adapter. Runs `nmap` as an argv-only command
 * through the ScoutToolRuntime (sandbox-bound in production) and parses
 * grepable (`-oG`) output. When nmap is unavailable the scan degrades to an
 * empty result — recon continues.
 */
export class NmapPortScanner implements PortScanner {
  constructor(private readonly runtime: ScoutToolRuntime) {}

  async scan(host: string, options: PortScanOptions): Promise<readonly OpenPort[]> {
    const availability = await this.runtime.toolAvailable('nmap');
    if (!availability.available) {
      return [];
    }

    const argv = [
      'nmap',
      '-Pn',
      '-sT',
      '--host-timeout',
      `${Math.floor(options.timeoutMs / 1000)}s`,
      '-oG',
      '-',
      host,
    ];
    const result = await this.runtime.exec({
      argv,
      timeoutMs: options.timeoutMs + 5000,
      network: 'egress',
    });
    if (!result.ok) return [];
    return parseNmapGrepable(result.stdout);
  }
}

/** Parse `-oG` output: `Host: 1.2.3.4 (name) Ports: 22/open/tcp//ssh///...` */
export function parseNmapGrepable(output: string): readonly OpenPort[] {
  const ports: OpenPort[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('Ports:')) continue;
    const match = /Ports:\s*(.+)$/.exec(line);
    if (!match) continue;
    for (const entry of match[1].split(/,\s*/)) {
      const parts = entry.split('/');
      if (parts.length < 3) continue;
      const [portStr, state, protocol] = parts;
      if (state !== 'open') continue;
      const port = Number.parseInt(portStr, 10);
      if (Number.isNaN(port)) continue;
      const service = parts[4] || null;
      ports.push({ port, protocol: protocol || 'tcp', state: 'open', service });
    }
  }
  return ports;
}