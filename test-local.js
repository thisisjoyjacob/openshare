const fs = require('fs');
const path = require('path');
const net = require('net');

// Function to find available port
function findAvailablePort(startPort = 3000) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    
    server.listen(startPort, (err) => {
      if (err) {
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
        findAvailablePort(startPort + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

// Create a simple test to verify server functionality
async function testServer() {
  console.log('🧪 OpenShare Local Testing Setup');
  console.log('================================');
  
  try {
    // Check if required directories exist
    const requiredDirs = ['uploads', 'logs', 'public'];
    console.log('\n📁 Checking directories...');
    
    requiredDirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created: ${dir}/`);
      } else {
        console.log(`✅ Exists: ${dir}/`);
      }
    });
    
    // Check if public files exist
    const publicFiles = ['public/index.html', 'public/manifest.json'];
    console.log('\n📄 Checking public files...');
    
    publicFiles.forEach(file => {
      if (fs.existsSync(file)) {
        console.log(`✅ Found: ${file}`);
      } else {
        console.log(`❌ Missing: ${file}`);
      }
    });
    
    // Find available port
    console.log('\n🔍 Finding available port...');
    const availablePort = await findAvailablePort(3000);
    
    // Set environment for local testing
    process.env.NODE_ENV = 'development';
    process.env.PORT = availablePort.toString();
    process.env.SESSION_SECRET = 'local-test-secret-key';
    process.env.LOG_LEVEL = 'info';
    process.env.CORS_ORIGIN = '*';
    
    console.log('\n🔧 Environment Configuration:');
    console.log(`   Port: ${process.env.PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV}`);
    console.log(`   CORS Origin: ${process.env.CORS_ORIGIN}`);
    
    console.log('\n🚀 Starting server...');
    console.log(`📱 Open your browser to: http://localhost:${process.env.PORT}`);
    console.log('📋 Test the upload functionality by:');
    console.log('   1. Drag & drop a file');
    console.log('   2. Or click "Select File" button');
    console.log('   3. Check browser console for any errors');
    console.log('   4. Check Network tab in DevTools for API calls');
    console.log('\n🔧 API Endpoints to test:');
    console.log(`   Health: http://localhost:${process.env.PORT}/health`);
    console.log(`   Files: http://localhost:${process.env.PORT}/api/files`);
    console.log(`   Upload: POST http://localhost:${process.env.PORT}/api/upload`);
    console.log('\n⏹️  Press Ctrl+C to stop the server');
    console.log('================================\n');
    
    // Start the server
    require('./src/server.js');
    
  } catch (error) {
    console.error('❌ Server failed to start:', error.message);
    console.log('\n🔍 Troubleshooting:');
    console.log('   1. Make sure all dependencies are installed: npm install');
    console.log('   2. Check if all required files exist');
    console.log('   3. Verify Node.js version (requires 18+)');
    console.log('   4. Check for any syntax errors in the code');
    process.exit(1);
  }
}

testServer();