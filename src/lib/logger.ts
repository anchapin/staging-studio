import pino from 'pino';

/**
 * Structured logger for the application.
 * Uses pino for low-overhead, JSON-structured logging.
 * LOG_LEVEL defaults to 'info' when not set.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});
