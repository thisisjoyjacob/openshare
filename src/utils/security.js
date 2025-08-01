const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function generateUniqueId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateSecureSessionId() {
  return uuidv4();
}

function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashString(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

function sanitizePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Invalid path input');
  }
  
  // Decode URL encoding first
  let decoded;
  try {
    decoded = decodeURIComponent(inputPath);
  } catch {
    throw new Error('Invalid URL encoding in path');
  }
  
  // Remove null bytes
  if (decoded.includes('\0')) {
    throw new Error('Null bytes not allowed in path');
  }
  
  // Get basename to prevent directory traversal
  const basename = path.basename(decoded);
  
  // Additional security checks
  if (basename.includes('..') || basename.includes('/') || basename.includes('\\')) {
    throw new Error('Invalid characters in filename');
  }
  
  return basename;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.trim().split('=');
    if (parts.length === 2) {
      const name = parts[0].trim();
      const value = parts[1].trim();
      
      // Basic validation
      if (name && value && /^[a-zA-Z0-9_-]+$/.test(name)) {
        try {
          cookies[name] = decodeURIComponent(value);
        } catch {
          // Skip invalid cookies
        }
      }
    }
  });
  
  return cookies;
}

function escapeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'download';
  }
  
  // Remove or escape dangerous characters for Content-Disposition header
  return filename
    .replace(/["\\\r\n]/g, '') // Remove quotes, backslashes, newlines
    .replace(/[^\x20-\x7E]/g, '') // Remove non-ASCII characters
    .substring(0, 100); // Limit length
}

function createSecureHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; img-src 'self' data:; font-src 'self' https://cdnjs.cloudflare.com;"
  };
}

module.exports = {
  generateUniqueId,
  generateSecureSessionId,
  generateSecureToken,
  hashString,
  isValidUUID,
  sanitizePath,
  parseCookies,
  escapeFilename,
  createSecureHeaders
};