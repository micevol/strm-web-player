'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const files = require('./files');

/**
 * Change tracker:
 *  - Prefers chokidar for reliable recursive watching.
 *  - Falls back to a lightweight polling loop if chokidar is unavailable.
 *
 * On any change to .strm files it recomputes the in-memory tree and notifies
 * subscribers via callbacks (used to broadcast SSE to open clients).
 */

let watcher = null;
let closed = false;
let fallbackTimer = null;

const subscribers = new Set();
function onUpdate(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}
function broadcast() {
  const rev = files.touch();
  for (const fn of [...subscribers]) {
    try {
      fn(rev);
    } catch (e) { /* ignore a single bad listener */ }
  }
}

function applyChange(pathname, ev) {
  if (files.isStrm(pathname)) {
    files.recompute();
    broadcast();
  }
}

async function startWithChokidar() {
  let chokidar;
  try {
    chokidar = require('chokidar');
  } catch (e) {
    return null;
  }
  if (!fs.existsSync(config.strmDir)) fs.mkdirSync(config.strmDir, { recursive: true });

  watcher = chokidar.watch(config.strmDir, {
    persistent: true,
    ignoreInitial: true,
    ignored: (p) => /(^|[\/\\])\../.test(p), // skip hidden
    depth: 20,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher
    .on('add', (p) => applyChange(p, 'add'))
    .on('change', (p) => applyChange(p, 'change'))
    .on('unlink', (p) => applyChange(p, 'unlink'))
    .on('addDir', () => applyChange('', 'addDir'))
    .on('unlinkDir', () => applyChange('', 'unlinkDir'))
    .on('error', (err) => console.error('[watcher] chokidar error:', err.message));

  return watcher;
}

function startFallbackPolling() {
  let lastMtimes = new Map();
  const scan = () => {
    if (!fs.existsSync(config.strmDir)) return;
    const snapshot = walkMtimes(config.strmDir);
    let changed = false;
    const keys = new Set([...lastMtimes.keys(), ...snapshot.keys()]);
    for (const k of keys) {
      if (lastMtimes.get(k) !== snapshot.get(k)) {
        changed = true;
        break;
      }
    }
    if (changed) {
      lastMtimes = snapshot;
      files.recompute();
      broadcast();
    }
  };
  // initial
  files.recompute();
  lastMtimes = walkMtimes(config.strmDir);
  fallbackTimer = setInterval(scan, config.pollInterval);
  fallbackTimer.unref && fallbackTimer.unref();
}

function walkMtimes(dir, map = new Map()) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return map;
  }
  for (const en of entries) {
    if (en.name.startsWith('.')) continue;
    const p = path.join(dir, en.name);
    try {
      const st = fs.statSync(p);
      map.set(p, st.mtimeMs);
      if (st.isDirectory()) walkMtimes(p, map);
    } catch (e) { /* ignore */ }
  }
  return map;
}

function start() {
  files.recompute();
  startWithChokidar().then((w) => {
    if (closed) return;
    if (!w) {
      console.log('[watcher] chokidar unavailable, using polling fallback');
      startFallbackPolling();
    } else {
      console.log('[watcher] watching via chokidar:', config.strmDir);
    }
  });
}

function stop() {
  closed = true;
  if (fallbackTimer) clearInterval(fallbackTimer);
  if (watcher && typeof watcher.close === 'function') watcher.close();
}

module.exports = { start, stop, onUpdate, applyChange };