const pino = require('pino');

const logger = pino(
  process.env.NODE_ENV === 'production'
    ? { level: process.env.LOG_LEVEL || 'info' }
    : {
        level: process.env.LOG_LEVEL || 'debug',
        transport: { target: 'pino-pretty', options: { colorize: true } }
      }
);

module.exports = logger;
