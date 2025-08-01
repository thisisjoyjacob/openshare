// Test setup file
const path = require('path');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = path.join(__dirname, '../test-uploads');
process.env.LOG_LEVEL = 'error';
process.env.SESSION_SECRET = 'test-secret-key';

// Increase timeout for integration tests
jest.setTimeout(10000);