#!/bin/bash

# OpenShare Production Deployment Script
set -e

echo "🚀 Starting OpenShare deployment..."

# Configuration
IMAGE_NAME="thisisjoyjacob/openshare:v2.0"
CONTAINER_NAME="openshare-prod"
PORT="4001"
UPLOAD_DIR="./uploads"
LOGS_DIR="./logs"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

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

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    log_warn ".env file not found. Creating from .env.example..."
    cp .env.example .env
    log_warn "Please edit .env file with your production settings before continuing."
    read -p "Press Enter to continue after editing .env file..."
fi

# Check SESSION_SECRET
if grep -q "your-super-secure-secret-key-here" .env; then
    log_error "Please set a secure SESSION_SECRET in .env file!"
    exit 1
fi

# Create directories
log_info "Creating directories..."
mkdir -p "$UPLOAD_DIR" "$LOGS_DIR"

# Stop existing container if running
if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
    log_info "Stopping existing container..."
    docker stop "$CONTAINER_NAME"
    docker rm "$CONTAINER_NAME"
fi

# Pull latest image
log_info "Pulling latest image..."
docker pull "$IMAGE_NAME"

# Run container
log_info "Starting OpenShare container..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$PORT:4001" \
    --env-file .env \
    -v "$(pwd)/$UPLOAD_DIR:/usr/src/app/uploads" \
    -v "$(pwd)/$LOGS_DIR:/usr/src/app/logs" \
    --restart unless-stopped \
    "$IMAGE_NAME"

# Wait for container to start
log_info "Waiting for container to start..."
sleep 5

# Health check
log_info "Performing health check..."
if curl -f "http://localhost:$PORT/health" > /dev/null 2>&1; then
    log_info "✅ OpenShare is running successfully!"
    log_info "🌐 Access your application at: http://localhost:$PORT"
    log_info "📊 Health check: http://localhost:$PORT/health"
else
    log_error "❌ Health check failed. Check container logs:"
    docker logs "$CONTAINER_NAME"
    exit 1
fi

# Show container info
log_info "Container information:"
docker ps -f name="$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

log_info "🎉 Deployment completed successfully!"
log_info "📝 View logs with: docker logs -f $CONTAINER_NAME"
log_info "🛑 Stop with: docker stop $CONTAINER_NAME"