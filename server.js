// Simple file sharing server with minimal dependencies
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

// In-memory file database
const fileDatabase = {};

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
      } catch (err) {
        console.error(`Error deleting expired file ${metadata.filename}:`, err);
      }
    }
  });
}, 60000);

// Create HTTP server
const server = http.createServer((req, res)  => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`) ;
  const pathname = url.pathname;
  
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
    // Get all files
    const files = Object.entries(fileDatabase).map(([id, metadata]) => ({
      id,
      originalName: metadata.originalName,
      size: metadata.size,
      uploadTime: metadata.uploadTime,
      expiryTime: metadata.expiryTime,
      downloadLink: `http://${req.headers.host}/download/${metadata.filename}`
    }) );
    
    sendResponse(res, 200, files);
    return;
  }
  
  if (pathname === '/api/upload' && req.method === 'POST') {
    // Handle file upload
    let body = [];
    let fileSize = 0;
    
    req.on('data', (chunk) => {
      fileSize += chunk.length;
      
      // Check file size limit
      if (fileSize > MAX_FILE_SIZE) {
        req.destroy();
        sendResponse(res, 413, { error: 'File too large' });
        return;
      }
      
      body.push(chunk);
    });
    
    req.on('end', () => {
      try {
        // Parse multipart form data (simplified version)
        const bodyBuffer = Buffer.concat(body);
        const boundary = req.headers['content-type'].split('boundary=')[1];
        const parts = bodyBuffer.toString().split(`--${boundary}`);
        
        // Find the file part
        let fileName = '';
        let fileContent = null;
        
        for (const part of parts) {
          if (part.includes('filename=')) {
            // Extract filename
            const filenameMatch = part.match(/filename="(.+?)"/);
            if (filenameMatch && filenameMatch[1]) {
              fileName = filenameMatch[1];
              
              // Find the content
              const contentIndex = part.indexOf('\r\n\r\n');
              if (contentIndex > -1) {
                fileContent = part.substring(contentIndex + 4);
                // Remove trailing boundary
                fileContent = fileContent.substring(0, fileContent.lastIndexOf('\r\n'));
                break;
              }
            }
          }
        }
        
        if (!fileName || !fileContent) {
          sendResponse(res, 400, { error: 'No file uploaded' });
          return;
        }
        
        // Generate unique filename
        const fileId = generateUniqueId();
        const fileExtension = path.extname(fileName);
        const uniqueFilename = `${fileId}${fileExtension}`;
        const filePath = path.join(UPLOAD_DIR, uniqueFilename);
        
        // Save file
        fs.writeFileSync(filePath, fileContent);
        
        // Store file metadata
        fileDatabase[fileId] = {
          originalName: fileName,
          filename: uniqueFilename,
          size: fileContent.length,
          uploadTime: Date.now(),
          expiryTime: Date.now() + FILE_EXPIRY,
          downloaded: false
        };
        
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
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`) ;
});
