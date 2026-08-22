import { describe, it, expect } from 'vitest';
import { DefaultValidationStrategyRegistry } from './validation-strategy-registry';
import { SqlInjectionValidationStrategy } from './strategies/sql-injection-validation-strategy';
import { XssValidationStrategy } from './strategies/xss-validation-strategy';
import { AccessControlValidationStrategy } from './strategies/access-control-validation-strategy';
import { SecurityMisconfigurationValidationStrategy } from './strategies/security-misconfiguration-validation-strategy';

describe('ValidationStrategyRegistry', () => {
  const registry = new DefaultValidationStrategyRegistry([
    new SqlInjectionValidationStrategy(),
    new XssValidationStrategy(),
    new AccessControlValidationStrategy(),
    new SecurityMisconfigurationValidationStrategy(),
  ]);

  it('resolves SqlInjectionValidationStrategy for SQL_INJECTION', () => {
    const strategy = registry.resolve('SQL_INJECTION');
    expect(strategy).toBeDefined();
    expect(strategy?.name).toBe('SqlInjectionValidationStrategy');
  });

  it('resolves XssValidationStrategy for XSS', () => {
    const strategy = registry.resolve('XSS');
    expect(strategy).toBeDefined();
    expect(strategy?.name).toBe('XssValidationStrategy');
  });

  it('resolves AccessControlValidationStrategy for BROKEN_ACCESS_CONTROL, IDOR, and AUTH_BYPASS', () => {
    expect(registry.resolve('BROKEN_ACCESS_CONTROL')?.name).toBe('AccessControlValidationStrategy');
    expect(registry.resolve('IDOR')?.name).toBe('AccessControlValidationStrategy');
    expect(registry.resolve('AUTH_BYPASS')?.name).toBe('AccessControlValidationStrategy');
  });

  it('resolves SecurityMisconfigurationValidationStrategy for SECURITY_MISCONFIGURATION', () => {
    const strategy = registry.resolve('SECURITY_MISCONFIGURATION');
    expect(strategy).toBeDefined();
    expect(strategy?.name).toBe('SecurityMisconfigurationValidationStrategy');
  });

  it('returns null for unsupported vulnerability types', () => {
    expect(registry.resolve('UNKNOWN')).toBeNull();
    expect(registry.supports('UNKNOWN')).toBe(false);
  });
});
