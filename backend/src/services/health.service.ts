import { prisma } from '../config/database';
import { getRedisClient } from '../config/redis';
import { config, qdrantConfig } from '../config';
import { HealthCheckData, ServiceCheck } from '../types/api.types';

export class HealthService {
  private readonly startTime = Date.now();

  async check(): Promise<HealthCheckData> {
    const checks: Record<string, ServiceCheck> = {};

    checks.postgres = await this.checkPostgres();
    checks.redis = await this.checkRedis();
    checks.qdrant = await this.checkQdrant();

    const allUp = Object.values(checks).every((c) => c.status === 'up');
    const anyDown = Object.values(checks).some((c) => c.status === 'down');

    let status: HealthCheckData['status'] = 'healthy';
    if (anyDown) {
      status = allUp ? 'degraded' : 'unhealthy';
    }

    return {
      status,
      service: config.APP_NAME,
      version: config.APP_VERSION,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      checks,
    };
  }

  private async checkPostgres(): Promise<ServiceCheck> {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  private async checkRedis(): Promise<ServiceCheck> {
    const start = Date.now();
    try {
      const redis = getRedisClient();
      await redis.ping();
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  private async checkQdrant(): Promise<ServiceCheck> {
    const start = Date.now();
    try {
      const response = await fetch(`${qdrantConfig.url}/healthz`);
      if (!response.ok) {
        throw new Error(`Qdrant returned ${response.status}`);
      }
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}
