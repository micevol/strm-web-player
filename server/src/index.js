'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const files = require('./files');
const watcher = require('./watcher');
const strm = require('./strm');
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