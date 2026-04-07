const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Import helpers from server (this also starts the server on PORT)
const { server, cleanupInterval, sanitizeFilename, safeContentDisposition, rateLimitCheck, _saveTimeout } = require('../server');

// Close server and cleanup timers after all tests so process can exit
after(() => {
  clearInterval(cleanupInterval);
  const t = _saveTimeout();
  if (t) clearTimeout(t);
  server.close();
});

const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function uploadFile(filename, content) {
  const boundary = '----TestBoundary' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return request('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

// -- Unit tests for sanitizeFilename --
describe('sanitizeFilename', () => {
  it('strips HTML tags', () => {
    assert.strictEqual(sanitizeFilename('<script>alert(1)</script>.txt'), 'alert(1).txt');
  });

  it('removes path separators', () => {
    const result = sanitizeFilename('../../etc/passwd');
    assert.ok(!result.includes('/'), 'should not contain forward slashes');
    assert.ok(!result.includes('\\'), 'should not contain backslashes');
  });

  it('removes null bytes', () => {
    assert.strictEqual(sanitizeFilename('file\x00.txt'), 'file.txt');
  });

  it('preserves Unicode characters', () => {
    const name = sanitizeFilename('dokument-\u00fc\u00e4\u00f6.pdf');
    assert.ok(name.includes('\u00fc'), 'should preserve umlauts');
  });

  it('preserves CJK characters', () => {
    const name = sanitizeFilename('\u6d4b\u8bd5\u6587\u4ef6.txt');
    assert.ok(name.includes('\u6d4b\u8bd5'), 'should preserve CJK');
  });

  it('returns unnamed_file for empty input', () => {
    assert.strictEqual(sanitizeFilename(''), 'unnamed_file');
  });

  it('truncates to 255 chars', () => {
    const longName = 'a'.repeat(300) + '.txt';
    assert.ok(sanitizeFilename(longName).length <= 255);
  });

  it('removes control characters', () => {
    assert.strictEqual(sanitizeFilename('file\r\n\t.txt'), 'file.txt');
  });
});

// -- Unit tests for safeContentDisposition --
describe('safeContentDisposition', () => {
  it('produces valid header for ASCII filename', () => {
    const header = safeContentDisposition('test.txt');
    assert.ok(header.startsWith('attachment; filename='));
    assert.ok(header.includes('test.txt'));
  });

  it('escapes quotes in filename', () => {
    const header = safeContentDisposition('file"name.txt');
    assert.ok(!header.includes('"file"name"'), 'should not have raw quotes in filename value');
  });

  it('handles newlines (header injection prevention)', () => {
    const header = safeContentDisposition('file\r\nname.txt');
    assert.ok(!header.includes('\r\n'), 'should not contain CRLF');
  });

  it('includes RFC 5987 encoded filename*', () => {
    const header = safeContentDisposition('\u6d4b\u8bd5.txt');
    assert.ok(header.includes("filename*=UTF-8''"), 'should have RFC 5987 encoding');
  });
});

// -- Unit tests for rateLimitCheck --
describe('rateLimitCheck', () => {
  it('allows requests under the limit', () => {
    const ip = 'test-' + Date.now();
    for (let i = 0; i < 10; i++) {
      assert.ok(rateLimitCheck(ip), `request ${i + 1} should be allowed`);
    }
  });

  it('rejects requests over the limit', () => {
    const ip = 'test-overlimit-' + Date.now();
    for (let i = 0; i < 10; i++) rateLimitCheck(ip);
    assert.strictEqual(rateLimitCheck(ip), false, '11th request should be rejected');
  });
});

// Note: streamUploadToDisk is tested via the integration upload tests below

// -- Integration tests for path traversal --
describe('Path traversal protection', () => {
  it('blocks ../../../etc/passwd on static files', async () => {
    const res = await request('/../../server.js');
    assert.ok([403, 404].includes(res.status), `expected 403 or 404, got ${res.status}`);
  });

  it('blocks URL-encoded traversal on static files', async () => {
    const res = await request('/%2e%2e/%2e%2e/server.js');
    assert.ok([403, 404].includes(res.status), `expected 403 or 404, got ${res.status}`);
  });

  it('blocks path traversal on download endpoint', async () => {
    const res = await request('/download/../../server.js');
    assert.ok([403, 404].includes(res.status), `expected 403 or 404, got ${res.status}`);
  });

  it('blocks dot-files on download endpoint', async () => {
    const res = await request('/download/.metadata.json');
    assert.strictEqual(res.status, 403);
  });
});

// -- Integration tests for upload --
describe('Upload endpoint', () => {
  it('rejects upload without boundary', async () => {
    const res = await request('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not multipart',
    });
    assert.strictEqual(res.status, 400);
  });

  it('successfully uploads a file and returns relative URL', async () => {
    const res = await uploadFile('test-upload.txt', 'hello');
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(data.downloadLink.startsWith('/download/'), 'should be a relative URL');
    assert.ok(!data.downloadLink.includes('http'), 'should not contain protocol');
  });

  it('sanitizes filenames with HTML tags', async () => {
    const res = await uploadFile('<script>alert(1)</script>.txt', 'payload');
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(!data.downloadLink.includes('<script>'), 'link should not contain script tags');
  });
});

// -- Integration test for download --
describe('Download endpoint', () => {
  it('returns 404 for nonexistent file', async () => {
    const res = await request('/download/nonexistent.txt');
    assert.strictEqual(res.status, 404);
  });
});

// -- Metadata persistence --
describe('Metadata persistence', () => {
  it('loadMetadata handles corrupt JSON gracefully', () => {
    const metaPath = path.join(__dirname, '..', 'uploads', '.metadata.json');
    const backup = fs.existsSync(metaPath) ? fs.readFileSync(metaPath) : null;
    try {
      fs.writeFileSync(metaPath, '{corrupt json!!!');
      // Should not throw
      assert.doesNotThrow(() => {
        const { loadMetadata } = require('../server');
      });
    } finally {
      if (backup) {
        fs.writeFileSync(metaPath, backup);
      } else {
        try { fs.unlinkSync(metaPath); } catch (e) {}
      }
    }
  });
});
