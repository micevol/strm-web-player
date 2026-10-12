'use strict';
const jwt = require('jsonwebtoken');
const express = require('express');
const db = require('./db');
const config = require('./config');

const ONE_DAY = 24 * 60 * 60 * 1000;

function signToken(user) {
  return jwt.sign(
    { sub: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function setCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // set to true when behind HTTPS, see README
    maxAge: ONE_DAY * 7,
  });
}

/**
 * Express middleware: require a valid session token.
 * Decoded user is attached to req.user.
 */
function requireAuth(req, res, next) {
  const token =
    (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')) ||
    req.cookies?.token;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { username: payload.sub, role: payload.role };
    return next();
  } catch (e) {
    return res.status(401).json({ error: '会话已失效，请重新登录' });
  }
}

function authRouter() {
  const r = express.Router();

  // POST /api/auth/register — create account
  r.post('/register', (req, res) => {
    if (!config.allowRegister) {
      return res.status(403).json({ error: '注册功能已关闭' });
    }
    const { username, password } = req.body || {};
    try {
      const user = db.createUser(username, password);
      const token = signToken(user);
      setCookie(res, token);
      return res.json({ ok: true, user });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  });

  // POST /api/auth/login
  r.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = db.verify(username, password);
    if (!user) return res.status(401).json({ error: '用户名或密码错误' });
    const token = signToken(user);
    setCookie(res, token);
    return res.json({ ok: true, user });
  });

  // POST /api/auth/logout
  r.post('/logout', (req, res) => {
    res.clearCookie('token');
    return res.json({ ok: true });
  });

  // GET /api/auth/me — current session info
  r.get('/me', requireAuth, (req, res) => {
    res.json({ ok: true, user: req.user });
  });

  return r;
}

module.exports = { authRouter, requireAuth };