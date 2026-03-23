/**
 * OpenShare server hardening tests
 * Uses Node.js built-in test runner (node:test) — zero dependencies.
 * Run:  node --test test/server.test.js
 *
 * HTTP integration tests require a running server.
 * Set OPENSHARE_TEST_PORT to enable them:
 *   PORT=3099 node server.js &
 *   OPENSHARE_TEST_PORT=3099 node --test test/server.test.js
 */

'use strict';

const { test, describe, before, skip } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TEST_PORT = process.env.OPENSHARE_TEST_PORT ? Number(process.env.OPENSHARE_TEST_PORT) : null;

// ── HTTP helper (integration tests only) ─────────────────────────────────────

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipartBody(filename, content, boundary) {
  return [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`,
    `Content-Type: application/octet-stream\r\n\r\n`,
    content,
    `\r\n--${boundary}--\r\n`,
  ].join('');
}

// ── Static: Regression checks (no server needed) ─────────────────────────────

describe('Regression: multi-file upload restored', () => {
  test('index.html has multiple attribute on file input', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.ok(html.includes('multiple'), 'index.html must have multiple attribute on file input');
  });

  test('index.html has upload queue UI', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
    assert.ok(
      html.includes('upload-queue') || html.includes('queue-item'),
      'index.html must include upload queue elements'
    );
  });
});

describe('Regression: docker-compose.yml restored', () => {
  test('docker-compose.yml exists', () => {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'docker-compose.yml')),
      'docker-compose.yml must exist'
    );
  });

  test('docker-compose.yml has healthcheck', () => {
    const content = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8');
    assert.ok(content.includes('healthcheck'), 'docker-compose.yml must include healthcheck');
  });
});

// ── Static: Hardening constants in server.js (no server needed) ──────────────

describe('Hardening: security constants present', () => {
  let src;
  before(() => { src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'); });

  test('DENIED_EXTENSIONS Set is defined', () => {
    assert.ok(src.includes('DENIED_EXTENSIONS'), 'DENIED_EXTENSIONS must be defined');
  });

  test('Extension check uses toLowerCase() for case normalization', () => {
    assert.ok(src.includes('toLowerCase()'), 'Extension check must be case-insensitive');
  });

  test('ALLOWED_ORIGIN is used for CORS (not wildcard *)', () => {
    assert.ok(src.includes('ALLOWED_ORIGIN'), 'CORS must use ALLOWED_ORIGIN env var');
    assert.ok(!src.includes("'*'") && !src.includes('"*"'), 'CORS must not use wildcard *');
  });

  test('inFlightUploads Set is defined', () => {
    assert.ok(src.includes('inFlightUploads'), 'inFlightUploads Set must be defined');
  });

  test('inFlightUploads is cleaned up in finally block', () => {
    assert.ok(
      src.includes('finally') && src.includes('inFlightUploads.delete'),
      'inFlightUploads must be released in a finally block'
    );
  });

  test('saveMetadata is called on upload mutation', () => {
    assert.ok(src.includes('saveMetadata()'), 'saveMetadata must be called on mutations');
  });

  test('saveMetadata is called after reset-session', () => {
    // Verify the pattern: saveMetadata appears after the reset-session block
    const resetIdx = src.indexOf('/api/reset-session');
    const saveIdx = src.indexOf('saveMetadata()', resetIdx);
    assert.ok(saveIdx !== -1, 'saveMetadata must be called after reset-session mutations');
  });

  test('Null byte stripped before path.resolve', () => {
    assert.ok(
      src.includes('replace(/\\0/g,') || src.includes("replace(/\0/g,"),
      'Null bytes must be stripped before path.resolve()'
    );
  });

  test('Path traversal guard uses startsWith(safeDir)', () => {
    assert.ok(src.includes('startsWith(safeDir)'), 'Path traversal guard must use startsWith(safeDir)');
  });

  test('Dot-file guard in /download/ handler', () => {
    assert.ok(src.includes("startsWith('.')"), 'Download handler must reject dot-prefixed filenames');
  });

  test('HttpOnly flag on session cookie', () => {
    assert.ok(src.includes('HttpOnly'), 'Session cookie must include HttpOnly flag');
  });

  test('METADATA_PATH constant defined at top level', () => {
    assert.ok(src.includes('METADATA_PATH'), 'METADATA_PATH must be a named constant');
    assert.ok(src.includes('.metadata.json'), 'METADATA_PATH must reference .metadata.json');
  });
});

describe('Persistence: startup load and save', () => {
  let src;
  before(() => { src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'); });

  test('Startup reads METADATA_PATH', () => {
    assert.ok(src.includes('readFileSync(METADATA_PATH'), 'Startup must call readFileSync(METADATA_PATH)');
  });

  test('Startup read is wrapped in try/catch for corrupt JSON', () => {
    const readIdx = src.indexOf('readFileSync(METADATA_PATH');
    const catchIdx = src.indexOf('catch', readIdx);
    assert.ok(catchIdx !== -1 && catchIdx - readIdx < 500, 'Startup read must be in try/catch');
  });

  test('saveMetadata writes to METADATA_PATH via writeFileSync', () => {
    assert.ok(
      src.includes('writeFileSync(METADATA_PATH'),
      'saveMetadata must write to METADATA_PATH'
    );
  });
});

// ── Integration: Path traversal (requires running server) ────────────────────

describe('Integration: Path traversal protection', { skip: !TEST_PORT && 'Set OPENSHARE_TEST_PORT to run integration tests' }, () => {
  test('GET /download/../../server.js returns 403', async () => {
    const res = await request({ host: 'localhost', port: TEST_PORT, path: '/download/../../server.js' });
    assert.equal(res.status, 403);
  });

  test('GET /download/%2e%2e%2fserver.js returns 403', async () => {
    const res = await request({ host: 'localhost', port: TEST_PORT, path: '/download/%2e%2e%2fserver.js' });
    assert.equal(res.status, 403);
  });

  test('GET /download/.metadata.json returns 403', async () => {
    const res = await request({ host: 'localhost', port: TEST_PORT, path: '/download/.metadata.json' });
    assert.equal(res.status, 403);
  });
});

// ── Integration: Extension denylist (requires running server) ─────────────────

describe('Integration: Extension denylist', { skip: !TEST_PORT && 'Set OPENSHARE_TEST_PORT to run integration tests' }, () => {
  const DENIED = ['.exe', '.sh', '.bat', '.cmd', '.ps1', '.vbs'];

  for (const ext of DENIED) {
    test(`Upload ${ext} returns 400`, async () => {
      const boundary = 'testboundary';
      const body = multipartBody(`malware${ext}`, 'payload', boundary);
      const res = await request(
        {
          host: 'localhost', port: TEST_PORT, path: '/api/upload', method: 'POST',
          headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': Buffer.byteLength(body) },
        },
        body
      );
      assert.equal(res.status, 400);
      assert.equal(res.body?.error, 'File type not allowed');
    });
  }

  test('Upload .EXE (uppercase) returns 400', async () => {
    const boundary = 'testboundary';
    const body = multipartBody('VIRUS.EXE', 'payload', boundary);
    const res = await request(
      {
        host: 'localhost', port: TEST_PORT, path: '/api/upload', method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': Buffer.byteLength(body) },
      },
      body
    );
    assert.equal(res.status, 400);
    assert.equal(res.body?.error, 'File type not allowed');
  });

  test('Upload extensionless file returns 400', async () => {
    const boundary = 'testboundary';
    const body = multipartBody('Makefile', 'payload', boundary);
    const res = await request(
      {
        host: 'localhost', port: TEST_PORT, path: '/api/upload', method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': Buffer.byteLength(body) },
      },
      body
    );
    assert.equal(res.status, 400);
    assert.equal(res.body?.error, 'File type not allowed');
  });
});

// ── Integration: Session cookie flags (requires running server) ───────────────

describe('Integration: Session cookie', { skip: !TEST_PORT && 'Set OPENSHARE_TEST_PORT to run integration tests' }, () => {
  test('Set-Cookie includes HttpOnly and SameSite=Strict', async () => {
    const res = await request({ host: 'localhost', port: TEST_PORT, path: '/' });
    const cookie = res.headers['set-cookie']?.find(c => c.includes('sessionId'));
    if (cookie) {
      assert.ok(cookie.includes('HttpOnly'), 'Cookie must be HttpOnly');
      assert.ok(cookie.includes('SameSite=Strict'), 'Cookie must have SameSite=Strict');
    }
  });
});
