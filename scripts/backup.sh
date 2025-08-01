#!/bin/bash

# OpenShare Backup Script
set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="openshare_backup_$TIMESTAMP"

echo "🔄 Starting OpenShare backup..."

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create backup archive
tar -czf "$BACKUP_DIR/$BACKUP_NAME.tar.gz" \
    --exclude='node_modules' \
    --exclude='backups' \
    --exclude='.git' \
    .

echo "✅ Backup created: $BACKUP_DIR/$BACKUP_NAME.tar.gz"

# Keep only last 5 backups
cd "$BACKUP_DIR"
ls -t openshare_backup_*.tar.gz | tail -n +6 | xargs -r rm

echo "🧹 Old backups cleaned up"
echo "📦 Available backups:"
ls -la openshare_backup_*.tar.gz 2>/dev/null || echo "No backups found"