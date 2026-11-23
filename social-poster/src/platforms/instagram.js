'use strict';

const { callJson, PlatformError } = require('./http');

const base = (cfg) => `https://graph.facebook.com/${cfg.graphVersion}`;

/** Instagram rejects feed photos outside 4:5 (tall) to 1.91:1 (wide). */
function ratioProblem(photo) {
  const r = photo.width / photo.height;
  if (r < 0.8 - 0.005) return 'is taller than 4:5';
  if (r > 1.91 + 0.005) return 'is wider than 1.91:1';
  return null;
}

async function waitUntilReady(cfg, fetch, sleep, containerId) {
  for (let i = 0; i < 20; i++) {
    const r = await callJson(
      fetch,
      `${base(cfg)}/${containerId}?fields=status_code&access_token=${encodeURIComponent(cfg.instagram.token)}`,
    );
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') {
      throw new PlatformError(`Instagram could not process the photo (${r.status_code}).`);
    }
    await sleep(3000);
  }
  throw new PlatformError('Instagram took too long to process the photo. Try again in a few minutes.');
}

module.exports = {
  name: 'instagram',
  label: 'Instagram',
  maxPhotos: 10,
  maxChars: 2200,

  isConfigured: (cfg) => Boolean(cfg.instagram.userId && cfg.instagram.token),

  validate(post) {
    const problems = [];
    post.photos.forEach((p, i) => {
      const bad = ratioProblem(p);
      if (bad) problems.push(`Photo ${i + 1} ${bad}. Crop it between 4:5 and 1.91:1, or untick Instagram.`);
    });
    const tags = (post.caption.match(/#[\p{L}\p{N}_]+/gu) || []).length;
    if (tags > 30) problems.push(`Instagram allows 30 hashtags; this caption has ${tags}.`);
    return problems;
  },

  async publish({ cfg, fetch, caption, photos, mediaUrl, sleep }) {
    const { userId, token } = cfg.instagram;
    const create = (params) =>
      callJson(fetch, `${base(cfg)}/${userId}/media`, {
        method: 'POST',
        body: new URLSearchParams({ ...params, access_token: token }),
      });

    let containerId;
    if (photos.length === 1) {
      containerId = (await create({ image_url: mediaUrl(photos[0]), caption })).id;
    } else {
      const children = [];
      for (const p of photos) children.push((await create({ image_url: mediaUrl(p), is_carousel_item: 'true' })).id);
      for (const c of children) await waitUntilReady(cfg, fetch, sleep, c);
      containerId = (await create({ media_type: 'CAROUSEL', children: children.join(','), caption })).id;
    }
    await waitUntilReady(cfg, fetch, sleep, containerId);

    const published = await callJson(fetch, `${base(cfg)}/${userId}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: containerId, access_token: token }),
    });
    let url = null;
    try {
      url = (await callJson(fetch, `${base(cfg)}/${published.id}?fields=permalink&access_token=${encodeURIComponent(token)}`)).permalink;
    } catch {
      // The post is live; a missing link is not worth failing over.
    }
    return { remoteId: published.id, url };
  },

  async check({ cfg, fetch }) {
    const { userId, token } = cfg.instagram;
    const r = await callJson(fetch, `${base(cfg)}/${userId}?fields=username&access_token=${encodeURIComponent(token)}`);
    return `Connected to @${r.username}.`;
  },
};
