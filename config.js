'use strict';

module.exports = {
  // Pagination
  PAGE_SIZE: 5,

  // Auth
  BCRYPT_ROUNDS: 10,

  // Session
  SESSION_MAX_AGE: 7 * 24 * 60 * 60 * 1000, // 7 days in ms

  // Soft-delete undo window (used in SQL INTERVAL)
  SOFT_DELETE_PURGE_INTERVAL: '1 hour',

  // Rate limiting (login / register)
  AUTH_RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  AUTH_RATE_LIMIT_MAX: 20,                    // max attempts per window

  // Event field limits
  EVENT_NAME_MAX: 100,
  EVENT_DESC_MAX: 500,

  // Dashboard pagination
  DASHBOARD_PAGE_SIZE: 10,

  // Update content limit
  UPDATE_CONTENT_MAX: 254,

  // Email verification token lifetime (24 hours)
  EMAIL_VERIFICATION_EXPIRY_MS: 24 * 60 * 60 * 1000,

  // Password reset token lifetime (1 hour)
  PASSWORD_RESET_EXPIRY_MS: 60 * 60 * 1000,
};
