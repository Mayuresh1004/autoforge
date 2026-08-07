import 'dotenv/config';
import { createApp } from './app';
import { config } from './config';
import { logger } from './config/logger';
import { disconnectDatabase } from './config/database';
import { disconnectRedis } from './config/redis';

const app = createApp();

const server = app.listen(config.BACKEND_PORT, config.BACKEND_HOST, () => {
  logger.info(
    {
      host: config.BACKEND_HOST,
      port: config.BACKEND_PORT,
      env: config.NODE_ENV,
    },
    `${config.APP_NAME} Backend API started`
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received');

  server.close(async () => {
    logger.info('HTTP server closed');
    await disconnectRedis();
    await disconnectDatabase();
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  process.exit(1);
});
