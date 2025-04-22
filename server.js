// Enhanced file sharing server with user sessions and additional features
const http = require('http') ;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('querystring');

// Configuration
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB
const FILE_EXPIRY = 4 * 60 * 60 * 1000; // 4 hours in milliseconds

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

// Parse multipart form data properly for binary files
function parseMultipartFormData(buffer, boundary) {
  const result = {
    fileName: null,
    fileContent: null
  };
  
  // Convert boundary to buffer for binary comparison
  const boundaryBuffer = Buffer.from('--' + boundary);
  const crlfBuffer = Buffer.from('\r\n');
  const headerEndBuffer = Buffer.from('\r\n\r\n');
  
  // Find all boundary positions
  let boundaryPositions = [];
  let pos = 0;
  
  while (true) {
    const index = buffer.indexOf(boundaryBuffer, pos);
    if (index === -1) break;
    boundaryPositions.push(index);
    pos = index + boundaryBuffer.length;
  }
  
  // Process each part
  for (let i = 0; i < boundaryPositions.length - 1; i++) {
    const partStart = boundaryPositions[i] + boundaryBuffer.length;
    const partEnd = boundaryPositions[i + 1];
    const part = buffer.slice(partStart, partEnd);
    
    // Check if this part contains a file
    if (part.includes(Buffer.from('filename='))) {
      // Find header end position
      const headerEndPos = part.indexOf(headerEndBuffer);
      if (headerEndPos === -1) continue;
      
      // Extract header as string for parsing
      const header = part.slice(0, headerEndPos).toString();
      
      // Extract filename
      const filenameMatch = header.match(/filename="([^"]+)"/);
      if (!filenameMatch) continue;
      result.fileName = filenameMatch[1];
      
      // Extract file content (binary safe)
      const contentStart = headerEndPos + headerEndBuffer.length;
      // Content ends before the CRLF that precedes the next boundary
      const contentEnd = part.length - 2; // -2 for CRLF
      
      // Extract binary content
      result.fileContent = part.slice(contentStart, contentEnd);
      break; // We found the file part, no need to continue
    }
  }
  
  return result;
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
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    res.setHeader('Set-Cookie', `sessionId=${sessionId}; Path=/; Max-Age=${7*24*60*60}; SameSite=Strict`);
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
    // Handle file upload
    let chunks = [];
    let fileSize = 0;
    
    req.on('data', (chunk) => {
      fileSize += chunk.length;
      
      // Check file size limit
      if (fileSize > MAX_FILE_SIZE) {
        req.destroy();
        sendResponse(res, 413, { error: 'File too large' });
        return;
      }
      
      chunks.push(chunk);
    });
    
    req.on('end', () => {
      try {
        // Get the boundary from the content-type header
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        
        if (!boundaryMatch) {
          sendResponse(res, 400, { error: 'Invalid content type or missing boundary' });
          return;
        }
        
        const boundary = boundaryMatch[1] || boundaryMatch[2];
        const buffer = Buffer.concat(chunks);
        
        // Parse multipart form data
        const { fileName, fileContent } = parseMultipartFormData(buffer, boundary);
        
        if (!fileName || !fileContent) {
          sendResponse(res, 400, { error: 'No file uploaded or invalid file data' });
          return;
        }
        
        // Generate unique filename
        const fileId = generateUniqueId();
        const fileExtension = path.extname(fileName);
        const uniqueFilename = `${fileId}${fileExtension}`;
        const filePath = path.join(UPLOAD_DIR, uniqueFilename);
        
        // Save file (binary safe)
        fs.writeFileSync(filePath, fileContent);
        
        // Store file metadata
        fileDatabase[fileId] = {
          originalName: fileName,
          filename: uniqueFilename,
          size: fileContent.length,
          uploadTime: Date.now(),
          expiryTime: Date.now() + FILE_EXPIRY,
          downloaded: false,
          sessionId: sessionId
        };
        
        // Add to user session
        userSessions[sessionId].files.push(fileId);
        
        // Return success response
        sendResponse(res, 200, {
          message: 'File uploaded successfully',
          fileId: fileId,
          downloadLink: `http://${req.headers.host}/download/${uniqueFilename}`,
          expiryTime: fileDatabase[fileId].expiryTime
        }) ;
      } catch (error) {
        console.error('Upload error:', error);
        sendResponse(res, 500, { error: 'File upload failed' });
      }
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
    }
    
    // Create new session
    const newSessionId = createSession();
    res.setHeader('Set-Cookie', `sessionId=${newSessionId}; Path=/; Max-Age=${7*24*60*60}; SameSite=Strict`);
    
    sendResponse(res, 200, { message: 'Session reset successfully' });
    return;
  }
  
  if (pathname.startsWith('/download/') && req.method === 'GET') {
    // Handle file download
    const filename = pathname.substring('/download/'.length);
    const fileId = path.basename(filename, path.extname(filename));
    const filePath = path.join(UPLOAD_DIR, filename);
    
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
