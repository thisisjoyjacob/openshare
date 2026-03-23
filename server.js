// Enhanced file sharing server with user sessions and additional features
const http = require('http') ;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('querystring');

// Configuration
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const METADATA_PATH = path.join(UPLOAD_DIR, '.metadata.json');
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB
const FILE_EXPIRY = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';

// Extension denylist — guards against accidental execution by filename convention.
// Note: a renamed executable (malware.exe → malware.txt) bypasses this; full
// MIME-type inspection is deferred to a future hardening pass.
const DENIED_EXTENSIONS = new Set(['.exe', '.sh', '.bat', '.cmd', '.ps1', '.vbs']);

// inFlightUploads guards against server-side ID collisions, not client retries —
// IDs are server-generated per request via crypto.randomBytes.
const inFlightUploads = new Set();

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// In-memory file database with user sessions
let fileDatabase = {};
const userSessions = {};

// Persistence helpers
function saveMetadata() {
  try {
    fs.writeFileSync(METADATA_PATH, JSON.stringify(fileDatabase));
  } catch (err) {
    console.error('Error saving metadata:', err);
  }
}

// Load persisted metadata on startup
try {
  const raw = fs.readFileSync(METADATA_PATH, 'utf8');
  fileDatabase = JSON.parse(raw);
  console.log(`Restored ${Object.keys(fileDatabase).length} file(s) from metadata`);
} catch (err) {
  // Missing or corrupt — start fresh
  fileDatabase = {};
}

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
  // Check for session cookie
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
    // After the body starts the first part header ends with \r\n\r\n,
    // then file bytes follow until \r\n--<boundary>
    const HEADER_END = Buffer.from('\r\n\r\n');
    const DELIMITER  = Buffer.from('\r\n--' + boundary);

    let buf        = Buffer.alloc(0);
    let state      = 'HEADER'; // → BODY → DONE
    let fileName   = null;
    let fileId     = null;
    let uniqueName = null;
    let filePath   = null;
    let ws         = null;      // write stream
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
        // Found boundary — write up to it and stop
        ws.write(buf.slice(0, idx));
        fileSize += idx;
        buf   = buf.slice(idx);
        state = 'DONE';
      } else if (final) {
        // End of stream — write remainder minus trailing \r\n (final boundary suffix)
        const end = buf.length >= 2 ? buf.length - 2 : buf.length;
        if (end > 0) { ws.write(buf.slice(0, end)); fileSize += end; }
        buf = Buffer.alloc(0);
      } else {
        // Keep last DELIMITER.length bytes in buffer (boundary may span chunks)
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
        if (hEnd === -1) return; // need more data
        const header = buf.slice(0, hEnd).toString();
        const fm = header.match(/filename="([^"]+)"/);
        if (!fm) return fail(new Error('No filename in part headers'));

        fileName   = path.basename(fm[1]);
        fileId     = generateUniqueId();
        uniqueName = fileId + path.extname(fileName);
        filePath   = path.join(UPLOAD_DIR, uniqueName);
        ws         = fs.createWriteStream(filePath);
        ws.on('error', fail);

        buf   = buf.slice(hEnd + 4); // skip past \r\n\r\n
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
setInterval(() => {
  const now = Date.now();
  
  Object.entries(fileDatabase).forEach(([fileId, metadata]) => {
    if (now > metadata.expiryTime) {
      const filePath = path.join(UPLOAD_DIR, metadata.filename);
      
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        delete fileDatabase[fileId];
        console.log(`Expired file ${metadata.filename} deleted`);

        // Remove from user session if exists
        if (metadata.sessionId && userSessions[metadata.sessionId]) {
          userSessions[metadata.sessionId].files = userSessions[metadata.sessionId].files.filter(id => id !== fileId);
        }
      } catch (err) {
        console.error(`Error deleting expired file ${metadata.filename}:`, err);
      }
    }
  });
  saveMetadata(); // persist after expiry cleanup

  // Clean up old sessions (older than 24 hours)
  Object.entries(userSessions).forEach(([sessionId, session]) => {
    if (now - session.created > 24 * 60 * 60 * 1000 && session.files.length === 0) {
      delete userSessions[sessionId];
      console.log(`Expired session ${sessionId} deleted`);
    }
  });
}, 60000);

// Create HTTP server
const server = http.createServer((req, res)  => {
  // Set CORS headers — restrict to configured origin (never wildcard)
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`) ;
  const pathname = url.pathname;
  
  // Get or create session
  let sessionId = getSessionId(req);
  if (!sessionId || !userSessions[sessionId]) {
    sessionId = createSession();
    res.setHeader('Set-Cookie', `sessionId=${sessionId}; Path=/; Max-Age=${7*24*60*60}; HttpOnly; SameSite=Strict`);
  }
  
  // Serve static files from public directory
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    serveStaticFile(res, path.join(__dirname, 'public', 'index.html'));
    return;
  }
  
  // Serve static files from public directory with explicit path
  if (req.method === 'GET' && !pathname.includes('..')) {
    const filePath = path.join(__dirname, 'public', pathname);
    
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveStaticFile(res, filePath);
      return;
    }
  }
  
  // API endpoints
  if (pathname === '/api/files' && req.method === 'GET') {
    // Get all files for current session
    const sessionFiles = userSessions[sessionId].files
      .filter(fileId => fileDatabase[fileId]) // Filter out deleted files
      .map(fileId => {
        const metadata = fileDatabase[fileId];
        return {
          id: fileId,
          originalName: metadata.originalName,
          size: metadata.size,
          uploadTime: metadata.uploadTime,
          expiryTime: metadata.expiryTime,
          downloadLink: `http://${req.headers.host}/download/${metadata.filename}`
        };
      }) ;
    
    sendResponse(res, 200, sessionFiles);
    return;
  }
  
  if (pathname === '/api/upload' && req.method === 'POST') {
    streamUploadToDisk(req)
      .then(({ fileName, fileId, uniqueName, filePath, fileSize }) => {
        // Guard in-flight (tracks server-side processing; IDs are crypto-random so
        // collisions are astronomically unlikely — Set primarily guards against bugs)
        inFlightUploads.add(fileId);
        try {
          // Reject dot-prefix filenames (guards against .metadata.json injection)
          if (fileName.startsWith('.')) {
            try { fs.unlinkSync(filePath); } catch (_) {}
            sendResponse(res, 400, { error: 'Invalid filename' });
            return;
          }

          // Extension denylist (case-insensitive)
          const fileExtension = path.extname(fileName).toLowerCase();
          if (!fileExtension || DENIED_EXTENSIONS.has(fileExtension)) {
            try { fs.unlinkSync(filePath); } catch (_) {}
            sendResponse(res, 400, { error: 'File type not allowed' });
            return;
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
          saveMetadata(); // persist after upload

          sendResponse(res, 200, {
            message: 'File uploaded successfully',
            fileId,
            downloadLink: `http://${req.headers.host}/download/${uniqueName}`,
            expiryTime: fileDatabase[fileId].expiryTime
          });
        } finally {
          inFlightUploads.delete(fileId);
        }
      })
      .catch(err => {
        console.error('Upload error:', err);
        if (err.code === 'TOO_LARGE') return sendResponse(res, 413, { error: 'File too large (max 1 GB)' });
        if (!res.headersSent) sendResponse(res, 400, { error: err.message || 'Upload failed' });
      });
    return;
  }
  
  if (pathname === '/api/reset-session' && req.method === 'POST') {
    // Reset user session - delete all files and create new session
    if (userSessions[sessionId]) {
      // Delete all files for this session
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
      
      // Delete session
      delete userSessions[sessionId];
      saveMetadata(); // persist after bulk delete
    }

    // Create new session
    const newSessionId = createSession();
    res.setHeader('Set-Cookie', `sessionId=${newSessionId}; Path=/; Max-Age=${7*24*60*60}; HttpOnly; SameSite=Strict`);
    
    sendResponse(res, 200, { message: 'Session reset successfully' });
    return;
  }
  
  if (pathname.startsWith('/download/') && req.method === 'GET') {
    // Handle file download
    const rawFilename = pathname.substring('/download/'.length);

    // Dot-file guard: reject .metadata.json and any other dot-prefixed filename
    if (rawFilename.startsWith('.')) {
      sendResponse(res, 403, { error: 'Forbidden' });
      return;
    }

    // Strip null bytes before path resolution (guards against %00 bypass)
    const filename = rawFilename.replace(/\0/g, '');

    // Path traversal guard: resolved path must stay inside UPLOAD_DIR
    const safeDir = path.resolve(UPLOAD_DIR) + path.sep;
    const resolvedPath = path.resolve(UPLOAD_DIR, filename);
    if (!resolvedPath.startsWith(safeDir)) {
      sendResponse(res, 403, { error: 'Forbidden' });
      return;
    }

    const fileId = path.basename(filename, path.extname(filename));
    const filePath = resolvedPath;

    // Check if file exists
    if (!fs.existsSync(filePath) || !fileDatabase[fileId]) {
      sendResponse(res, 404, { error: 'File not found or expired' });
      return;
    }

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${fileDatabase[fileId].originalName}"`);
    res.setHeader('Content-Type', getContentType(filePath));

    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    // Mark as downloaded and schedule deletion
    fileDatabase[fileId].downloaded = true;

    // Delete file after response is complete
    res.on('finish', () => {
      try {
        fs.unlinkSync(filePath);

        // Remove from user session if exists
        const fileSessionId = fileDatabase[fileId].sessionId;
        if (fileSessionId && userSessions[fileSessionId]) {
          userSessions[fileSessionId].files = userSessions[fileSessionId].files.filter(id => id !== fileId);
        }

        delete fileDatabase[fileId];
        saveMetadata(); // persist after download-triggered deletion
        console.log(`File ${filename} deleted after download`);
      } catch (err) {
        console.error(`Error deleting file ${filename}:`, err);
      }
    });

    return;
  }
  
  // 404 for everything else
  sendResponse(res, 404, { error: 'Not found' });
});

// Start the server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`) ;
});
