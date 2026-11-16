'use strict';
// Runs the real interaction handlers against a fake Discord client.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setupAnonymousCheck, REPLIES } = require('../src/index');
const { FlagStore } = require('../src/store');

const G = '100000000000000001', CH = '200000000000000002', MSG = '300000000000000003', REVIEW = '400000000000000004', CORE = '500000000000000005';
const LINK = `https://discord.com/channels/${G}/${CH}/${MSG}`;

function fakeClient() {
  const client = new EventEmitter();
  const reviewPosts = new Map();
  let n = 0;
  const flagged = { id: MSG, content: 'something mean', author: { id: 'AUTHOR' }, attachments: new Map(), embeds: [] };
  const channels = {
    [CH]: { messages: { fetch: async (id) => { if (id !== MSG) throw new Error('Unknown Message'); return flagged; } } },
    [REVIEW]: {
      send: async (payload) => { const id = `R${++n}`; const post = { id, payload, edit: async (p) => { post.payload = p; } }; reviewPosts.set(id, post); return post; },
      messages: { fetch: async (id) => { const p = reviewPosts.get(id); if (!p) throw Object.assign(new Error('Unknown'), { code: 10008 }); return p; } },
    },
  };
  client.channels = { fetch: async (id) => { if (!channels[id]) throw new Error('Unknown Channel'); return channels[id]; } };
  return { client, reviewPosts };
}

function slash(userId, link, reason = null) {
  const i = {
    guildId: G, user: { id: userId }, commandName: 'anonymous-check', deferred: false, replied: false, answer: null,
    isChatInputCommand: () => true, isMessageContextMenuCommand: () => false, isButton: () => false,
    options: { getString: (k) => (k === 'link' ? link : reason) },
    deferReply: async (o) => { i.deferred = true; i.ephemeral = o.flags; },
    editReply: async (r) => { i.answer = r; },
    reply: async (r) => { i.replied = true; i.answer = r.content ?? r; i.ephemeral = r.flags; },
  };
  return i;
}

function button(customId, roles) {
  const i = {
    customId, member: { roles }, user: { id: 'MOD' }, updated: null, answer: null,
    isChatInputCommand: () => false, isMessageContextMenuCommand: () => false, isButton: () => true,
    update: async (p) => { i.updated = p; }, reply: async (r) => { i.answer = r.content; },
  };
  return i;
}

async function fire(client, i) {
  const handlers = client.listeners('interactionCreate');
  await Promise.all(handlers.map((h) => h(i)));
  return i;
}

test('full flow: flag, duplicate, review buttons', async () => {
  const { client, reviewPosts } = fakeClient();
  const store = new FlagStore(':memory:');
  setupAnonymousCheck(client, { reviewChannelId: REVIEW, coreRoleId: CORE, store });

  const a = await fire(client, slash('A', LINK, 'harassment'));
  assert.equal(a.answer, REPLIES.created);
  assert.ok(a.ephemeral, 'reply must be ephemeral');
  assert.equal(reviewPosts.size, 1);
  const post = [...reviewPosts.values()][0];
  const embed = post.payload.embeds[0].toJSON();
  assert.match(JSON.stringify(embed), /<@A>/);
  assert.match(JSON.stringify(embed), /something mean/);
  assert.deepEqual(post.payload.allowedMentions, { parse: [] });

  const b = await fire(client, slash('B', LINK));
  assert.equal(b.answer, REPLIES.added);
  assert.equal(reviewPosts.size, 1, 'no second review post');
  assert.match(JSON.stringify(post.payload.embeds[0].toJSON()), /Flagged by 2 members/);

  assert.equal((await fire(client, slash('A', LINK))).answer, REPLIES.already_flagged_by_you);

  const caseId = store.getCaseByMessage(MSG).id;
  const outsider = await fire(client, button(`flag:valid:${caseId}`, ['X']));
  assert.equal(outsider.answer, 'Only the core team can review flags.');
  assert.equal(store.getCase(caseId).status, 'open');

  const mod = await fire(client, button(`flag:valid:${caseId}`, [CORE]));
  assert.equal(store.getCase(caseId).status, 'valid');
  assert.match(JSON.stringify(mod.updated.embeds[0].toJSON()), /Valid concern/);

  assert.equal((await fire(client, slash('C', LINK))).answer, REPLIES.already_reviewed);
});

test('bad input is answered privately', async () => {
  const { client } = fakeClient();
  setupAnonymousCheck(client, { reviewChannelId: REVIEW, coreRoleId: CORE, store: new FlagStore(':memory:') });
  assert.equal((await fire(client, slash('A', 'not a link'))).answer, REPLIES.bad_link);
  assert.equal((await fire(client, slash('A', `https://discord.com/channels/999999999999999999/${CH}/${MSG}`))).answer, REPLIES.other_server);
  assert.equal((await fire(client, slash('A', `https://discord.com/channels/${G}/${CH}/300000000000000009`))).answer, REPLIES.not_found);
  assert.equal((await fire(client, slash('AUTHOR', LINK))).answer, REPLIES.own_message);
});

test('simultaneous flags make only one review post', async () => {
  const { client, reviewPosts } = fakeClient();
  const store = new FlagStore(':memory:');
  setupAnonymousCheck(client, { reviewChannelId: REVIEW, coreRoleId: CORE, store });
  await Promise.all(['A', 'B', 'C'].map((u) => fire(client, slash(u, LINK))));
  assert.equal(reviewPosts.size, 1);
  assert.equal(store.listReports(store.getCaseByMessage(MSG).id).length, 3);
  assert.match(JSON.stringify([...reviewPosts.values()][0].payload.embeds[0].toJSON()), /Flagged by 3 members/);
});

test('a failed review post is retried on the next flag', async () => {
  const { client, reviewPosts } = fakeClient();
  const store = new FlagStore(':memory:');
  const errors = [];
  setupAnonymousCheck(client, { reviewChannelId: REVIEW, coreRoleId: CORE, store, onError: (e) => errors.push(e) });
  const review = await client.channels.fetch(REVIEW);
  const realSend = review.send;
  review.send = async () => { throw new Error('Missing Permissions'); };
  await fire(client, slash('A', LINK));
  assert.equal(errors.length, 1);
  review.send = realSend;
  await fire(client, slash('B', LINK));
  assert.equal(reviewPosts.size, 1);
});
