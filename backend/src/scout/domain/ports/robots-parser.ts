export interface RobotsDirectives {
  readonly userAgents: readonly string[];
  readonly allowed: readonly string[];
  readonly disallowed: readonly string[];
  readonly sitemaps: readonly string[];
}

export const EMPTY_ROBOTS: RobotsDirectives = {
  userAgents: [],
  allowed: [],
  disallowed: [],
  sitemaps: [],
};

/** Parses a robots.txt body into directives (pure text, no network). */
export interface RobotsParser {
  parse(raw: string): RobotsDirectives;
}