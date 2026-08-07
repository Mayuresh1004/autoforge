import type { TechnologySignal } from '../signal';

/**
 * Programming-language detection, primarily extension based. These signals
 * are high confidence: if a tree contains `.go` files it is Go.
 */
export const LANGUAGE_SIGNALS: readonly TechnologySignal[] = [
  { name: 'TypeScript', category: 'language', confidence: 1.0, extensions: ['ts', 'tsx'] },
  { name: 'JavaScript', category: 'language', confidence: 0.99, extensions: ['js', 'jsx', 'mjs', 'cjs'] },
  { name: 'Python', category: 'language', confidence: 1.0, extensions: ['py'] },
  { name: 'Go', category: 'language', confidence: 1.0, extensions: ['go'] },
  { name: 'Rust', category: 'language', confidence: 1.0, extensions: ['rs'] },
  { name: 'Java', category: 'language', confidence: 1.0, extensions: ['java'] },
  { name: 'Kotlin', category: 'language', confidence: 0.98, extensions: ['kt', 'kts'] },
  { name: 'PHP', category: 'language', confidence: 1.0, extensions: ['php'] },
  { name: 'Ruby', category: 'language', confidence: 1.0, extensions: ['rb'] },
  { name: 'C', category: 'language', confidence: 0.95, extensions: ['c'] },
  { name: 'C++', category: 'language', confidence: 0.95, extensions: ['cpp', 'cc', 'cxx', 'hpp'] },
  { name: 'C#', category: 'language', confidence: 0.98, extensions: ['cs'] },
  { name: 'Swift', category: 'language', confidence: 0.98, extensions: ['swift'] },
  { name: 'Dart', category: 'language', confidence: 0.98, extensions: ['dart'] },
  { name: 'Shell', category: 'language', confidence: 0.9, extensions: ['sh', 'bash'] },
  { name: 'Scala', category: 'language', confidence: 0.95, extensions: ['scala'] },
  { name: 'R', category: 'language', confidence: 0.95, extensions: ['r'] },
  { name: 'Lua', category: 'language', confidence: 0.95, extensions: ['lua'] },
  { name: 'Elixir', category: 'language', confidence: 0.95, extensions: ['ex', 'exs'] },
  { name: 'Haskell', category: 'language', confidence: 0.9, extensions: ['hs'] },
  { name: 'Clojure', category: 'language', confidence: 0.9, extensions: ['clj', 'cljs'] },
  { name: 'Objective-C', category: 'language', confidence: 0.8, extensions: ['m'] },
  { name: 'Perl', category: 'language', confidence: 0.9, extensions: ['pl'] },
];