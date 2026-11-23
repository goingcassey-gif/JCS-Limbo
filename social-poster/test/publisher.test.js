'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PostStore } = require('../src/store');
const { createPublisher } = require('../src/publisher');
const { processPhoto } = require('../src/images');
const { problemsFor } = require('../src/platforms');
const { tempConfig, jpeg, fakeFetch } = require('./helpers');

const quiet = { info() {}, warn() {}, error() {} };
const live = {
  DRY_RUN: 'false',
  FB_PAGE_ID: 'page1',
  FB_PAGE_TOKEN: 'fbtok',
  IG_USER_ID: 'ig1',
  THREADS_USER_ID: 'th1',
  THREADS_TOKEN: 'thtok',
  X_API_KEY: 'k',
  X_API_SECRET: 's',
  X_ACCESS_TOKEN: 't',
  X_ACCESS_SECRET: 'ts',
};

async function setup(cfgOverrides, platforms, photoCount = 1) {
  const cfg = tempConfig(cfgOverrides);
  const store = new PostStore(':memory:');
  const photos = [];
  for (let i = 0; i < photoCount; i++) photos.push(await processPhoto(await jpeg(), `p${i}.jpg`, cfg.mediaDir));
  const id = store.createPost({
    caption: 'Bloodline, assemble',
    overrides: { x: 'Short one for X' },
    platforms,
    submittedBy: 'Michi',
    photos,
  });
  store.approve(id, 'Cassey');
  return { cfg, store, id, photos };
}

const metaRules = [
  [/graph\.facebook\.com\/v23\.0\/page1\/photos/, (_u, init) => (init.body.get('published') === 'true' ? { id: 'ph9', post_id: 'page1_99' } : { id: `ph${Math.random()}` })],
  [/graph\.facebook\.com\/v23\.0\/page1\/feed/, { id: 'page1_77' }],
  [/graph\.facebook\.com\/v23\.0\/ig1\/media_publish/, { id: 'igpost1' }],
  [/graph\.facebook\.com\/v23\.0\/ig1\/media/, { id: 'igc1' }],
  [/fields=status_code/, { status_code: 'FINISHED' }],
  [/graph\.facebook\.com\/v23\.0\/igpost1\?fields=permalink/, { permalink: 'https://www.instagram.com/p/abc/' }],
  [/graph\.threads\.net\/v1\.0\/th1\/threads_publish/, { id: 'thpost1' }],
  [/graph\.threads\.net\/v1\.0\/th1\/threads/, { id: 'thc1' }],
  [/fields=status,error_message/, { status: 'FINISHED' }],
  [/graph\.threads\.net\/v1\.0\/thpost1\?fields=permalink/, { permalink: 'https://www.threads.net/@limbo/post/xyz' }],
  [/api\.x\.com\/2\/media\/upload/, { data: { id: 'm1' } }],
  [/api\.x\.com\/2\/tweets/, { data: { id: '1234' } }],
];

test('practice mode records success without calling any platform', async () => {
  const { cfg, store, id } = await setup({}, ['facebook', 'instagram', 'threads', 'x']);
  const fetch = fakeFetch([]);
  const status = await createPublisher({ store, cfg, fetch, log: quiet }).publish(id);
  assert.equal(status, 'posted');
  assert.equal(fetch.calls.length, 0);
});

test('posts one photo to all four platforms with the right captions', async () => {
  const { cfg, store, id, photos } = await setup(live, ['facebook', 'instagram', 'threads', 'x']);
  const fetch = fakeFetch(metaRules);
  const status = await createPublisher({ store, cfg, fetch, log: quiet, sleep: async () => {} }).publish(id);
  const post = store.getPost(id);
  assert.equal(status, 'posted', JSON.stringify(post.results));
  assert.equal(post.results.facebook.url, 'https://www.facebook.com/page1_99');
  assert.equal(post.results.instagram.url, 'https://www.instagram.com/p/abc/');
  assert.equal(post.results.threads.url, 'https://www.threads.net/@limbo/post/xyz');
  assert.equal(post.results.x.url, 'https://x.com/i/web/status/1234');

  const ig = fetch.calls.find((c) => /ig1\/media$/.test(c.url));
  assert.equal(ig.init.body.get('image_url'), `https://desk.example.org/media/${photos[0].filename}`);
  assert.equal(ig.init.body.get('caption'), 'Bloodline, assemble');
  const tweet = fetch.calls.find((c) => c.url.endsWith('/2/tweets'));
  assert.deepEqual(JSON.parse(tweet.init.body), { text: 'Short one for X', media: { media_ids: ['m1'] } });
  assert.match(tweet.init.headers.Authorization, /^OAuth .*oauth_signature=/);
});

test('several photos become one carousel / album post', async () => {
  const { cfg, store, id } = await setup(live, ['facebook', 'instagram', 'threads'], 3);
  const fetch = fakeFetch(metaRules);
  assert.equal(await createPublisher({ store, cfg, fetch, log: quiet, sleep: async () => {} }).publish(id), 'posted');
  const feed = fetch.calls.find((c) => c.url.endsWith('/page1/feed'));
  assert.equal([...feed.init.body.keys()].filter((k) => k.startsWith('attached_media')).length, 3);
  const igCarousel = fetch.calls.find((c) => /ig1\/media$/.test(c.url) && c.init.body.get('media_type') === 'CAROUSEL');
  assert.equal(igCarousel.init.body.get('children').split(',').length, 3);
  const thCarousel = fetch.calls.find((c) => /th1\/threads$/.test(c.url) && c.init.body.get('media_type') === 'CAROUSEL');
  assert.ok(thCarousel);
});

test('one platform failing does not stop the others, and retry only redoes the failure', async () => {
  const { cfg, store, id } = await setup(live, ['facebook', 'x']);
  let xDown = true;
  const rules = [
    [/api\.x\.com\/2\/media\/upload/, () => (xDown ? { status: 403, body: { title: 'Forbidden', detail: 'not allowed' } } : { data: { id: 'm1' } })],
    ...metaRules,
  ];
  const fetch = fakeFetch(rules);
  const pub = createPublisher({ store, cfg, fetch, log: quiet, sleep: async () => {} });
  assert.equal(await pub.publish(id), 'partial');
  assert.match(store.getPost(id).results.x.error, /Read and Write/);

  xDown = false;
  const fbCallsBefore = fetch.calls.filter((c) => c.url.includes('facebook')).length;
  assert.equal(store.startRetry(id), true);
  assert.equal(await pub.publish(id), 'posted');
  assert.equal(fetch.calls.filter((c) => c.url.includes('facebook')).length, fbCallsBefore, 'Facebook must not be posted twice');
});

test('an expired Meta sign-in gives a plain message', async () => {
  const { cfg, store, id } = await setup(live, ['facebook']);
  const fetch = fakeFetch([[/facebook/, { status: 400, body: { error: { message: 'Session has expired', code: 190 } } }]]);
  await createPublisher({ store, cfg, fetch, log: quiet }).publish(id);
  assert.match(store.getPost(id).results.facebook.error, /Sign-in expired/);
});

test('checks catch problems before approval', async () => {
  const cfg = tempConfig({ DRY_RUN: 'false' });
  const tall = await processPhoto(await jpeg(1000, 2000), 'tall.jpg', cfg.mediaDir);
  const post = { caption: 'a'.repeat(300), overrides: {}, platforms: ['instagram', 'x', 'threads'], photos: [tall, tall, tall, tall, tall] };
  const problems = problemsFor(post, cfg);
  assert.ok(problems.instagram.some((p) => /not connected/.test(p)));
  assert.ok(problems.instagram.some((p) => /taller than 4:5/.test(p)));
  assert.ok(problems.x.some((p) => /at most 4 photos/.test(p)));
  assert.ok(problems.x.some((p) => /300 characters/.test(p)));
  assert.equal(problems.threads.length, 1, 'Threads only complains about not being connected');
});

test('photos are re-saved as clean JPEGs with no location data', async () => {
  const cfg = tempConfig();
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: '#ff000080' } })
    .withExif({ IFD0: { Copyright: 'secret' } })
    .png()
    .toBuffer();
  const out = await processPhoto(png, 'a.png', cfg.mediaDir);
  const meta = await sharp(fs.readFileSync(path.join(cfg.mediaDir, out.filename))).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(Math.max(meta.width, meta.height), 2048);
  assert.equal(meta.exif, undefined);
  await assert.rejects(processPhoto(Buffer.from('not an image'), 'x.txt', cfg.mediaDir), /not a photo/);
});
