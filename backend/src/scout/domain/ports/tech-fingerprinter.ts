import type { DetectedTechnology } from '../models/attack-surface';

export interface FingerprintSource {
  readonly url: string;
  readonly statusCode: number | null;
  readonly headers: Readonly<Record<string, string>>;
  /** Visible text (scripts stripped) of the page being fingerprinted. */
  readonly bodyText: string;
}

/** Fingerprints technologies from headers + page text. Adapter may wrap
 * Wappalyzer-style data; the default is a signature-based engine. */
export interface TechnologyFingerprinter {
  fingerprint(source: FingerprintSource): Promise<readonly DetectedTechnology[]>;
}