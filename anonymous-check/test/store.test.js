'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FlagStore } = require('../src/store');
const { parseMessageLink } = require('../src/links');

const flag = (reporterId, extra = {}) => ({
  guildId: '111111111111111111', channelId: '222222222222222222', messageId: '333333333333333333',
  authorId: '444444444444444444', snapshot: 'hello', reporterId, ...extra,
});

test('parses message links', () => {
  const ids = { guildId: '111111111111111111', channelId: '222222222222222222', messageId: '333333333333333333' };
  for (const l of [
    'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333',
    ' https://ptb.discord.com/channels/111111111111111111/222222222222222222/333333333333333333 ',
    '<https://discordapp.com/channels/111111111111111111/222222222222222222/333333333333333333>',
    'https://canary.discord.com/channels/111111111111111111/222222222222222222/333333333333333333?x=1',
  ]) assert.deepEqual(parseMessageLink(l), ids, l);
  for (const l of ['hello', 'https://evil.com/channels/1/2/3', 'https://discord.com/channels/@me/222222222222222222/333333333333333333', null])
    assert.equal(parseMessageLink(l), null);
});

test('first flag creates a case, second member is told it is already flagged', () => {
  const s = new FlagStore(':memory:');
  const a = s.submitFlag(flag('A', { reason: 'rude' }));
  assert.equal(a.outcome, 'created');
  const b = s.submitFlag(flag('B'));
  assert.equal(b.outcome, 'added');
  assert.equal(b.case.id, a.case.id);
  assert.equal(s.listReports(a.case.id).length, 2);
  assert.equal(s.submitFlag(flag('A')).outcome, 'already_flagged_by_you');
  assert.equal(s.listReports(a.case.id).length, 2);
});

test('reviewed messages are not reopened by new flags', () => {
  const s = new FlagStore(':memory:');
  const { case: c } = s.submitFlag(flag('A'));
  s.claim(c.id, 'MOD');
  assert.equal(s.getCase(c.id).status, 'claimed');
  assert.equal(s.submitFlag(flag('B')).outcome, 'added');
  s.decide(c.id, 'not_valid', 'MOD');
  assert.equal(s.submitFlag(flag('C')).outcome, 'already_reviewed');
  s.reopen(c.id);
  assert.equal(s.submitFlag(flag('C')).outcome, 'added');
});

test('rate limit counts only the last hour', () => {
  const s = new FlagStore(':memory:');
  const now = Date.now();
  for (let i = 0; i < 3; i++) assert.equal(s.submitFlag(flag('A', { messageId: `9${i}` }), { maxPerHour: 3, now }).outcome, 'created');
  assert.equal(s.submitFlag(flag('A', { messageId: '99' }), { maxPerHour: 3, now }).outcome, 'rate_limited');
  assert.equal(s.getCaseByMessage('99'), null);
  // Re-flagging something you already flagged still gets the friendly answer.
  assert.equal(s.submitFlag(flag('A', { messageId: '90' }), { maxPerHour: 3, now }).outcome, 'already_flagged_by_you');
  assert.equal(s.submitFlag(flag('A', { messageId: '99' }), { maxPerHour: 3, now: now + 61 * 60 * 1000 }).outcome, 'created');
});

test('data survives a restart', (t) => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sub', 'flags.db');
  let s = new FlagStore(file); s.submitFlag(flag('A')); s.close();
  s = new FlagStore(file);
  assert.equal(s.submitFlag(flag('B')).outcome, 'added');
  s.close();
});
