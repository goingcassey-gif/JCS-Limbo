'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { loadConfig } = require('../src/config');

function tempConfig(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-desk-'));
  return loadConfig({
    DATA_DIR: dir,
    SESSION_SECRET: 'x'.repeat(40),
    TEAM_CODE: 'team-code-123',
    APPROVER_CODE: 'approver-code-456',
    PUBLIC_BASE_URL: 'https://desk.example.org',
    ...overrides,
  });
}

const jpeg = (width = 1080, height = 1350) =>
  sharp({ create: { width, height, channels: 3, background: '#6b2fa0' } }).jpeg().toBuffer();

/** A fake fetch that answers from a list of [matcher, response] rules and records every call. */
function fakeFetch(rules) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const rule = rules.find(([m]) => (typeof m === 'string' ? String(url).includes(m) : m.test(String(url))));
    if (!rule) throw new Error(`unexpected request ${url}`);
    const out = typeof rule[1] === 'function' ? rule[1](String(url), init, calls) : rule[1];
    const wrapped = out.body !== undefined; // { status, body } = full response; anything else is the JSON body
    return new Response(JSON.stringify(wrapped ? out.body : out), { status: wrapped ? out.status ?? 200 : 200, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

module.exports = { tempConfig, jpeg, fakeFetch };
