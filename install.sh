#!/bin/bash

# OpenShare Installation Script
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Banner
echo -e "${BLUE}"
echo "  ___                   ____  _                      "
echo " / _ \ _ __   ___ _ __  / ___|| |__   __ _ _ __ ___   "
echo "| | | | '_ \ / _ \ '_ \ \___ \| '_ \ / _\` | '__/ _ \  "
echo "| |_| | |_) |  __/ | | | ___) | | | | (_| | | |  __/  "
echo " \___/| .__/ \___|_| |_|____/|_| |_|\__,_|_|  \___|  "
echo "      |_|                                            "
echo -e "${NC}"
echo "Production-Ready File Sharing Platform v2.0"
echo "=============================================="
echo

# Check system requirements
log_step "Checking system requirements..."

# Check Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed. Please install Node.js 18+ first."
    echo "Visit: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    log_error "Node.js version 18+ is required. Current version: $(node -v)"
    exit 1
fi

log_info "✅ Node.js $(node -v) found"

# Check npm
if ! command -v npm &> /dev/null; then
    log_error "npm is not installed."
    exit 1
fi

log_info "✅ npm $(npm -v) found"

# Check Docker (optional)
if command -v docker &> /dev/null; then
    log_info "✅ Docker $(docker --version | cut -d' ' -f3 | cut -d',' -f1) found"
    DOCKER_AVAILABLE=true
else
    log_warn "Docker not found. Docker deployment will not be available."
    DOCKER_AVAILABLE=false
fi

# Installation options
echo
log_step "Choose installation method:"
echo "1) Development setup (with dev dependencies)"
echo "2) Production setup (production dependencies only)"
echo "3) Docker setup (requires Docker)"
echo

read -p "Enter your choice (1-3): " INSTALL_CHOICE

case $INSTALL_CHOICE in
    1)
        INSTALL_TYPE="development"
        ;;
    2)
        INSTALL_TYPE="production"
        ;;
    3)
        if [ "$DOCKER_AVAILABLE" = false ]; then
            log_error "Docker is not available. Please choose option 1 or 2."
            exit 1
        fi
        INSTALL_TYPE="docker"
        ;;
    *)
        log_error "Invalid choice. Please run the script again."
        exit 1
        ;;
esac

# Install dependencies
log_step "Installing dependencies..."

if [ "$INSTALL_TYPE" = "development" ]; then
    npm install
    log_info "✅ Development dependencies installed"
elif [ "$INSTALL_TYPE" = "production" ]; then
    npm ci --only=production
    log_info "✅ Production dependencies installed"
fi

# Setup environment
log_step "Setting up environment..."

if [ ! -f .env ]; then
    cp .env.example .env
    log_info "✅ Environment file created from template"
    
    # Generate secure session secret
    SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    
    # Update .env file with secure secret
    if command -v sed &> /dev/null; then
        sed -i.bak "s/your-super-secure-secret-key-here/$SESSION_SECRET/" .env
        rm .env.bak 2>/dev/null || true
        log_info "✅ Secure session secret generated"
    else
        log_warn "Please manually set SESSION_SECRET in .env file"
    fi
else
    log_info "✅ Environment file already exists"
fi

# Create directories
log_step "Creating directories..."
mkdir -p uploads logs backups
log_info "✅ Directories created"

# Docker setup
if [ "$INSTALL_TYPE" = "docker" ]; then
    log_step "Setting up Docker..."
    
    if [ ! -f docker-compose.yml ]; then
        log_error "docker-compose.yml not found"
        exit 1
    fi
    
    # Build and start containers
    docker-compose up -d --build
    
    # Wait for service to be ready
    log_info "Waiting for service to start..."
    sleep 10
    
    # Health check
    if curl -f http://localhost:4001/health > /dev/null 2>&1; then
        log_info "✅ Docker setup completed successfully"
    else
        log_error "❌ Service health check failed"
        docker-compose logs
        exit 1
    fi
fi

# Run tests (if development)
if [ "$INSTALL_TYPE" = "development" ]; then
    log_step "Running tests..."
    if npm test; then
        log_info "✅ All tests passed"
    else
        log_warn "⚠️  Some tests failed. Check the output above."
    fi
fi

# Final setup
log_step "Final setup..."

# Make scripts executable
if command -v chmod &> /dev/null; then
    chmod +x scripts/*.sh 2>/dev/null || true
    log_info "✅ Scripts made executable"
fi

# Installation complete
echo
echo -e "${GREEN}🎉 OpenShare installation completed successfully!${NC}"
echo
echo "Next steps:"
echo "==========="

if [ "$INSTALL_TYPE" = "docker" ]; then
    echo "• Your application is running at: http://localhost:4001"
    echo "• Health check: http://localhost:4001/health"
    echo "• View logs: docker-compose logs -f"
    echo "• Stop service: docker-compose down"
else
    echo "• Review and customize .env file if needed"
    echo "• Start development server: npm run dev"
    echo "• Start production server: npm start"
    echo "• Run tests: npm test"
    echo "• Deploy with Docker: ./scripts/deploy.sh"
fi

echo
echo "Documentation:"
echo "• README.md - Complete documentation"
echo "• Health endpoint: /health"
echo "• API documentation in README.md"
echo
echo "Support:"
echo "• GitHub Issues: https://github.com/thisisjoyjacob/openshare/issues"
echo "• Documentation: https://github.com/thisisjoyjacob/openshare"
echo

log_info "Happy file sharing! 🚀"