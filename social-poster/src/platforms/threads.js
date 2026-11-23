'use strict';

const { callJson, PlatformError } = require('./http');

const BASE = 'https://graph.threads.net/v1.0';

async function waitUntilReady(token, fetch, sleep, containerId) {
  for (let i = 0; i < 20; i++) {
    const r = await callJson(fetch, `${BASE}/${containerId}?fields=status,error_message&access_token=${encodeURIComponent(token)}`);
    if (r.status === 'FINISHED') return;
    if (r.status === 'ERROR' || r.status === 'EXPIRED') {
      throw new PlatformError(`Threads could not process the photo (${r.error_message || r.status}).`);
    }
    await sleep(3000);
  }
  throw new PlatformError('Threads took too long to process the photo. Try again in a few minutes.');
}

module.exports = {
  name: 'threads',
  label: 'Threads',
  maxPhotos: 10,
  maxChars: 500,

  isConfigured: (cfg) => Boolean(cfg.threads.userId && cfg.threads.token),

  validate() {
    return [];
  },

  async publish({ cfg, fetch, caption, photos, mediaUrl, sleep, tokens }) {
    const { userId } = cfg.threads;
    const token = tokens.threads();
    const create = (params) =>
      callJson(fetch, `${BASE}/${userId}/threads`, {
        method: 'POST',
        body: new URLSearchParams({ ...params, access_token: token }),
      });

    let containerId;
    if (photos.length === 1) {
      containerId = (await create({ media_type: 'IMAGE', image_url: mediaUrl(photos[0]), text: caption })).id;
    } else {
      const children = [];
      for (const p of photos) {
        children.push((await create({ media_type: 'IMAGE', image_url: mediaUrl(p), is_carousel_item: 'true' })).id);
      }
      for (const c of children) await waitUntilReady(token, fetch, sleep, c);
      containerId = (await create({ media_type: 'CAROUSEL', children: children.join(','), text: caption })).id;
    }
    await waitUntilReady(token, fetch, sleep, containerId);

    const published = await callJson(fetch, `${BASE}/${userId}/threads_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: containerId, access_token: token }),
    });
    let url = null;
    try {
      url = (await callJson(fetch, `${BASE}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`)).permalink;
    } catch {
      // Live already; the link is a nice-to-have.
    }
    return { remoteId: published.id, url };
  },

  async check({ fetch, tokens }) {
    const r = await callJson(fetch, `${BASE}/me?fields=username&access_token=${encodeURIComponent(tokens.threads())}`);
    return `Connected to @${r.username}.`;
  },

  /** Long-lived Threads tokens last 60 days; refreshing resets the clock. */
  async refreshToken({ fetch, tokens }) {
    const r = await callJson(
      fetch,
      `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(tokens.threads())}`,
    );
    return r.access_token;
  },
};
