/**
 * src/index.js
 * Application entry point.
 * env.js MUST be imported first — it validates all env vars before anything else runs.
 */

// 1. Validate environment before anything else loads
require('dotenv').config();
require('./config/env');

const app = require('./app');
const { connectDB, pool } = require('./db');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // 2. Verify DB connection before accepting traffic
  await connectDB();

  const server = app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`, {
      env: process.env.NODE_ENV,
      pid: process.pid,
    });
  });

  // 3. Graceful shutdown — drain in-flight requests before dying
  const shutdown = async (signal) => {
    logger.warn(`${signal} received — starting graceful shutdown`);

    server.close(async () => {
      try {
        await pool.end();
        logger.info('DB pool drained. Exiting cleanly.');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown', { error: err.message });
        process.exit(1);
      }
    });

    // Force exit if graceful shutdown takes > 10s
    setTimeout(() => {
      logger.error('Graceful shutdown timeout — forcing exit');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM')); // Render sends SIGTERM on redeploy
  process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C in dev

  // 4. Global safety nets — log and die cleanly
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Promise Rejection', { reason: String(reason) });
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
};

startServer();
