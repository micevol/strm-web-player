'use strict';
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');

/**
 * Minimal user store backed by a JSON file.
 * Fields per user: { username, passwordHash, createdAt, role }
 * Passwords are stored as bcrypt hashes only.
 */
const db = {
  users: [],

  _file: config.userDbPath,

  load() {
    if (this.users.length) return;
    try {
      if (fs.existsSync(this._file)) {
        const raw = fs.readFileSync(this._file, 'utf8');
        const data = JSON.parse(raw);
        this.users = Array.isArray(data.users) ? data.users : [];
      } else {
        this.users = [];
        this.save();
      }
    } catch (e) {
      console.error('[db] failed to load users:', e.message);
      this.users = [];
    }
  },

  save() {
    const dir = path.dirname(this._file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = this._file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ users: this.users }, null, 2), 'utf8');
    fs.renameSync(tmp, this._file);
  },

  findByUsername(username) {
    const n = String(username || '').trim();
    return this.users.find((u) => u.username.toLowerCase() === n.toLowerCase());
  },

  createUser(username, password) {
    const n = String(username || '').trim();
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(n)) {
      const err = new Error('用户名只能包含字母、数字、下划线、点、短横线，长度 2-32');
      err.code = 'BAD_USERNAME';
      throw err;
    }
    if (this.findByUsername(n)) {
      const err = new Error('用户名已存在');
      err.code = 'DUPLICATE';
      throw err;
    }
    if (!password || String(password).length < 6) {
      const err = new Error('密码长度至少 6 位');
      err.code = 'WEAK_PASSWORD';
      throw err;
    }
    const hash = bcrypt.hashSync(String(password), 10);
    const user = {
      username: n,
      passwordHash: hash,
      role: this.users.length === 0 ? 'admin' : 'user',
      createdAt: new Date().toISOString(),
    };
    this.users.push(user);
    this.save();
    return { username: user.username, role: user.role, createdAt: user.createdAt };
  },

  verify(username, password) {
    const user = this.findByUsername(username);
    if (!user) return null;
    if (!bcrypt.compareSync(String(password), user.passwordHash)) return null;
    return { username: user.username, role: user.role };
  },
};

db.load();

// Seed default admin if configured via env
if (config.seedAdmin && config.seedAdmin.includes(':')) {
  const [u, p] = config.seedAdmin.split(':');
  if (!db.findByUsername(u)) {
    try {
      db.createUser(u, p);
      console.log(`[db] seeded admin user "${u}"`);
    } catch (e) {
      console.error('[db] failed to seed admin:', e.message);
    }
  }
}

module.exports = db;