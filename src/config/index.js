const path = require('path');

// Helper function for safe integer parsing
function parseIntSafe(value, defaultValue, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < min || parsed > max) {
    console.warn(`Invalid value for ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

// Helper function for safe string parsing
function parseStringSafe(value, defaultValue, allowedValues = null) {
  if (!value) return defaultValue;
  if (allowedValues && !allowedValues.includes(value)) {
    console.warn(`Invalid value ${value}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return value;
}

const config = {
  // Server Configuration
  port: parseIntSafe(process.env.PORT, 4001, 1, 65535),
  host: parseStringSafe(process.env.HOST, '0.0.0.0'),
  nodeEnv: parseStringSafe(process.env.NODE_ENV, 'development', ['development', 'production', 'test']),
  
  // File Configuration
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'),
  maxFileSize: parseIntSafe(process.env.MAX_FILE_SIZE, 1024 * 1024 * 1024, 1024, 10 * 1024 * 1024 * 1024), // 1GB default, max 10GB
  fileExpiry: parseIntSafe(process.env.FILE_EXPIRY, 4 * 60 * 60 * 1000, 60 * 1000, 7 * 24 * 60 * 60 * 1000), // 4 hours default, max 7 days
  allowedMimeTypes: process.env.ALLOWED_MIME_TYPES ? 
    process.env.ALLOWED_MIME_TYPES.split(',').map(type => type.trim()).filter(Boolean) : null,
  
  // Security Configuration
  sessionSecret: process.env.SESSION_SECRET || 'openshare-default-secret-change-in-production',
  sessionMaxAge: parseIntSafe(process.env.SESSION_MAX_AGE, 7 * 24 * 60 * 60 * 1000, 60 * 60 * 1000, 30 * 24 * 60 * 60 * 1000), // 7 days default, max 30 days
  rateLimitWindow: parseIntSafe(process.env.RATE_LIMIT_WINDOW, 15 * 60 * 1000, 60 * 1000, 60 * 60 * 1000), // 15 minutes default, max 1 hour
  rateLimitMax: parseIntSafe(process.env.RATE_LIMIT_MAX, 10, 1, 1000), // 10 uploads default, max 1000
  
  // Cleanup Configuration
  cleanupInterval: parseIntSafe(process.env.CLEANUP_INTERVAL, 60 * 1000, 10 * 1000, 60 * 60 * 1000), // 1 minute default, max 1 hour
  sessionCleanupAge: parseIntSafe(process.env.SESSION_CLEANUP_AGE, 24 * 60 * 60 * 1000, 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000), // 24 hours default, max 7 days
  
  // Logging Configuration
  logLevel: parseStringSafe(process.env.LOG_LEVEL, 'info', ['error', 'warn', 'info', 'debug']),
  logFile: process.env.LOG_FILE || 'logs/openshare.log',
  
  // CORS Configuration
  corsOrigin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? 'https://your-domain.com' : '*'),
  
  // Health Check
  healthCheckPath: '/health',
  
  // Development
  isDevelopment: process.env.NODE_ENV === 'development',
  isProduction: process.env.NODE_ENV === 'production'
};

// Validation
if (config.isProduction && config.sessionSecret === 'openshare-default-secret-change-in-production') {
  console.error('ERROR: Please set SESSION_SECRET environment variable in production!');
  process.exit(1);
}

module.exports = config;