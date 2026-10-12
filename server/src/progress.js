'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Playback progress store, keyed by user -> strm relative path.
 * data = { "<username>": { "<strm rel path>": { time, updatedAt } } }
 * Persisted to a JSON file so it survives container restarts.
 */
let data = {};

function load() {
  try {
    if (fs.existsSync(config.progressPath)) {
      data = JSON.parse(fs.readFileSync(config.progressPath, 'utf8')) || {};
    } else {
      data = {};
      save();
    }
  } catch (e) {
    console.error('[progress] failed to load:', e.message);
    data = {};
  }
}

function save() {
  const dir = path.dirname(config.progressPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = config.progressPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, config.progressPath);
}

/** All progress entries for a user: { relPath: {time, updatedAt} } */
function getForUser(username) {
  return data[username] || {};
}

/** Single entry for user+rel, or null. */
function getOne(username, rel) {
  const user = data[username];
  return user && user[rel] ? user[rel] : null;
}

/** Save a position (seconds). Persists immediately (writes are small). */
function set(username, rel, time) {
  if (!data[username]) data[username] = {};
  data[username][rel] = {
    time: Math.max(0, Number(time) || 0),
    updatedAt: Date.now(),
  };
  save();
  return data[username][rel];
}

/** Remove one entry (e.g. when playback finished). */
function clear(username, rel) {
  if (data[username] && data[username][rel] != null) {
    delete data[username][rel];
    save();
  }
}

load();

module.exports = { getForUser, getOne, set, clear };