'use strict';

const crypto = require('node:crypto');

const COOKIE = 'pd_session';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createAuth(cfg) {
  const secret = cfg.sessionSecret;
  const attempts = new Map(); // ip -> [timestamps]

  function roleForCode(code) {
    if (cfg.approverCode && safeEqual(code, cfg.approverCode)) return 'approver';
    if (cfg.teamCode && safeEqual(code, cfg.teamCode)) return 'team';
    return null;
  }

  function tooManyAttempts(ip) {
    const now = Date.now();
    const recent = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
    attempts.set(ip, recent);
    return recent.length >= 10;
  }

  function recordFailure(ip) {
    attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);
  }

  function issue(res, { name, role }, secure) {
    const payload = b64(JSON.stringify({ name, role, exp: Date.now() + MAX_AGE_MS }));
    const value = `${payload}.${sign(secret, payload)}`;
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}${secure ? '; Secure' : ''}`,
    );
  }

  function clear(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  /** Express middleware: sets req.user and req.csrf when the cookie is valid. */
  function middleware(req, _res, next) {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    req.user = null;
    if (raw) {
      const [payload, sig] = raw.split('.');
      if (payload && sig && safeEqual(sig, sign(secret, payload))) {
        try {
          const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
          if (data.exp > Date.now()) {
            req.user = { name: data.name, role: data.role };
            req.csrf = sign(secret, `csrf:${raw}`);
          }
        } catch {
          // bad cookie: treat as signed out
        }
      }
    }
    next();
  }

  const checkCsrf = (req) => Boolean(req.csrf && req.body?._csrf && safeEqual(req.body._csrf, req.csrf));

  return { roleForCode, tooManyAttempts, recordFailure, issue, clear, middleware, checkCsrf };
}

module.exports = { createAuth };
