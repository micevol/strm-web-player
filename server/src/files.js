'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Maintains an in-memory tree of the STRM directory.
 * The watcher calls invalidate() whenever a file changes; clients query
 * /api/browse to get the latest tree and receive SSE push on updates.
 *
 * Tree node:
 *   { type:'dir', name, path, children:[...] }
 *   { type:'file', name, path, ext }
 * Only .strm files are surfaced (other asset files can be referenced later).
 */
let tree = null;
let revision = 0;

function isStrm(name) {
  return /\.strm$/i.test(name) && !/^\./.test(name);
}

// Don't descend into hidden/irrelevant directories
function shouldSkipDir(name) {
  return name.startsWith('.');
}

function buildNode(absPath, relPath, isRoot = false) {
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch (e) {
    return null;
  }
  if (stat.isDirectory()) {
    const name = path.basename(absPath);
    if (!isRoot && shouldSkipDir(name)) return null; // don't skip the root dir
    const children = [];
    let entries;
    try {
      entries = fs.readdirSync(absPath, { withFileTypes: true });
    } catch (e) {
      entries = [];
    }
    for (const en of entries) {
      const child = buildNode(path.join(absPath, en.name), `${relPath}/${en.name}`);
      if (child) children.push(child);
    }
    // sort: dirs first, then files, alphabetical
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    return { type: 'dir', name, path: relPath, children };
  } else if (isStrm(relPath || absPath)) {
    return {
      type: 'file',
      name: path.basename(absPath),
      path: relPath,
      ext: path.extname(absPath),
    };
  }
  return null;
}

function recompute() {
  if (!fs.existsSync(config.strmDir)) {
    try {
      fs.mkdirSync(config.strmDir, { recursive: true });
    } catch (e) { /* ignore */ }
  }
  tree = buildNode(config.strmDir, '', true);
  if (!tree) tree = { type: 'dir', name: '', path: '', children: [] };
  tree.name = tree.name || '影视库';
  tree.path = tree.path || '';
  tree.revision = ++revision;
  return tree;
}

function getTree() {
  if (!tree) recompute();
  return tree;
}

/** Flatten all .strm relative paths under a given rel dir ('' = root). */
function flattenFiles(node, acc = []) {
  if (node.type === 'file') {
    acc.push(node.path);
  } else if (node.children) {
    for (const c of node.children) flattenFiles(c, acc);
  }
  return acc;
}

function touch() {
  revision++;
  return revision;
}

module.exports = { getTree, recompute, flattenFiles, touch, revision: () => revision, isStrm };