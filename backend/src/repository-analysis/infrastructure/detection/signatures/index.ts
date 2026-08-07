import type { TechnologySignal } from '../signal';
import { LANGUAGE_SIGNALS } from './languages';
import { RUNTIME_SIGNALS } from './runtimes';
import { FRAMEWORK_SIGNALS } from './frameworks';
import { PACKAGE_MANAGER_SIGNALS } from './package-managers';
import { BUILD_TOOL_SIGNALS } from './build-tools';
import { DATABASE_SIGNALS } from './databases';
import { CONTAINER_SIGNALS } from './container';
import { CI_CD_SIGNALS } from './ci-cd';
import { CLOUD_SIGNALS, CLOUD_API_SIGNALS } from './cloud';

/**
 * The complete, ordered signature set used by default.
 */
export const TECHNOLOGY_SIGNALS: readonly TechnologySignal[] = [
  ...LANGUAGE_SIGNALS,
  ...RUNTIME_SIGNALS,
  ...FRAMEWORK_SIGNALS,
  ...PACKAGE_MANAGER_SIGNALS,
  ...BUILD_TOOL_SIGNALS,
  ...DATABASE_SIGNALS,
  ...CONTAINER_SIGNALS,
  ...CI_CD_SIGNALS,
  ...CLOUD_SIGNALS,
  ...CLOUD_API_SIGNALS,
];