import { describe, it, expect } from 'vitest';
import { mapSeverity } from './severity-mapper';

describe('mapSeverity', () => {
  it('maps common tool severities onto the canonical ladder', () => {
    expect(mapSeverity('critical')).toBe('CRITICAL');
    expect(mapSeverity('HIGH')).toBe('HIGH');
    expect(mapSeverity('moderate')).toBe('MEDIUM');
    expect(mapSeverity('low')).toBe('LOW');
    expect(mapSeverity('INFO')).toBe('INFO');
    expect(mapSeverity('urgent')).toBe('CRITICAL');
    expect(mapSeverity('warning')).toBe('MEDIUM');
    expect(mapSeverity('error')).toBe('HIGH');
  });

  it('falls back to INFO for unknown values instead of guessing', () => {
    expect(mapSeverity('wtf-level')).toBe('INFO');
    expect(mapSeverity('')).toBe('INFO');
    expect(mapSeverity('   ')).toBe('INFO');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(mapSeverity('  Critical ')).toBe('CRITICAL');
    expect(mapSeverity('Moderate')).toBe('MEDIUM');
  });
});