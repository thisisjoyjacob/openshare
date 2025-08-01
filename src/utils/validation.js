const Joi = require('joi');
const path = require('path');

// Dynamic schema creation to avoid circular dependency
function createFileUploadSchema(maxFileSize) {
  return Joi.object({
    originalname: Joi.string().required().max(255),
    mimetype: Joi.string().required(),
    size: Joi.number().required().max(maxFileSize),
    buffer: Joi.binary().required()
  });
}

const schemas = {
  downloadRequest: Joi.object({
    filename: Joi.string().required().pattern(/^[a-f0-9]{32}\.[a-zA-Z0-9]+$/)
  })
};

function validateFile(file, maxFileSize = 1024 * 1024 * 1024) {
  const schema = createFileUploadSchema(maxFileSize);
  const { error, value } = schema.validate(file);
  if (error) {
    throw new Error(`File validation failed: ${error.details[0].message}`);
  }
  return value;
}

function validateDownloadRequest(filename) {
  const { error, value } = schemas.downloadRequest.validate({ filename });
  if (error) {
    throw new Error(`Download request validation failed: ${error.details[0].message}`);
  }
  return value;
}

function sanitizeFilename(filename) {
  // Remove path traversal attempts and dangerous characters
  return path.basename(filename).replace(/[^a-zA-Z0-9.-]/g, '_');
}

function isAllowedMimeType(mimetype, allowedTypes) {
  if (!allowedTypes || allowedTypes.length === 0) {
    return true; // Allow all if no restrictions
  }
  return allowedTypes.includes(mimetype);
}

module.exports = {
  validateFile,
  validateDownloadRequest,
  sanitizeFilename,
  isAllowedMimeType
};