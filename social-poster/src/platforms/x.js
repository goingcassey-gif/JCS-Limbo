'use strict';

const { callJson } = require('./http');
const { oauth1Header } = require('./oauth1');

const API = 'https://api.x.com/2';

/** X counts every link as 23 characters, and most emoji and CJK characters as 2. */
function xLength(text) {
  const withoutLinks = text.replace(/https?:\/\/\S+/g, 'x'.repeat(23));
  let n = 0;
  for (const ch of withoutLinks) {
    const cp = ch.codePointAt(0);
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

module.exports = {
  name: 'x',
  label: 'X',
  maxPhotos: 4,
  maxChars: 280,
  length: xLength,

  isConfigured: (cfg) => Boolean(cfg.x.apiKey && cfg.x.apiSecret && cfg.x.accessToken && cfg.x.accessSecret),

  validate() {
    return [];
  },

  async publish({ cfg, fetch, caption, photos, readPhoto }) {
    const auth = (method, url) => oauth1Header({ method, url, ...cfg.x });

    const mediaIds = [];
    for (const p of photos) {
      const url = `${API}/media/upload`;
      const form = new FormData();
      form.append('media', new Blob([readPhoto(p)], { type: 'image/jpeg' }), p.filename);
      form.append('media_category', 'tweet_image');
      form.append('media_type', 'image/jpeg');
      const r = await callJson(fetch, url, { method: 'POST', headers: { Authorization: auth('POST', url) }, body: form });
      mediaIds.push(r.data?.id ?? r.media_id_string);
    }

    const url = `${API}/tweets`;
    const r = await callJson(fetch, url, {
      method: 'POST',
      headers: { Authorization: auth('POST', url), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: caption, media: { media_ids: mediaIds } }),
    });
    return { remoteId: r.data.id, url: `https://x.com/i/web/status/${r.data.id}` };
  },

  async check({ cfg, fetch }) {
    const url = `${API}/users/me`;
    const r = await callJson(fetch, url, { headers: { Authorization: oauth1Header({ method: 'GET', url, ...cfg.x }) } });
    return `Connected to @${r.data.username}.`;
  },
};
