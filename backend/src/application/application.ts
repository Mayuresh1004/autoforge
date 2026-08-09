/**
 * Bootstrap composition root — the application's single wiring point.
 * Route modules share this ONE infrastructure: one SandboxManager, one
 * runtime lifecycle service, one sniper/engineer/critic stack, one Prisma
 * client. No other module constructs its own SandboxManager.
 */

import { prisma } from '../config/database';
import { createApplicationInfrastructure } from './application-root';

export const applicationInfrastructure = createApplicationInfrastructure({ db: prisma });