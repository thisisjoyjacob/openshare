const fs = require('fs');
const path = require('path');
const net = require('net');

// Function to find available port
function findAvailablePort(startPort = 3000) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    
    server.listen(startPort, (err) => {
      if (err) {
        // Port is in use, try next one
        server.close();
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        const port = server.address().port;
        server.close();
        resolve(port);
      }
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port is in use, try next one
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

async function startServer() {
  try {
    // Create necessary directories
    const dirs = ['uploads', 'logs', 'public'];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      }
    });

    // Find available port
    const availablePort = await findAvailablePort(3000);
    
    // Set environment variables
    process.env.PORT = availablePort.toString();
    process.env.NODE_ENV = 'development';
    process.env.SESSION_SECRET = 'dev-secret-key-change-in-production';
    process.env.LOG_LEVEL = 'info';

    console.log('🚀 Starting OpenShare server...');
    console.log(`📡 Port: ${process.env.PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(`📁 Upload directory: uploads/`);
    console.log(`📝 Log directory: logs/`);
    console.log('');

    // Start the server
    require('./src/server.js');
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();