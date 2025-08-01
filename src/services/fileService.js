const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { generateUniqueId, sanitizePath } = require('../utils/security');
const { validateFile, sanitizeFilename, isAllowedMimeType } = require('../utils/validation');

class FileService {
  constructor() {
    this.fileDatabase = new Map();
    this.ensureUploadDir();
  }

  async ensureUploadDir() {
    try {
      await fs.mkdir(config.uploadDir, { recursive: true });
      logger.info(`Upload directory ensured: ${config.uploadDir}`);
    } catch (error) {
      logger.error('Failed to create upload directory:', error);
      throw error;
    }
  }

  async uploadFile(file, sessionId) {
    try {
      // Validate file with configurable size limit
      validateFile(file, config.maxFileSize);
      
      // Check MIME type if restrictions are set
      if (!isAllowedMimeType(file.mimetype, config.allowedMimeTypes)) {
        throw new Error(`File type ${file.mimetype} is not allowed`);
      }

      // Generate unique identifiers
      const fileId = generateUniqueId();
      const sanitizedName = sanitizeFilename(file.originalname);
      const fileExtension = path.extname(sanitizedName);
      const uniqueFilename = `${fileId}${fileExtension}`;
      const filePath = path.join(config.uploadDir, uniqueFilename);

      // Save file to disk
      await fs.writeFile(filePath, file.buffer);

      // Store metadata
      const metadata = {
        id: fileId,
        originalName: sanitizedName,
        filename: uniqueFilename,
        mimetype: file.mimetype,
        size: file.size,
        uploadTime: Date.now(),
        expiryTime: Date.now() + config.fileExpiry,
        sessionId: sessionId,
        downloaded: false,
        filePath: filePath
      };

      this.fileDatabase.set(fileId, metadata);

      logger.info(`File uploaded successfully: ${fileId} (${sanitizedName})`);

      return {
        fileId,
        originalName: sanitizedName,
        size: file.size,
        uploadTime: metadata.uploadTime,
        expiryTime: metadata.expiryTime,
        downloadLink: `/download/${uniqueFilename}`
      };

    } catch (error) {
      logger.error('File upload failed:', error);
      throw error;
    }
  }

  async getFile(filename) {
    try {
      const sanitizedFilename = sanitizePath(filename);
      const fileId = path.basename(sanitizedFilename, path.extname(sanitizedFilename));
      
      const metadata = this.fileDatabase.get(fileId);
      if (!metadata) {
        throw new Error('File not found');
      }

      // Check if file has expired
      if (Date.now() > metadata.expiryTime) {
        await this.deleteFile(fileId);
        throw new Error('File has expired');
      }

      // Check if file exists on disk
      try {
        await fs.access(metadata.filePath);
      } catch {
        this.fileDatabase.delete(fileId);
        throw new Error('File not found on disk');
      }

      return metadata;

    } catch (error) {
      logger.error(`Failed to get file ${filename}:`, error);
      throw error;
    }
  }

  async deleteFile(fileId) {
    try {
      const metadata = this.fileDatabase.get(fileId);
      if (!metadata) {
        return false;
      }

      // Delete file from disk
      try {
        await fs.unlink(metadata.filePath);
        logger.info(`File deleted from disk: ${metadata.filename}`);
      } catch (error) {
        logger.warn(`Failed to delete file from disk: ${metadata.filename}`, error);
      }

      // Remove from database
      this.fileDatabase.delete(fileId);
      logger.info(`File metadata removed: ${fileId}`);

      return true;
    } catch (error) {
      logger.error(`Failed to delete file ${fileId}:`, error);
      return false;
    }
  }

  getSessionFiles(sessionId) {
    const sessionFiles = [];
    
    for (const [fileId, metadata] of this.fileDatabase.entries()) {
      if (metadata.sessionId === sessionId && Date.now() <= metadata.expiryTime) {
        sessionFiles.push({
          id: fileId,
          originalName: metadata.originalName,
          size: metadata.size,
          uploadTime: metadata.uploadTime,
          expiryTime: metadata.expiryTime,
          downloadLink: `/download/${metadata.filename}`
        });
      }
    }

    return sessionFiles;
  }

  async cleanupExpiredFiles() {
    const now = Date.now();
    const expiredFiles = [];

    // First pass: identify expired files (fast)
    for (const [fileId, metadata] of this.fileDatabase.entries()) {
      if (now > metadata.expiryTime) {
        expiredFiles.push(fileId);
      }
    }

    if (expiredFiles.length === 0) {
      return 0;
    }

    // Second pass: delete expired files in batches
    const batchSize = 10;
    let cleanedCount = 0;

    for (let i = 0; i < expiredFiles.length; i += batchSize) {
      const batch = expiredFiles.slice(i, i + batchSize);
      
      // Process batch concurrently but with limit
      const deletePromises = batch.map(fileId => 
        this.deleteFile(fileId).catch(error => {
          logger.error(`Failed to delete expired file ${fileId}:`, error);
          return false;
        })
      );

      const results = await Promise.all(deletePromises);
      cleanedCount += results.filter(Boolean).length;

      // Small delay between batches to avoid overwhelming the system
      if (i + batchSize < expiredFiles.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} expired files`);
    }

    return cleanedCount;
  }

  getStats() {
    const now = Date.now();
    let totalFiles = 0;
    let totalSize = 0;
    let expiredFiles = 0;

    for (const metadata of this.fileDatabase.values()) {
      totalFiles++;
      totalSize += metadata.size;
      
      if (now > metadata.expiryTime) {
        expiredFiles++;
      }
    }

    return {
      totalFiles,
      totalSize,
      expiredFiles,
      activeFiles: totalFiles - expiredFiles
    };
  }
}

module.exports = FileService;