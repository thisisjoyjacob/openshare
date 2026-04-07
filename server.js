// Enhanced file sharing server with user sessions and additional features
const http = require('http') ;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB
const FILE_EXPIRY = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const METADATA_PATH = path.join(__dirname, 'uploads', '.metadata.json');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// In-memory file database with user sessions
const fileDatabase = {};
const userSessions = {};

// MIME types
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg'
};

// Helper functions
function generateUniqueId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function sendResponse(res, statusCode, data, contentType = 'application/json') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(typeof data === 'object' ? JSON.stringify(data) : data);
}

function sanitizeFilename(name) {
  // Strip HTML tags
  name = name.replace(/<[^>]*>/g, '');
  // Remove null bytes, control chars, path separators
  name = name.replace(/[\x00-\x1f\x7f/\\]/g, '');
  // Remove leading/trailing dots and spaces
  name = name.replace(/^[.\s]+|[.\s]+$/g, '');
  // Truncate to 255 chars
  name = name.substring(0, 255).trim();
  return name || 'unnamed_file';
}

function safeContentDisposition(filename) {
  // ASCII-safe version: replace non-printable, quotes, semicolons, non-ASCII
  const asciiSafe = filename.replace(/[\x00-\x1f"\\;]/g, '_')
    .replace(/[^\x20-\x7e]/g, '_');
  // RFC 5987 encoded version for UTF-8 support
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encoded}`;
}

// Metadata persistence with atomic writes
let saveTimeout = null;
function saveMetadata() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const tmpPath = METADATA_PATH + '.tmp';
    const data = JSON.stringify({ files: fileDatabase, sessions: userSessions }, null, 2);
    fs.promises.writeFile(tmpPath, data)
      .then(() => { fs.renameSync(tmpPath, METADATA_PATH); })
      .catch(err => { console.error('Failed to save metadata:', err); });
  }, 1000);
}

function loadMetadata() {
  try {
    if (fs.existsSync(METADATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'));
      Object.assign(fileDatabase, data.files || {});
      Object.assign(userSessions, data.sessions || {});
      console.log(`Loaded ${Object.keys(data.files || {}).length} files from metadata`);
    }
  } catch (err) {
    console.error('Failed to load metadata (starting fresh):', err.message);
  }
}

function cleanupOrphans() {
  const knownFiles = new Set(Object.values(fileDatabase).map(f => f.filename));
  try {
    const filesOnDisk = fs.readdirSync(UPLOAD_DIR);
    for (const file of filesOnDisk) {
      if (file === '.metadata.json' || file === '.metadata.json.tmp' || file.startsWith('.tmp_')) continue;
      if (!knownFiles.has(file)) {
        try {
          fs.unlinkSync(path.join(UPLOAD_DIR, file));
          console.log(`Orphan file ${file} deleted`);
        } catch (err) {
          console.error(`Failed to delete orphan ${file}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('Failed to scan for orphans:', err.message);
  }
}

// Rate limiting: max 10 uploads per hour per IP
const rateLimitMap = new Map();
function rateLimitCheck(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + 3600000 });
    return true;
  }
  entry.count++;
  if (entry.count > 10) return false;
  return true;
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
}

function getCookieString(sessionId) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  return `sessionId=${sessionId}; Path=/; Max-Age=${SESSION_TTL / 1000}; SameSite=Strict; HttpOnly${secure}`;
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        sendResponse(res, 404, { error: 'File not found' });
      } else {
        sendResponse(res, 500, { error: 'Internal server error' });
      }
      return;
    }

    const contentType = getContentType(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function getSessionId(req) {
  const cookies = req.headers.cookie || '';
  const cookiePairs = cookies.split(';');

  for (const pair of cookiePairs) {
    const [name, value] = pair.trim().split('=');
    if (name === 'sessionId') {
      return value;
    }
  }

  return null;
}

function createSession() {
  const sessionId = generateSessionId();
  userSessions[sessionId] = {
    created: Date.now(),
    files: []
  };
  return sessionId;
}

// Stream a multipart upload directly to disk — no full-file buffering in RAM.
// Returns a Promise resolving to { fileName, fileId, uniqueFilename, filePath, fileSize }.
function streamUploadToDisk(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!m) return reject(new Error('No boundary in Content-Type'));

    const boundary = (m[1] || m[2]).trim();
    const HEADER_END = Buffer.from('\r\n\r\n');
    const DELIMITER  = Buffer.from('\r\n--' + boundary);

    let buf        = Buffer.alloc(0);
    let state      = 'HEADER';
    let fileName   = null;
    let fileId     = null;
    let uniqueName = null;
    let filePath   = null;
    let ws         = null;
    let fileSize   = 0;
    let totalIn    = 0;
    let done       = false;

    function fail(err) {
      if (done) return;
      done = true;
      if (ws) { ws.destroy(); ws = null; }
      if (filePath) { try { fs.unlinkSync(filePath); } catch (_) {} filePath = null; }
      reject(err);
    }

    function flushBody(final) {
      if (!ws || done) return;
      const idx = buf.indexOf(DELIMITER);
      if (idx !== -1) {
        ws.write(buf.slice(0, idx));
        fileSize += idx;
        buf   = buf.slice(idx);
        state = 'DONE';
      } else if (final) {
        const end = buf.length >= 2 ? buf.length - 2 : buf.length;
        if (end > 0) { ws.write(buf.slice(0, end)); fileSize += end; }
        buf = Buffer.alloc(0);
      } else {
        const safe = buf.length - DELIMITER.length;
        if (safe > 0) {
          ws.write(buf.slice(0, safe));
          fileSize += safe;
          buf = buf.slice(safe);
        }
      }
    }

    req.on('data', chunk => {
      if (done) return;
      totalIn += chunk.length;
      if (totalIn > MAX_FILE_SIZE) { fail(Object.assign(new Error('File too large'), { code: 'TOO_LARGE' })); req.destroy(); return; }

      buf = Buffer.concat([buf, chunk]);

      if (state === 'HEADER') {
        const hEnd = buf.indexOf(HEADER_END);
        if (hEnd === -1) return;
        const header = buf.slice(0, hEnd).toString();
        const fm = header.match(/filename="([^"]+)"/);
        if (!fm) return fail(new Error('No filename in part headers'));

        fileName   = sanitizeFilename(path.basename(fm[1]));
        fileId     = generateUniqueId();
        uniqueName = fileId + path.extname(fileName);
        filePath   = path.join(UPLOAD_DIR, uniqueName);
        ws         = fs.createWriteStream(filePath);
        ws.on('error', fail);

        buf   = buf.slice(hEnd + 4);
        state = 'BODY';
      }

      if (state === 'BODY') flushBody(false);
    });

    req.on('end', () => {
      if (done) return;
      if (state === 'BODY') flushBody(true);
      if (!ws) return fail(new Error('No file received'));
      ws.end(() => {
        if (done) return;
        done = true;
        resolve({ fileName, fileId, uniqueName, filePath, fileSize });
      });
    });

    req.on('error', fail);
  });
}

// Cleanup expired files (runs every minute)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  let changed = false;

  Object.entries(fileDatabase).forEach(([fileId, metadata]) => {
    if (now > metadata.expiryTime) {
      const filePath = path.join(UPLOAD_DIR, metadata.filename);

      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        delete fileDatabase[fileId];
        changed = true;
        console.log(`Expired file ${metadata.filename} deleted`);

        if (metadata.sessionId && userSessions[metadata.sessionId]) {
          userSessions[metadata.sessionId].files = userSessions[metadata.sessionId].files.filter(id => id !== fileId);
        }
      } catch (err) {
        console.error(`Error deleting expired file ${metadata.filename}:`, err);
      }
    }
  });

  // Clean up old sessions (aligned with cookie TTL)
  Object.entries(userSessions).forEach(([sessionId, session]) => {
    if (now - session.created > SESSION_TTL && session.files.length === 0) {
      delete userSessions[sessionId];
      changed = true;
      console.log(`Expired session ${sessionId} deleted`);
    }
  });

  // Clean expired rate limit entries
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetTime) rateLimitMap.delete(ip);
  }

  if (changed) saveMetadata();
}, 60000);

// Create HTTP server
const server = http.createServer((req, res) => {
  // Handle OPTIONS request (no CORS — same-origin only)
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  // Get or create session
  let sessionId = getSessionId(req);
  if (!sessionId || !userSessions[sessionId]) {
    sessionId = createSession();
    res.setHeader('Set-Cookie', getCookieString(sessionId));
  }

  // Serve static files from public directory
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    serveStaticFile(res, path.join(__dirname, 'public', 'index.html'));
    return;
  }

  // Serve static files with path traversal protection
  if (req.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/download/')) {
    const publicDir = path.resolve(path.join(__dirname, 'public'));
    const filePath = path.resolve(path.join(__dirname, 'public', pathname));

    if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
      sendResponse(res, 403, { error: 'Forbidden' });
      return;
    }

    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveStaticFile(res, filePath);
        return;
      }
    } catch (err) {
      // stat errors fall through to 404
    }
  }

  // API endpoints
  if (pathname === '/api/files' && req.method === 'GET') {
    const sessionFiles = userSessions[sessionId].files
      .filter(fileId => fileDatabase[fileId])
      .map(fileId => {
        const metadata = fileDatabase[fileId];
        return {
          id: fileId,
          originalName: metadata.originalName,
          size: metadata.size,
          uploadTime: metadata.uploadTime,
          expiryTime: metadata.expiryTime,
          downloadLink: `/download/${metadata.filename}`
        };
      });

    sendResponse(res, 200, sessionFiles);
    return;
  }

  if (pathname === '/api/upload' && req.method === 'POST') {
    // Rate limit check
    const clientIp = getClientIp(req);
    if (!rateLimitCheck(clientIp)) {
      sendResponse(res, 429, { error: 'Too many uploads. Try again later.' });
      return;
    }

    streamUploadToDisk(req)
      .then(({ fileName, fileId, uniqueName, filePath, fileSize }) => {
        // Session fixation protection: rotate session on first upload
        if (userSessions[sessionId].files.length === 0) {
          const oldSession = userSessions[sessionId];
          delete userSessions[sessionId];
          sessionId = createSession();
          userSessions[sessionId].files = oldSession.files;
          res.setHeader('Set-Cookie', getCookieString(sessionId));
        }

        fileDatabase[fileId] = {
          originalName: fileName,
          filename: uniqueName,
          size: fileSize,
          uploadTime: Date.now(),
          expiryTime: Date.now() + FILE_EXPIRY,
          downloaded: false,
          sessionId: sessionId
        };
        userSessions[sessionId].files.push(fileId);
        saveMetadata();

        sendResponse(res, 200, {
          message: 'File uploaded successfully',
          fileId,
          downloadLink: `/download/${uniqueName}`,
          expiryTime: fileDatabase[fileId].expiryTime
        });
      })
      .catch(err => {
        console.error('Upload error:', err);
        if (err.code === 'TOO_LARGE') return sendResponse(res, 413, { error: 'File too large (max 1 GB)' });
        if (!res.headersSent) sendResponse(res, 400, { error: err.message || 'Upload failed' });
      });
    return;
  }

  if (pathname === '/api/reset-session' && req.method === 'POST') {
    if (userSessions[sessionId]) {
      userSessions[sessionId].files.forEach(fileId => {
        if (fileDatabase[fileId]) {
          const filePath = path.join(UPLOAD_DIR, fileDatabase[fileId].filename);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
            delete fileDatabase[fileId];
          } catch (err) {
            console.error(`Error deleting file ${fileId}:`, err);
          }
        }
      });

      delete userSessions[sessionId];
    }

    const newSessionId = createSession();
    res.setHeader('Set-Cookie', getCookieString(newSessionId));
    saveMetadata();

    sendResponse(res, 200, { message: 'Session reset successfully' });
    return;
  }

  if (pathname.startsWith('/download/') && req.method === 'GET') {
    const filename = pathname.substring('/download/'.length);

    // Block dot-files (e.g. .metadata.json)
    if (filename.startsWith('.')) {
      sendResponse(res, 403, { error: 'Forbidden' });
      return;
    }

    const filePath = path.join(UPLOAD_DIR, filename);

    // Path traversal protection
    const safeDir = path.resolve(UPLOAD_DIR) + path.sep;
    if (!path.resolve(filePath).startsWith(safeDir)) {
      sendResponse(res, 403, { error: 'Forbidden' });
      return;
    }

    const fileId = path.basename(filename, path.extname(filename));

    if (!fs.existsSync(filePath) || !fileDatabase[fileId]) {
      sendResponse(res, 404, { error: 'File not found or expired' });
      return;
    }

    // Safe Content-Disposition header
    res.setHeader('Content-Disposition', safeContentDisposition(fileDatabase[fileId].originalName));
    res.setHeader('Content-Type', getContentType(filePath));

    const fileStream = fs.createReadStream(filePath);

    fileStream.on('error', (err) => {
      console.error(`Error streaming file ${filename}:`, err);
      if (!res.headersSent) {
        sendResponse(res, 500, { error: 'File download failed' });
      }
    });

    fileStream.pipe(res);

    fileDatabase[fileId].downloaded = true;

    // Delete file after response (tolerate ENOENT from concurrent downloads)
    res.on('finish', () => {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') console.error(`Error deleting file ${filename}:`, err);
      }

      if (fileDatabase[fileId]) {
        const fileSessionId = fileDatabase[fileId].sessionId;
        if (fileSessionId && userSessions[fileSessionId]) {
          userSessions[fileSessionId].files = userSessions[fileSessionId].files.filter(id => id !== fileId);
        }
        delete fileDatabase[fileId];
      }

      saveMetadata();
      console.log(`File ${filename} deleted after download`);
    });

    return;
  }

  // 404 for everything else
  sendResponse(res, 404, { error: 'Not found' });
});

// Load metadata and clean orphans on startup
loadMetadata();
cleanupOrphans();

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Export for testing
module.exports = { server, cleanupInterval, sanitizeFilename, safeContentDisposition, rateLimitCheck, loadMetadata, saveMetadata, _saveTimeout: () => saveTimeout };
