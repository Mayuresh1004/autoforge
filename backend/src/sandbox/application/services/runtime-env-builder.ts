/**
 * Runtime container environment builder — the ONLY place runtime env is
 * composed, and it is explicit by construction: values come from this module
 * (or the caller's validated request), never from `process.env`.
 * `ALLOWED_KEYS` is the allowlist: no host variable can ever leak into the
 * container, and un-allowlisted keys are dropped even if someone passes them.
 */

export const ALLOWED_KEYS: readonly string[] = [
  'HOST',
  'PORT',
  'NODE_ENV',
  'PYTHONDONTWRITEBYTECODE',
  'PYTHONUNBUFFERED',
  'PATH',
  'HOME',
  'LANG',
  'TZ',
  'PGHOST',
  // Sibling database on the sandbox's internal network (same pattern as
  // PGHOST): the app container reaches it over Docker DNS, never externally.
  'MONGODB_URI',
] as const;

export interface BuildEnv {
  readonly port: number;
  /** Override the allowed key set (defaults to ALLOWED_KEYS). */
  readonly allowlist?: ReadonlySet<string>;
  /** Explicit extra values — must be allowlisted to pass through. */
  readonly extra?: Readonly<Record<string, string>>;
}

/** Fixed values — never interpolated from the host. */
const DEFAULTS: Record<string, string> = {
  HOST: '0.0.0.0',
  NODE_ENV: 'production',
  PYTHONDONTWRITEBYTECODE: '1',
  PYTHONUNBUFFERED: '1',
  PATH: '/usr/local/bin:/usr/bin:/bin',
  HOME: '/tmp',
  LANG: 'C.UTF-8',
};

export function buildRuntimeContainer(env: BuildEnv): Readonly<Record<string, string>> {
  const allowed = env.allowlist ?? new Set(ALLOWED_KEYS);
  const seed: Record<string, string> = {
    ...DEFAULTS,
    PORT: String(env.port),
  };

  for (const [key, value] of Object.entries(env.extra ?? {})) {
    if (!allowed.has(key)) continue; // never pass un-allowlisted keys through
    seed[key] = value;
  }

  // Defensive final filter: nothing leaves unless it was allowlisted.
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(seed)) {
    if (allowed.has(key) && value !== undefined) result[key] = value;
  }
  return result;
}