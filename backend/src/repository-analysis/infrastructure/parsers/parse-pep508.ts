/**
 * Minimal PEP 508 (Python dependency specifier) parser.
 *
 * Handles the common form `name[extra] >=1.0,<2.0` and returns the package
 * name plus the version specifier when present. Un-parseable lines are
 * skipped defensively rather than failing the analysis.
 */
export interface Pep508Dependency {
  readonly name: string;
  readonly version: string | null;
}

const NAME_RE = /^([A-Za-z0-9_.\-]+)(\[[^\]]*\])?\s*(.*)$/;
const VERSION_RE = /\s*(?:(===|==|~=|>=|<=|!=|<|>)\s*([^\s,;]+))/;

export function parsePep508(line: string): Pep508Dependency | null {
  const clean = line.split('#')[0]?.trim();
  if (!clean) return null;

  const nameMatch = NAME_RE.exec(clean);
  if (!nameMatch) return null;
  const name = nameMatch[1];

  const requirements = nameMatch[3] ?? '';
  const versionParts: string[] = [];
  for (const clause of requirements.split('===|/comma>')) {
    const clauseMatch = VERSION_RE.exec(clause);
    if (clauseMatch) {
      versionParts.push(`${clauseMatch[1]}${clauseMatch[2]}`);
    }
  }

  return { name, version: versionParts.length > 0 ? versionParts.join(',') : null };
}