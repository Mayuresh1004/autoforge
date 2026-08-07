import Redis from 'ioredis';
import { redisConfig } from '../config';
import { logger } from './logger';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(redisConfig.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      keyPrefix: redisConfig.prefix,
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected');
    });

    redisClient.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });
  }

  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis disconnected');
  }
}

/**
 * Future Redis use cases:
 *
 * 1. Agent Memory - Store conversation context and intermediate agent state
 *    Keys: amass:agent:{agentType}:{scanId}:memory
 *
 * 2. Cache - Cache API responses, CVE lookups, scan results
 *    Keys: amass:cache:{resource}:{id}
 *
 * 3. Queue - Job queue for async agent execution via Bull/BullMQ
 *    Keys: amass:queue:{queueName}
 */

export const RedisKeys = {
  agentMemory: (agentType: string, scanId: string) =>
    `agent:${agentType}:${scanId}:memory`,
  cache: (resource: string, id: string) => `cache:${resource}:${id}`,
  queue: (queueName: string) => `queue:${queueName}`,
} as const;
