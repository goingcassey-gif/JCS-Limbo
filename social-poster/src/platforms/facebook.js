'use strict';

const { callJson } = require('./http');

const base = (cfg) => `https://graph.facebook.com/${cfg.graphVersion}`;

module.exports = {
  name: 'facebook',
  label: 'Facebook Page',
  maxPhotos: 10,
  maxChars: 63206,

  isConfigured: (cfg) => Boolean(cfg.facebook.pageId && cfg.facebook.token),

  validate() {
    return [];
  },

  /** One photo: a photo post. Several: unpublished uploads joined into one feed post. */
  async publish({ cfg, fetch, caption, photos, readPhoto }) {
    const { pageId, token } = cfg.facebook;
    const upload = async (photo, published) => {
      const form = new FormData();
      form.append('access_token', token);
      form.append('published', String(published));
      if (published) form.append('message', caption);
      form.append('source', new Blob([readPhoto(photo)], { type: 'image/jpeg' }), photo.filename);
      return callJson(fetch, `${base(cfg)}/${pageId}/photos`, { method: 'POST', body: form });
    };

    if (photos.length === 1) {
      const r = await upload(photos[0], true);
      const postId = r.post_id || r.id;
      return { remoteId: postId, url: `https://www.facebook.com/${postId}` };
    }

    const ids = [];
    for (const p of photos) ids.push((await upload(p, false)).id);
    const body = new URLSearchParams({ access_token: token, message: caption });
    ids.forEach((id, i) => body.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
    const r = await callJson(fetch, `${base(cfg)}/${pageId}/feed`, { method: 'POST', body });
    return { remoteId: r.id, url: `https://www.facebook.com/${r.id}` };
  },

  async check({ cfg, fetch }) {
    const { pageId, token } = cfg.facebook;
    const r = await callJson(fetch, `${base(cfg)}/${pageId}?fields=name&access_token=${encodeURIComponent(token)}`);
    return `Connected to the Page "${r.name}".`;
  },
};
