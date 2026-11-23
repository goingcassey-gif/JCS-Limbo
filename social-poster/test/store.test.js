'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PostStore } = require('../src/store');

const photo = (n) => ({ filename: `${String(n).repeat(36).slice(0, 36)}.jpg`, width: 1080, height: 1080, bytes: 100 });

test('a post is approved only once, so a double click cannot post twice', () => {
  const s = new PostStore(':memory:');
  const id = s.createPost({ caption: 'Hi', platforms: ['x'], submittedBy: 'Michi', photos: [photo(1)] });
  assert.equal(s.approve(id, 'Cassey'), true);
  assert.equal(s.approve(id, 'Cassey'), false);
  assert.equal(s.getPost(id).status, 'posting');
  assert.equal(s.updateDraft(id, { caption: 'changed', overrides: {}, platforms: ['x'] }), false);
});

test('a declined post can never be approved', () => {
  const s = new PostStore(':memory:');
  const id = s.createPost({ caption: 'Hi', platforms: ['x'], submittedBy: 'Michi', photos: [photo(2)] });
  assert.equal(s.reject(id, 'Cassey', 'blurry'), true);
  assert.equal(s.approve(id, 'Cassey'), false);
  assert.equal(s.getPost(id).reject_reason, 'blurry');
});

test('overall status follows the platform results', () => {
  const s = new PostStore(':memory:');
  const id = s.createPost({ caption: 'Hi', platforms: ['x', 'facebook'], submittedBy: 'A', photos: [photo(3)] });
  s.approve(id, 'Cassey');
  s.saveResult(id, 'x', { status: 'posted', remoteId: '1' });
  s.saveResult(id, 'facebook', { status: 'failed', error: 'nope' });
  assert.equal(s.finish(id), 'partial');
  assert.equal(s.startRetry(id), true);
  s.saveResult(id, 'facebook', { status: 'posted', remoteId: '2' });
  assert.equal(s.finish(id), 'posted');
  assert.equal(s.startRetry(id), false);
});

test('posts interrupted by a restart are flagged for a manual check', () => {
  const s = new PostStore(':memory:');
  const id = s.createPost({ caption: 'Hi', platforms: ['x', 'threads'], submittedBy: 'A', photos: [photo(4)] });
  s.approve(id, 'Cassey');
  s.saveResult(id, 'x', { status: 'posted', remoteId: '1' });
  assert.equal(s.recoverInterrupted(), 1);
  const p = s.getPost(id);
  assert.equal(p.status, 'partial');
  assert.match(p.results.threads.error, /restarted/);
});
