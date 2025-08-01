const config = require('../config');
const logger = require('../utils/logger');
const { generateSecureSessionId } = require('../utils/security');

class SessionService {
  constructor() {
    this.sessions = new Map();
  }

  createSession() {
    const sessionId = generateSecureSessionId();
    const session = {
      id: sessionId,
      created: Date.now(),
      lastAccessed: Date.now(),
      files: []
    };

    this.sessions.set(sessionId, session);
    logger.info(`Session created: ${sessionId}`);
    
    return sessionId;
  }

  getSession(sessionId) {
    if (!sessionId) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Update last accessed time
    session.lastAccessed = Date.now();
    return session;
  }

  addFileToSession(sessionId, fileId) {
    const session = this.sessions.get(sessionId);
    if (session && !session.files.includes(fileId)) {
      session.files.push(fileId);
      logger.debug(`File ${fileId} added to session ${sessionId}`);
    }
  }

  removeFileFromSession(sessionId, fileId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.files = session.files.filter(id => id !== fileId);
      logger.debug(`File ${fileId} removed from session ${sessionId}`);
    }
  }

  deleteSession(sessionId) {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      logger.info(`Session deleted: ${sessionId}`);
    }
    return deleted;
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      // Clean up sessions that are old and have no files
      const isExpired = (now - session.created) > config.sessionCleanupAge;
      const hasNoFiles = session.files.length === 0;
      
      if (isExpired && hasNoFiles) {
        this.sessions.delete(sessionId);
        cleanedCount++;
        logger.debug(`Expired session cleaned up: ${sessionId}`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} expired sessions`);
    }

    return cleanedCount;
  }

  getStats() {
    const now = Date.now();
    let totalSessions = 0;
    let activeSessions = 0;
    let totalFiles = 0;

    for (const session of this.sessions.values()) {
      totalSessions++;
      totalFiles += session.files.length;
      
      // Consider session active if accessed within last hour
      if ((now - session.lastAccessed) < (60 * 60 * 1000)) {
        activeSessions++;
      }
    }

    return {
      totalSessions,
      activeSessions,
      totalFiles
    };
  }
}

module.exports = SessionService;