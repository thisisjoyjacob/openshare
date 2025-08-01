const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const logger = require('./utils/logger');
const { createSecureHeaders, parseCookies, escapeFilename } = require('./utils/security');
const FileService = require('./services/fileService');
const SessionService = require('./services/sessionService');

// Initialize services
const fileService = new FileService();
const sessionService = new SessionService();

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // We'll set our own CSP
}));

// Custom security headers
app.use((req, res, next) => {
  const headers = createSecureHeaders();
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  next();
});

// CORS
app.use(cors({
  origin: config.corsOrigin,
  credentials: true
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const uploadLimiter = rateLimit({
  windowMs: config.rateLimitWindow,
  max: config.rateLimitMax,
  message: {
    error: 'Too many upload attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxFileSize,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Basic file validation
    if (!file.originalname || file.originalname.length > 255) {
      return cb(new Error('Invalid filename'));
    }
    cb(null, true);
  }
});

// Session middleware
app.use((req, res, next) => {
  try {
    // Parse cookies securely
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies.sessionId;

    let session = sessionService.getSession(sessionId);
    
    if (!session) {
      // Create new session
      const newSessionId = sessionService.createSession();
      session = sessionService.getSession(newSessionId);
      
      // Set session cookie
      res.cookie('sessionId', newSessionId, {
        maxAge: config.sessionMaxAge,
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'strict'
      });
    }

    req.session = session;
    next();
  } catch (error) {
    logger.error('Session middleware error:', error);
    // Create new session on error
    const newSessionId = sessionService.createSession();
    const session = sessionService.getSession(newSessionId);
    
    res.cookie('sessionId', newSessionId, {
      maxAge: config.sessionMaxAge,
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'strict'
    });
    
    req.session = session;
    next();
  }
});

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    sessionId: req.session?.id
  });
  next();
});

// Static files
app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: config.isProduction ? '1d' : 0,
  etag: true
}));

// Health check endpoint
app.get(config.healthCheckPath, (req, res) => {
  const fileStats = fileService.getStats();
  const sessionStats = sessionService.getStats();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    files: fileStats,
    sessions: sessionStats,
    version: require('../package.json').version
  });
});

// API Routes

// Get user's files
app.get('/api/files', (req, res) => {
  try {
    const files = fileService.getSessionFiles(req.session.id);
    res.json(files);
  } catch (error) {
    logger.error('Failed to get session files:', error);
    res.status(500).json({ error: 'Failed to retrieve files' });
  }
});

// Upload file
app.post('/api/upload', uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = await fileService.uploadFile(req.file, req.session.id);
    sessionService.addFileToSession(req.session.id, result.fileId);

    res.json({
      message: 'File uploaded successfully',
      fileId: result.fileId,
      downloadLink: `${req.protocol}://${req.get('host')}${result.downloadLink}`,
      expiryTime: result.expiryTime
    });

  } catch (error) {
    logger.error('Upload failed:', error);
    
    if (error.message.includes('File too large')) {
      return res.status(413).json({ error: 'File too large' });
    }
    
    if (error.message.includes('not allowed')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Download file
app.get('/download/:filename', async (req, res) => {
  let fileDeleted = false;
  
  try {
    const { filename } = req.params;
    const metadata = await fileService.getFile(filename);

    // Set download headers with escaped filename
    const safeFilename = escapeFilename(metadata.originalName);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', metadata.mimetype);
    res.setHeader('Content-Length', metadata.size);

    // Stream file
    const fileStream = fs.createReadStream(metadata.filePath);
    
    // Handle stream errors
    fileStream.on('error', async (error) => {
      logger.error(`Error streaming file ${filename}:`, error);
      
      // Clean up file on error
      if (!fileDeleted) {
        fileDeleted = true;
        try {
          await fileService.deleteFile(metadata.id);
          sessionService.removeFileFromSession(metadata.sessionId, metadata.id);
        } catch (cleanupError) {
          logger.error(`Failed to cleanup file ${filename} after error:`, cleanupError);
        }
      }
      
      if (!res.headersSent) {
        res.status(500).json({ error: 'File streaming failed' });
      }
    });

    // Handle successful completion
    fileStream.on('end', async () => {
      if (!fileDeleted) {
        fileDeleted = true;
        try {
          await fileService.deleteFile(metadata.id);
          sessionService.removeFileFromSession(metadata.sessionId, metadata.id);
          logger.info(`File ${filename} deleted after download`);
        } catch (error) {
          logger.error(`Failed to delete file ${filename} after download:`, error);
        }
      }
    });

    // Handle response close (client disconnect)
    res.on('close', async () => {
      if (!fileDeleted && !res.writableEnded) {
        fileDeleted = true;
        try {
          await fileService.deleteFile(metadata.id);
          sessionService.removeFileFromSession(metadata.sessionId, metadata.id);
          logger.info(`File ${filename} deleted after client disconnect`);
        } catch (error) {
          logger.error(`Failed to delete file ${filename} after disconnect:`, error);
        }
      }
    });

    fileStream.pipe(res);

  } catch (error) {
    logger.error(`Download failed for ${req.params.filename}:`, error);
    
    if (error.message.includes('not found') || error.message.includes('expired')) {
      return res.status(404).json({ error: 'File not found or expired' });
    }
    
    res.status(500).json({ error: 'Download failed' });
  }
});

// Reset session
app.post('/api/reset-session', async (req, res) => {
  try {
    const sessionId = req.session.id;
    const session = sessionService.getSession(sessionId);
    
    if (session) {
      // Delete all files for this session
      for (const fileId of session.files) {
        await fileService.deleteFile(fileId);
      }
      
      // Delete session
      sessionService.deleteSession(sessionId);
    }

    // Create new session
    const newSessionId = sessionService.createSession();
    res.cookie('sessionId', newSessionId, {
      maxAge: config.sessionMaxAge,
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'strict'
    });

    res.json({ message: 'Session reset successfully' });

  } catch (error) {
    logger.error('Session reset failed:', error);
    res.status(500).json({ error: 'Session reset failed' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Cleanup intervals
setInterval(async () => {
  try {
    await fileService.cleanupExpiredFiles();
    sessionService.cleanupExpiredSessions();
  } catch (error) {
    logger.error('Cleanup failed:', error);
  }
}, config.cleanupInterval);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(config.port, config.host, () => {
  logger.info(`OpenShare server running on ${config.host}:${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`Upload directory: ${config.uploadDir}`);
  logger.info(`Max file size: ${(config.maxFileSize / 1024 / 1024).toFixed(0)}MB`);
  logger.info(`File expiry: ${(config.fileExpiry / 1000 / 60 / 60).toFixed(1)} hours`);
});

module.exports = app;