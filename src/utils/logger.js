const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Simple fallback logger to avoid circular dependency
const fallbackLogger = {
  info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ''),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta || ''),
  error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta || ''),
  debug: (msg, meta) => console.log(`[DEBUG] ${msg}`, meta || '')
};

let config;
try {
  config = require('../config');
} catch (error) {
  // Use fallback if config is not available
  console.warn('Config not available, using fallback logger');
  module.exports = fallbackLogger;
  return;
}

// Ensure logs directory exists (async to avoid blocking)
const logDir = path.dirname(config.logFile);
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (error) {
  console.warn('Failed to create log directory, using console only:', error);
}

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'openshare' },
  transports: [
    new winston.transports.File({ 
      filename: config.logFile,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5
    })
  ]
});

// Add console logging in development
if (config.isDevelopment) {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

module.exports = logger;