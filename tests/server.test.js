const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = path.join(__dirname, '../test-uploads');
process.env.LOG_LEVEL = 'error';
process.env.SESSION_SECRET = 'test-secret-key-for-testing';

const app = require('../src/server');

describe('OpenShare API', () => {
  let agent;
  
  beforeAll(async () => {
    // Create supertest agent to maintain cookies
    agent = request.agent(app);
    
    // Ensure test upload directory exists
    const uploadDir = process.env.UPLOAD_DIR;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  });

  afterAll(async () => {
    // Clean up test files
    const uploadDir = process.env.UPLOAD_DIR;
    if (fs.existsSync(uploadDir)) {
      try {
        const files = fs.readdirSync(uploadDir);
        files.forEach(file => {
          fs.unlinkSync(path.join(uploadDir, file));
        });
        fs.rmdirSync(uploadDir);
      } catch (error) {
        console.warn('Cleanup warning:', error.message);
      }
    }
  });

  describe('Health Check', () => {
    test('GET /health should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('files');
      expect(response.body).toHaveProperty('sessions');
    });
  });

  describe('Security Tests', () => {
    test('Should set security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
    });

    test('Should reject path traversal attempts', async () => {
      const response = await request(app)
        .get('/download/../../../etc/passwd')
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    test('Should handle malicious filenames safely', async () => {
      const testFile = Buffer.from('test content');
      const maliciousFilename = '../../malicious.txt';
      
      const response = await agent
        .post('/api/upload')
        .attach('file', testFile, maliciousFilename)
        .expect(200);

      expect(response.body).toHaveProperty('fileId');
      // Filename should be sanitized
      expect(response.body.downloadLink).not.toContain('../');
    });
  });

  describe('File Upload', () => {
    test('POST /api/upload should upload a file successfully', async () => {
      const testFile = Buffer.from('Hello, World!');
      
      const response = await agent
        .post('/api/upload')
        .attach('file', testFile, 'test.txt')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'File uploaded successfully');
      expect(response.body).toHaveProperty('fileId');
      expect(response.body).toHaveProperty('downloadLink');
      expect(response.body).toHaveProperty('expiryTime');
    });

    test('POST /api/upload should reject request without file', async () => {
      const response = await agent
        .post('/api/upload')
        .expect(400);

      expect(response.body).toHaveProperty('error', 'No file uploaded');
    });

    test('POST /api/upload should reject oversized files', async () => {
      // Create a large buffer (this won't actually be 1GB+ due to test constraints)
      const largeFile = Buffer.alloc(1024 * 1024 * 2); // 2MB for testing
      
      // Mock the file size validation by setting a smaller limit
      const originalMaxSize = process.env.MAX_FILE_SIZE;
      process.env.MAX_FILE_SIZE = '1048576'; // 1MB
      
      const response = await agent
        .post('/api/upload')
        .attach('file', largeFile, 'large.txt')
        .expect(413);

      expect(response.body).toHaveProperty('error', 'File too large');
      
      // Restore original value
      process.env.MAX_FILE_SIZE = originalMaxSize;
    });

    test('POST /api/upload should handle empty filename', async () => {
      const testFile = Buffer.from('test');
      
      const response = await agent
        .post('/api/upload')
        .attach('file', testFile, '')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('File Download', () => {
    let uploadedFile;

    beforeEach(async () => {
      // Upload a test file
      const testFile = Buffer.from('Download test content');
      const response = await agent
        .post('/api/upload')
        .attach('file', testFile, 'download-test.txt')
        .expect(200);
      
      uploadedFile = response.body;
    });

    test('Should download file successfully', async () => {
      const filename = uploadedFile.downloadLink.split('/').pop();
      
      const response = await agent
        .get(`/download/${filename}`)
        .expect(200);

      expect(response.text).toBe('Download test content');
      expect(response.headers['content-disposition']).toContain('attachment');
    });

    test('Should return 404 for non-existent file', async () => {
      const response = await agent
        .get('/download/nonexistent.txt')
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });

    test('Should handle malicious download requests', async () => {
      const response = await agent
        .get('/download/../../etc/passwd')
        .expect(404);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('File Listing', () => {
    test('GET /api/files should return user files', async () => {
      const response = await agent
        .get('/api/files')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    test('Should only return files for current session', async () => {
      // Upload a file with current agent
      const testFile = Buffer.from('Session test');
      await agent
        .post('/api/upload')
        .attach('file', testFile, 'session-test.txt')
        .expect(200);

      // Get files with current agent
      const response1 = await agent
        .get('/api/files')
        .expect(200);

      // Get files with new agent (different session)
      const response2 = await request(app)
        .get('/api/files')
        .expect(200);

      expect(response1.body.length).toBeGreaterThan(response2.body.length);
    });
  });

  describe('Session Management', () => {
    test('POST /api/reset-session should reset session', async () => {
      // Upload a file first
      const testFile = Buffer.from('Reset test');
      await agent
        .post('/api/upload')
        .attach('file', testFile, 'reset-test.txt')
        .expect(200);

      // Verify file exists
      const beforeReset = await agent
        .get('/api/files')
        .expect(200);
      expect(beforeReset.body.length).toBeGreaterThan(0);

      // Reset session
      const response = await agent
        .post('/api/reset-session')
        .expect(200);

      expect(response.body).toHaveProperty('message', 'Session reset successfully');

      // Verify files are gone
      const afterReset = await agent
        .get('/api/files')
        .expect(200);
      expect(afterReset.body.length).toBe(0);
    });

    test('Should create new session for requests without cookies', async () => {
      const response = await request(app)
        .get('/api/files')
        .expect(200);

      expect(response.headers['set-cookie']).toBeDefined();
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    test('Should enforce upload rate limits', async () => {
      const testFile = Buffer.from('Rate limit test');
      const requests = [];

      // Make multiple rapid requests
      for (let i = 0; i < 15; i++) {
        requests.push(
          request(app)
            .post('/api/upload')
            .attach('file', testFile, `rate-test-${i}.txt`)
        );
      }

      const responses = await Promise.all(requests);
      
      // Some requests should be rate limited
      const rateLimited = responses.filter(res => res.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('Static Files', () => {
    test('GET / should serve index.html', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.text).toContain('OpenShare');
      expect(response.headers['content-type']).toContain('text/html');
    });

    test('Should serve static assets', async () => {
      // This test assumes manifest.json exists in public folder
      const response = await request(app)
        .get('/manifest.json')
        .expect(200);

      expect(response.headers['content-type']).toContain('application/json');
    });
  });

  describe('Error Handling', () => {
    test('GET /nonexistent should return 404', async () => {
      const response = await request(app)
        .get('/nonexistent')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Not found');
    });

    test('Should handle malformed requests gracefully', async () => {
      const response = await request(app)
        .post('/api/upload')
        .send('invalid data')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('CORS', () => {
    test('Should include CORS headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    test('Should handle OPTIONS requests', async () => {
      const response = await request(app)
        .options('/api/upload')
        .expect(204);

      expect(response.headers['access-control-allow-methods']).toBeDefined();
    });
  });
});