'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config');
const files = require('./files');
const watcher = require('./watcher');
const strm = require('./strm');
const progress = require('./progress');
const { authRouter, requireAuth } = require('./auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---- tiny body & cookie parsers (avoid extra native deps) ----
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const raw = req.headers.cookie || '';
  req.cookies = {};
  raw.split(';').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i > -1) {
      const k = pair.slice(0, i).trim();
      const v = decodeURIComponent(pair.slice(i + 1).trim());
      req.cookies[k] = v;
    }
  });
  next();
});

// ---- API ----
app.use('/api/auth', authRouter());

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

// Browse the library tree
app.get('/api/browse', requireAuth, (req, res) => {
  res.json({ ok: true, tree: files.getTree() });
});

// ---- playback progress (per user) ----
app.get('/api/progress', requireAuth, (req, res) => {
  if (req.query.path) {
    const item = progress.getOne(req.user.username, String(req.query.path));
    return res.json({ ok: true, item: item || null });
  }
  res.json({ ok: true, progress: progress.getForUser(req.user.username) });
});

app.put('/api/progress', requireAuth, (req, res) => {
  const { path: rel, time } = req.body || {};
  if (typeof rel !== 'string' || !rel) {
    return res.status(400).json({ error: '缺少 path' });
  }
  const item = progress.set(req.user.username, rel, time);
  res.json({ ok: true, item });
});

app.delete('/api/progress', requireAuth, (req, res) => {
  const rel = req.query.path || (req.body && req.body.path);
  if (rel) progress.clear(req.user.username, String(rel));
  res.json({ ok: true });
});

// ---- subtitles (same-name sidecar files, served as WebVTT for <track>) ----
const SUB_MIME = {
  '.vtt': 'text/vtt',
  '.srt': 'text/vtt',
  '.ass': 'text/plain',
  '.ssa': 'text/plain',
  '.smi': 'text/plain',
};
function toWebVTT(content, ext) {
  if (ext !== '.vtt' && ext !== '.srt') return content;
  let text = content.replace(/^\uFEFF/, '');
  if (!/^WEBVTT/.test(text)) {
    text = 'WEBVTT\n' + text.replace(/\r?\n/g, '\n');
  }
  return text;
}

app.get('/api/subtitle/*', requireAuth, (req, res) => {
  const rel = req.params[0] || '';
  const abs = path.join(config.strmDir, rel);
  if (!abs.startsWith(path.resolve(config.strmDir))) {
    return res.status(403).json({ error: '路径越权' });
  }
  const ext = path.extname(abs).toLowerCase();
  if (!SUB_MIME[ext]) return res.status(400).json({ error: '不支持的字幕格式' });
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '字幕不存在' });
  fs.readFile(abs, 'utf8', (err, content) => {
    if (err) return res.status(500).json({ error: '读取失败' });
    res.setHeader('content-type', SUB_MIME[ext]);
    res.setHeader('cache-control', 'no-store');
    res.send(toWebVTT(content, ext));
  });
});

// Stream one strm (proxy / rewritten HLS)
app.get('/api/stream/*', requireAuth, (req, res) => {
  const rel = req.params[0] || '';
  strm.handleStrm(req, res, rel);
});

// Generic proxy used for HLS segments (auth-protected)
app.get('/api/proxy', requireAuth, (req, res) => {
  const u = req.query.u;
  if (!u) return res.status(400).json({ error: '缺少 u 参数' });
  strm.proxyUrl(req, res, u);
});

// SSE: push tree revision changes so open pages refresh instantly
app.get('/api/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\ndata: {"connected":true}\n\n');
  const ping = setInterval(() => {
    res.write(':\n\n');
  }, 15000);
  const off = watcher.onUpdate((rev) => {
    res.write(`data: ${JSON.stringify({ revision: rev })}\n\n`);
  });
  req.on('close', () => {
    clearInterval(ping);
    off();
  });
});

// ---- Static UI ----
app.use(express.static(path.join(__dirname, '..', '..', 'public')));

// ---- Error handling ----
app.use((err, req, res, next) => {
  console.error('[server] error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器内部错误' });
});

// 404 fallback for unknown /api routes
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

function start() {
  watcher.start();
  app.listen(config.port, () => {
    console.log(`strm-web-player listening on 0.0.0.0:${config.port}`);
    console.log(`strm dir: ${config.strmDir}`);
    console.log(`register enabled: ${config.allowRegister}`);
  });
}

module.exports = { app, start };

if (require.main === module) {
  start();
}