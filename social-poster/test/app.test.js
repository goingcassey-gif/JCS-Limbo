'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PostStore } = require('../src/store');
const { createPublisher } = require('../src/publisher');
const { createApp } = require('../src/app');
const { tempConfig, jpeg } = require('./helpers');

const quiet = { info() {}, warn() {}, error() {} };

async function start(cfgOverrides = {}) {
  const cfg = tempConfig(cfgOverrides);
  const store = new PostStore(':memory:');
  const publisher = createPublisher({ store, cfg, log: quiet });
  const server = createApp({ store, cfg, publisher, log: quiet }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { cfg, store, server, base };
}

async function login(base, name, code) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ name, code }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  return { res, cookie };
}

async function csrfFrom(base, cookie, path) {
  const html = await (await fetch(`${base}${path}`, { headers: { cookie } })).text();
  return html.match(/name="_csrf" value="([^"]+)"/)[1];
}

async function uploadPost(base, cookie, { caption = 'Hello Bloodline', platforms = ['facebook', 'x'], photos = 2 } = {}) {
  const form = new FormData();
  form.append('_csrf', await csrfFrom(base, cookie, '/upload'));
  form.append('caption', caption);
  for (const p of platforms) form.append('platforms', p);
  for (let i = 0; i < photos; i++) form.append('photos', new Blob([await jpeg()], { type: 'image/jpeg' }), `p${i}.jpg`);
  return fetch(`${base}/upload`, { method: 'POST', body: form, headers: { cookie }, redirect: 'manual' });
}

test('wrong access code is refused', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const { res, cookie } = await login(base, 'Someone', 'guess');
  assert.equal(res.status, 401);
  assert.equal(cookie, undefined);
});

test('team uploads, approver approves, and the post goes out (practice mode)', async (t) => {
  const { server, base, store } = await start();
  t.after(() => server.close());

  const team = await login(base, 'Michi', 'team-code-123');
  assert.equal(team.res.headers.get('location'), '/upload');
  const up = await uploadPost(base, team.cookie);
  assert.equal(up.status, 303);
  const id = Number(new URL(up.headers.get('location'), base).searchParams.get('sent'));
  const post = store.getPost(id);
  assert.equal(post.status, 'pending');
  assert.equal(post.photos.length, 2);
  assert.equal(post.submitted_by, 'Michi');

  // Photos of a pending post are private.
  const mediaPath = `/media/${post.photos[0].filename}`;
  assert.equal((await fetch(`${base}${mediaPath}`)).status, 404);
  assert.equal((await fetch(`${base}${mediaPath}`, { headers: { cookie: team.cookie } })).status, 200);

  // Team members cannot approve.
  const teamCsrf = await csrfFrom(base, team.cookie, '/upload');
  const denied = await fetch(`${base}/posts/${id}/decide`, {
    method: 'POST',
    headers: { cookie: team.cookie },
    body: new URLSearchParams({ _csrf: teamCsrf, action: 'approve', caption: 'x', platforms: 'x' }),
    redirect: 'manual',
  });
  assert.equal(denied.status, 403);
  assert.equal(store.getPost(id).status, 'pending');

  const boss = await login(base, 'Cassey', 'approver-code-456');
  const queue = await (await fetch(`${base}/queue`, { headers: { cookie: boss.cookie } })).text();
  assert.match(queue, /Waiting \(1\)/);

  // Missing CSRF token is refused.
  const noCsrf = await fetch(`${base}/posts/${id}/decide`, {
    method: 'POST',
    headers: { cookie: boss.cookie },
    body: new URLSearchParams({ action: 'approve', caption: 'x', platforms: 'x' }),
    redirect: 'manual',
  });
  assert.equal(noCsrf.status, 403);

  const csrf = await csrfFrom(base, boss.cookie, `/posts/${id}`);
  const body = new URLSearchParams({ _csrf: csrf, action: 'approve', caption: 'Edited by Cassey', override_x: 'Short' });
  body.append('platforms', 'facebook');
  body.append('platforms', 'x');
  const ok = await fetch(`${base}/posts/${id}/decide`, { method: 'POST', headers: { cookie: boss.cookie }, body, redirect: 'manual' });
  assert.equal(ok.status, 303);
  await new Promise((r) => setTimeout(r, 50));

  const done = store.getPost(id);
  assert.equal(done.status, 'posted');
  assert.equal(done.caption, 'Edited by Cassey');
  assert.equal(done.overrides.x, 'Short');
  assert.equal(done.decided_by, 'Cassey');
  // Approved photos are reachable without signing in (Instagram and Threads fetch them).
  assert.equal((await fetch(`${base}${mediaPath}`)).status, 200);
});

test('approval is blocked while a platform check fails', async (t) => {
  const { server, base, store } = await start();
  t.after(() => server.close());
  const boss = await login(base, 'Cassey', 'approver-code-456');
  const up = await uploadPost(base, boss.cookie, { caption: 'y'.repeat(281), platforms: ['x'] });
  const id = Number(new URL(up.headers.get('location'), base).searchParams.get('sent'));
  const csrf = await csrfFrom(base, boss.cookie, `/posts/${id}`);
  const res = await fetch(`${base}/posts/${id}/decide`, {
    method: 'POST',
    headers: { cookie: boss.cookie },
    body: new URLSearchParams({ _csrf: csrf, action: 'approve', caption: 'y'.repeat(281), platforms: 'x' }),
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /281 characters; the limit is 280/);
  assert.equal(store.getPost(id).status, 'pending');
});

test('decline keeps the post off every platform', async (t) => {
  const { server, base, store } = await start();
  t.after(() => server.close());
  const boss = await login(base, 'Cassey', 'approver-code-456');
  const up = await uploadPost(base, boss.cookie);
  const id = Number(new URL(up.headers.get('location'), base).searchParams.get('sent'));
  const csrf = await csrfFrom(base, boss.cookie, `/posts/${id}`);
  await fetch(`${base}/posts/${id}/reject`, {
    method: 'POST',
    headers: { cookie: boss.cookie },
    body: new URLSearchParams({ _csrf: csrf, reason: 'Wrong event' }),
    redirect: 'manual',
  });
  const p = store.getPost(id);
  assert.equal(p.status, 'rejected');
  assert.deepEqual(p.results, {});
  assert.equal((await fetch(`${base}/media/${p.photos[0].filename}`)).status, 404);
});

test('a non-photo upload gets a friendly error', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const team = await login(base, 'Aian', 'team-code-123');
  const form = new FormData();
  form.append('_csrf', await csrfFrom(base, team.cookie, '/upload'));
  form.append('platforms', 'x');
  form.append('photos', new Blob(['hello'], { type: 'image/jpeg' }), 'fake.jpg');
  const res = await fetch(`${base}/upload`, { method: 'POST', body: form, headers: { cookie: team.cookie } });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /not a photo this app can read/);
});
