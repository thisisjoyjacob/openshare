const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Create Express app
const app = express();
const PORT = 3333;

// Ensure directories exist
const uploadDir = path.join(__dirname, 'uploads');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Simple in-memory storage
const files = new Map();

// Middleware
app.use(express.static(publicDir));
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit for testing
  }
});

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    files: files.size 
  });
});

app.get('/api/files', (req, res) => {
  const fileList = Array.from(files.values()).map(file => ({
    id: file.id,
    originalName: file.originalName,
    size: file.size,
    uploadTime: file.uploadTime,
    downloadLink: `/download/${file.filename}`
  }));
  res.json(fileList);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique ID and filename
    const fileId = crypto.randomBytes(16).toString('hex');
    const fileExtension = path.extname(req.file.originalname);
    const uniqueFilename = `${fileId}${fileExtension}`;
    const filePath = path.join(uploadDir, uniqueFilename);

    // Save file to disk
    fs.writeFileSync(filePath, req.file.buffer);

    // Store file metadata
    const fileData = {
      id: fileId,
      originalName: req.file.originalname,
      filename: uniqueFilename,
      size: req.file.size,
      uploadTime: Date.now(),
      filePath: filePath
    };

    files.set(fileId, fileData);

    console.log(`✅ File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);

    res.json({
      message: 'File uploaded successfully',
      fileId: fileId,
      downloadLink: `http://localhost:${PORT}/download/${uniqueFilename}`,
      expiryTime: Date.now() + (4 * 60 * 60 * 1000) // 4 hours
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

app.get('/download/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const fileId = path.basename(filename, path.extname(filename));
    
    const fileData = files.get(fileId);
    if (!fileData) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (!fs.existsSync(fileData.filePath)) {
      files.delete(fileId);
      return res.status(404).json({ error: 'File not found on disk' });
    }

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${fileData.originalName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');

    // Stream the file
    const fileStream = fs.createReadStream(fileData.filePath);
    fileStream.pipe(res);

    console.log(`📥 File downloaded: ${fileData.originalName}`);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

app.post('/api/reset-session', (req, res) => {
  // Clear all files
  for (const [fileId, fileData] of files.entries()) {
    try {
      if (fs.existsSync(fileData.filePath)) {
        fs.unlinkSync(fileData.filePath);
      }
    } catch (error) {
      console.error('Error deleting file:', error);
    }
  }
  
  files.clear();
  console.log('🔄 Session reset - all files cleared');
  res.json({ message: 'Session reset successfully' });
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log('🚀 OpenShare Simple Server Started!');
  console.log('===================================');
  console.log(`📡 Server running on: http://localhost:${PORT}`);
  console.log(`📁 Upload directory: ${uploadDir}`);
  console.log(`📄 Serving static files from: ${publicDir}`);
  console.log('');
  console.log('🧪 Test endpoints:');
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Files: http://localhost:${PORT}/api/files`);
  console.log('');
  console.log('📱 Open your browser and test file upload!');
  console.log('⏹️  Press Ctrl+C to stop');
  console.log('===================================');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down server...');
  process.exit(0);
});