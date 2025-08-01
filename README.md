# 📂 OpenShare – Production-Ready File Sharing Platform

**OpenShare v2.0** is a secure, lightweight, and scalable file sharing platform built with privacy and security in mind. Designed for production environments, teams, and individuals who need reliable temporary file sharing.

🔗 **GitHub Repo:** [github.com/thisisjoyjacob/openshare](https://github.com/thisisjoyjacob/openshare)  
🌐 **Live Demo:** [openshare.thisisjoyjacob.in](https://openshare.thisisjoyjacob.in)

---

## ✨ Features

### Core Features
- ⚡ **Drag & Drop Uploads** – Intuitive UI with real-time progress
- 🔒 **Security First** – Rate limiting, input validation, secure headers
- 🔗 **One-click Share Links** – Generate unique download URLs
- 🗑️ **Auto Expiry & Cleanup** – Configurable expiry times with automatic cleanup
- 📱 **PWA Support** – Install as mobile/desktop app
- 🌙 **Dark/Light Theme** – Automatic theme detection with manual toggle

### Production Features
- 🛡️ **Enterprise Security** – Helmet.js, CORS, CSP headers
- 📊 **Health Monitoring** – Built-in health checks and metrics
- 🚀 **Performance Optimized** – Compression, caching, streaming
- 📝 **Comprehensive Logging** – Winston-based structured logging
- 🔄 **Graceful Shutdown** – Proper cleanup on termination
- 🧪 **Test Coverage** – Jest-based test suite
- 🐳 **Production Docker** – Multi-stage, security-hardened containers

---

## 🚀 Quick Start

### Using Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/thisisjoyjacob/openshare.git
cd openshare

# Start with Docker Compose
docker-compose up -d

# Access at http://localhost:4001
```

### Manual Installation

```bash
# Clone and install
git clone https://github.com/thisisjoyjacob/openshare.git
cd openshare
npm install

# Configure environment
cp .env.example .env
# Edit .env with your settings

# Start the server
npm start

# For development
npm run dev
```

---

## 🛠️ Tech Stack

- **Backend**: Node.js + Express.js
- **Frontend**: Vanilla HTML/CSS/JavaScript + Tailwind CSS
- **Storage**: Local filesystem (configurable)
- **Security**: Helmet.js, rate limiting, input validation
- **Logging**: Winston with structured logging
- **Testing**: Jest + Supertest
- **Containerization**: Docker with multi-architecture support
- **CI/CD**: GitHub Actions with automated testing

---

## ⚙️ Configuration

### Environment Variables

```bash
# Server Configuration
PORT=4001                    # Server port
HOST=0.0.0.0                # Bind address
NODE_ENV=production          # Environment mode

# File Configuration
UPLOAD_DIR=./uploads         # Upload directory
MAX_FILE_SIZE=1073741824     # Max file size (1GB)
FILE_EXPIRY=14400000         # File expiry (4 hours)
ALLOWED_MIME_TYPES=          # Comma-separated MIME types (empty = all)

# Security Configuration
SESSION_SECRET=your-secret   # Session secret (REQUIRED in production)
RATE_LIMIT_WINDOW=900000     # Rate limit window (15 minutes)
RATE_LIMIT_MAX=10           # Max uploads per window

# Logging Configuration
LOG_LEVEL=info              # Log level (error, warn, info, debug)
LOG_FILE=logs/openshare.log # Log file path

# CORS Configuration
CORS_ORIGIN=*               # CORS origin (* for all)
```

### Docker Configuration

```yaml
# docker-compose.yml
version: '3.8'
services:
  openshare:
    image: thisisjoyjacob/openshare:v2.0
    ports:
      - "4001:4001"
    environment:
      - NODE_ENV=production
      - SESSION_SECRET=your-super-secure-secret
    volumes:
      - ./uploads:/usr/src/app/uploads
      - ./logs:/usr/src/app/logs
    restart: unless-stopped
```

---

## 🔒 Security Features

### Built-in Security
- **Rate Limiting** – Prevents abuse with configurable limits
- **Input Validation** – Joi-based validation for all inputs
- **Path Sanitization** – Prevents directory traversal attacks
- **Secure Headers** – CSP, HSTS, X-Frame-Options, etc.
- **Session Security** – Secure, HTTP-only cookies
- **File Type Validation** – Configurable MIME type restrictions

### Security Headers
```javascript
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
```

---

## 📊 Monitoring & Health Checks

### Health Endpoint
```bash
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "memory": { "rss": 50331648, "heapTotal": 20971520 },
  "files": { "totalFiles": 5, "activeFiles": 3 },
  "sessions": { "totalSessions": 10, "activeSessions": 3 },
  "version": "2.0.0"
}
```

### Logging
- **Structured JSON logs** with Winston
- **Request/response logging** with correlation IDs
- **Error tracking** with stack traces
- **Performance metrics** and timing data

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run linting
npm run lint
```

### Test Coverage
- Unit tests for all services
- Integration tests for API endpoints
- Security validation tests
- Error handling tests

---

## 🚀 Deployment

### Production Checklist

- [ ] Set `SESSION_SECRET` environment variable
- [ ] Configure `NODE_ENV=production`
- [ ] Set up log rotation
- [ ] Configure reverse proxy (nginx/Apache)
- [ ] Set up SSL/TLS certificates
- [ ] Configure firewall rules
- [ ] Set up monitoring and alerting
- [ ] Configure backup strategy

### Docker Deployment

```bash
# Build production image
docker build -t openshare:production .

# Run with production settings
docker run -d \
  --name openshare \
  -p 4001:4001 \
  -e NODE_ENV=production \
  -e SESSION_SECRET=your-secret \
  -v $(pwd)/uploads:/usr/src/app/uploads \
  -v $(pwd)/logs:/usr/src/app/logs \
  --restart unless-stopped \
  openshare:production
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openshare
spec:
  replicas: 3
  selector:
    matchLabels:
      app: openshare
  template:
    metadata:
      labels:
        app: openshare
    spec:
      containers:
      - name: openshare
        image: thisisjoyjacob/openshare:v2.0
        ports:
        - containerPort: 4001
        env:
        - name: NODE_ENV
          value: "production"
        - name: SESSION_SECRET
          valueFrom:
            secretKeyRef:
              name: openshare-secret
              key: session-secret
        volumeMounts:
        - name: uploads
          mountPath: /usr/src/app/uploads
        - name: logs
          mountPath: /usr/src/app/logs
      volumes:
      - name: uploads
        persistentVolumeClaim:
          claimName: openshare-uploads
      - name: logs
        persistentVolumeClaim:
          claimName: openshare-logs
```

---

## 🔧 API Documentation

### Upload File
```bash
POST /api/upload
Content-Type: multipart/form-data

# Response
{
  "message": "File uploaded successfully",
  "fileId": "abc123...",
  "downloadLink": "https://your-domain.com/download/abc123.pdf",
  "expiryTime": 1640995200000
}
```

### Get User Files
```bash
GET /api/files

# Response
[
  {
    "id": "abc123...",
    "originalName": "document.pdf",
    "size": 1048576,
    "uploadTime": 1640991600000,
    "expiryTime": 1640995200000,
    "downloadLink": "/download/abc123.pdf"
  }
]
```

### Download File
```bash
GET /download/:filename
# Streams file and deletes after download
```

### Reset Session
```bash
POST /api/reset-session
# Deletes all user files and creates new session
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
# Clone and install
git clone https://github.com/thisisjoyjacob/openshare.git
cd openshare
npm install

# Start development server
npm run dev

# Run tests
npm test
```

---

## 📄 License

This project is licensed under the Apache-2.0 License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with security and privacy in mind
- Inspired by the need for simple, temporary file sharing
- Thanks to all contributors and the open-source community

---

## 📞 Support

- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/thisisjoyjacob/openshare/issues)
- 💡 **Feature Requests**: [GitHub Discussions](https://github.com/thisisjoyjacob/openshare/discussions)
- 📧 **Security Issues**: Please report privately to the maintainers

---

**OpenShare v2.0** - Secure, reliable, production-ready file sharing. 🚀