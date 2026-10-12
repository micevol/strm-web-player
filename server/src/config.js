'use strict';
const path = require('path');

/**
 * Centralized configuration loaded from environment variables.
 * All knobs are configurable via docker-compose / env for flexibility.
 */
module.exports = {
  // Directory that holds the .strm files (mounted into the container)
  strmDir: process.env.STRM_DIR || '/data/strm',

  // Port the HTTP server listens on (inside the container)
  port: parseInt(process.env.PORT || '3000', 10),

  // Secret used to sign JWT session tokens. Auto-generate a strong one
  // if not provided, but persists across restarts is preferable via env.
  jwtSecret: process.env.JWT_SECRET || require('crypto').randomBytes(48).toString('hex'),

  // How long a login session stays valid (e.g. "7d")
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // File that stores registered user accounts
  userDbPath: process.env.USER_DB_PATH || path.join('/data', 'users.json'),

  // Seed a default admin on first boot (format "username:password")
  seedAdmin: process.env.SEED_ADMIN || '',

  // Whether open self-registration is allowed (user asked for it -> default true)
  allowRegister: process.env.ALLOW_REGISTER !== 'false',

  // Polling fallback interval (ms) when native fs watching is unavailable
  pollInterval: parseInt(process.env.POLL_INTERVAL || '5000', 10),

  // Allowed remote hosts/files to stream — 'any' allows any URL inside strm.
  // Advanced: you can later restrict via ALLOWED_HOSTS (comma separated).
  allowedHosts: (process.env.ALLOWED_HOSTS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // HTTP client request timeout for upstream (ms)
  upstreamTimeout: parseInt(process.env.UPSTREAM_TIMEOUT || '30000', 10),
};