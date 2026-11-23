'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ALL, captionFor } = require('./platforms');

/**
 * Sends an approved post to each chosen platform, one at a time, and records each result.
 * A platform that already worked is never sent again, so "Retry" only redoes the failures.
 */
function createPublisher({ store, cfg, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console }) {
  const tokens = {
    threads: () => store.getSetting('threads_token') || cfg.threads.token,
  };
  const ctxBase = {
    cfg,
    fetch,
    sleep,
    tokens,
    readPhoto: (photo) => fs.readFileSync(path.join(cfg.mediaDir, photo.filename)),
    mediaUrl: (photo) => `${cfg.publicBaseUrl}/media/${photo.filename}`,
  };

  async function publish(postId) {
    const post = store.getPost(postId);
    if (!post || post.status !== 'posting') return null;

    for (const name of post.platforms) {
      if (post.results[name]?.status === 'posted') continue;
      const platform = ALL[name];
      const caption = captionFor(post, name);
      if (cfg.dryRun) {
        store.saveResult(postId, name, { status: 'posted', remoteId: 'dry-run', error: 'Practice mode: nothing was sent.' });
        continue;
      }
      try {
        const { remoteId, url } = await platform.publish({ ...ctxBase, caption, photos: post.photos });
        store.saveResult(postId, name, { status: 'posted', remoteId, url });
        log.info?.(`[post ${postId}] ${name}: posted ${remoteId}`);
      } catch (err) {
        store.saveResult(postId, name, { status: 'failed', error: err.message });
        log.warn?.(`[post ${postId}] ${name}: ${err.message}`);
      }
    }
    return store.finish(postId);
  }

  async function checkConnections() {
    const out = {};
    for (const [name, p] of Object.entries(ALL)) {
      if (!p.isConfigured(cfg)) {
        out[name] = { ok: false, detail: 'Not set up yet.' };
        continue;
      }
      try {
        out[name] = { ok: true, detail: await p.check(ctxBase) };
      } catch (err) {
        out[name] = { ok: false, detail: err.message };
      }
    }
    return out;
  }

  async function refreshThreadsToken() {
    if (!ALL.threads.isConfigured(cfg)) return false;
    try {
      const fresh = await ALL.threads.refreshToken(ctxBase);
      if (fresh) store.setSetting('threads_token', fresh);
      return Boolean(fresh);
    } catch (err) {
      log.warn?.(`Threads token refresh failed: ${err.message}`);
      return false;
    }
  }

  return { publish, checkConnections, refreshThreadsToken };
}

module.exports = { createPublisher };
