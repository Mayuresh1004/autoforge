import { describe, expect, it } from 'vitest';
import { ALLOWED_KEYS, buildRuntimeContainer } from './runtime-env-builder';

describe('buildRuntimeContainer', () => {
  it('produces an explicit allowlisted env with the port set', () => {
    const env = buildRuntimeContainer({ port: 8000 });
    expect(env.PORT).toBe('8000');
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.NODE_ENV).toBe('production');
    for (const key of Object.keys(env)) {
      expect(ALLOWED_KEYS).toContain(key);
    }
  });

  it('NEVER passes host process.env through', () => {
    process.env.PATH = '/usr/bin:/bin'; // host value
    process.env.AWS_SECRET_ACCESS_KEY = 'super-secret'; // a secret that must not leak
    process.env.PORT = '9999'; // host port must not override the detected one
    const env = buildRuntimeContainer({ port: 8080 });
    expect(env.PORT).toBe('8080');
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(Object.values(env)).not.toContain('super-secret');
  });

  it('drops variables a caller tries to smuggle in that are not allowlisted', () => {
    const env = buildRuntimeContainer({
      port: 3000,
      extra: { SURPRISE: 'x', HOME: '/data', PORT: '1234' },
    });
    expect(env.SURPRISE).toBeUndefined();
    expect(env.HOME).toBe('/data'); // allowlisted key, explicit value
    expect(env.PORT).toBe('1234'); // explicit override wins for allowlisted key
  });

  it('respects a custom allowlist', () => {
    const env = buildRuntimeContainer({
      port: 3000,
      allowlist: new Set(['PORT']),
    });
    expect(Object.keys(env)).toEqual(['PORT']);
  });
});