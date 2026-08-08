import type { OpenPort } from '../models/attack-surface';

export interface PortScanOptions {
  readonly timeoutMs: number;
  readonly scope: 'top-1000' | 'all';
}

/** Enumerates open ports. Adapter wraps a tool (nmap) and degrades to empty
 * when the binary is unavailable — never a fatal failure. */
export interface PortScanner {
  scan(host: string, options: PortScanOptions): Promise<readonly OpenPort[]>;
}