'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const config = require('./config');

const MIME = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
};

function mimeFor(urlStr) {
  try {
    const p = new URL(urlStr).pathname.toLowerCase();
    const ext = path.extname(p).replace('.', '');
    return MIME[ext] || 'application/octet-stream';
  } catch (e) {
    return 'application/octet-stream';
  }
}

function isHls(urlStr) {
  return /\.m3u8($|\?)/i.test(urlStr);
}

/**
 * Parse the content of a .strm file and return the first remote URL.
 * Supports both single-line URLs and m3u8 playlist (skip #EXT... metadata lines).
 */
function parseStrm(content) {
  if (typeof content !== 'string' || !content.trim()) return null;
  const text = content.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('#')) continue; // skip m3u8 tags
    if (/^https?:\/\//i.test(line)) return line;
  }
  return null;
}

function readStrm(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function hostAllowed(host) {
  if (config.allowedHosts.includes('*')) return true;
  return config.allowedHosts.some((h) => {
    const hh = h.replace(/^\./, '');
    return host === hh || host.endsWith('.' + hh);
  });
}

/**
 * Generic streaming proxy for an absolute upstream URL.
 * Forwards Range requests and pipes the response body.
 */
function proxyUrl(req, res, urlStr) {
  let u;
  try {
    u = new URL(urlStr);
  } catch (e) {
    return res.status(400).json({ error: '非法 URL' });
  }
  if (!/^https?:$/.test(u.protocol) || !hostAllowed(u.hostname)) {
    return res.status(403).json({ error: '目标地址不在允许列表内' });
  }

  const lib = u.protocol === 'https:' ? https : http;
  const options = {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search,
    method: req.method || 'GET',
    headers: {
      'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 strm-web-player',
      referer: req.headers['referer'] || u.origin + '/',
      ...(req.headers.range ? { range: req.headers.range } : {}),
      ...(req.headers['accept'] ? { accept: req.headers['accept'] } : {}),
    },
    timeout: config.upstreamTimeout,
    maxHeaderSize: 64 * 1024,
  };

  const upstream = lib.request(options, (upRes) => {
    res.statusCode = upRes.statusCode || 200;
    res.setHeader('content-type', upRes.headers['content-type'] || mimeFor(urlStr));
    ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control']
      .forEach((h) => {
        if (upRes.headers[h]) res.setHeader(h, upRes.headers[h]);
      });
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('x-accel-buffering', 'no');
    // Never cache client-side streams by default (can be tuned via query ?cache=1)
    const qs = (req.url || '').split('?')[1] || '';
    if (!/(?:^|[?&])cache=1(?:&|$)/.test(qs)) {
      res.setHeader('cache-control', 'no-store');
    }
    upRes.pipe(res);
  });

  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: '上游请求失败: ' + err.message });
    } else {
      res.end();
    }
  });

  upstream.end();
}

/**
 * Fetch upstream (used to rewrite HLS playlists) and return text.
 */
function fetchText(urlStr, timeout = config.upstreamTimeout) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return reject(new Error('非法 URL'));
    }
    if (!hostAllowed(u.hostname)) return reject(new Error('目标地址不在允许列表内'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
          'user-agent': 'Mozilla/5.0 strm-web-player',
          referer: u.origin + '/',
          accept: '*/*',
        },
        timeout,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error('上游返回 ' + res.statusCode));
          }
          resolve(data);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('上游超时')));
    req.end();
  });
}

/**
 * Rewrite an HLS playlist so every segment URL goes through our auth proxy.
 */
async function rewritePlaylist(playlistText, baseUrl) {
  const lines = playlistText.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      out.push(line);
      continue;
    }
    try {
      const abs = new URL(t, baseUrl).toString();
      const proxied = '/api/proxy?u=' + encodeURIComponent(abs);
      out.push(proxied);
    } catch (e) {
      out.push(line);
    }
  }
  return out.join('\n');
}

async function handleStrm(req, res, strmFileRel) {
  const absPath = path.join(config.strmDir, strmFileRel);
  if (!absPath.startsWith(path.resolve(config.strmDir))) {
    return res.status(403).json({ error: '路径越权' });
  }
  if (!fs.existsSync(absPath)) {
    return res.status(404).json({ error: 'strm 文件不存在' });
  }
  const content = readStrm(absPath);
  const url = parseStrm(content);
  if (!url) {
    return res.status(422).json({ error: 'strm 内容没有可识别的 URL' });
  }

  // HLS: fetch + rewrite relative segments to our proxy
  if (isHls(url)) {
    try {
      const pl = await fetchText(url);
      const rewritten = await rewritePlaylist(pl, url);
      res.setHeader('content-type', MIME.m3u8);
      res.setHeader('cache-control', 'no-store');
      return res.send(rewritten);
    } catch (e) {
      // fall back to redirect (direct access) if rewrite fails
      return res.redirect(url);
    }
  }

  // Direct media: stream with Range support
  return proxyUrl(req, res, url);
}

module.exports = { parseStrm, mimeFor, isHls, hostAllowed, proxyUrl, fetchText, rewritePlaylist, handleStrm };