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
      subtitles: findSubtitles(absPath, relPath), // same-basename .srt/.vtt/.ass/...
    };
  }
  return null;
}

const SUB_EXTS = ['.srt', '.vtt', '.ass', '.ssa', '.smi'];

/** Find subtitle files next to a strm (same stem, e.g. movie.strm + movie.srt).
 *  Also matches when the strm keeps a media suffix (movie.mp4.strm) and the
 *  subtitle only has the movie name (movie.srt) or full name (movie.mp4.srt). */
const MEDIA_EXTS = ['.mp4', '.mkv', '.avi', '.ts', '.m2ts', '.mov', '.webm', '.flv', '.wmv', '.rmvb', '.mpg', '.mpeg'];
function findSubtitles(fileAbs, fileRel) {
  const dirAbs = path.dirname(fileAbs);
  const dirRel = path.dirname(fileRel); // posix-style already (leading '/')
  const base = path.basename(fileAbs);
  const stem = base.replace(/\.strm$/i, '');
  // also derive the "media-less" stem: movie.mp4 -> movie
  let stem2 = stem;
  const me = MEDIA_EXTS.find((e) => stem.toLowerCase().endsWith(e));
  if (me) stem2 = stem.slice(0, -me.length);
  const stems = new Set([stem, stem2].filter(Boolean));
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const en of entries) {
    if (!en.isFile()) continue;
    const ext = path.extname(en.name).toLowerCase();
    if (!SUB_EXTS.includes(ext)) continue;
    const bare = path.basename(en.name, ext);
    const match = [...stems].some((s) => bare === s || bare === `${s}.zh` || bare === `${s}.zh_CN` || bare === `${s}.chs`);
    if (match) out.push((dirRel === '/' ? '' : dirRel) + '/' + en.name);
  }
  return out.sort();
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