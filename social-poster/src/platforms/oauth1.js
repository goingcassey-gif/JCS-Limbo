'use strict';

const crypto = require('node:crypto');

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * OAuth 1.0a "Authorization" header (HMAC-SHA1). JSON and multipart bodies are not signed,
 * which is what X expects for /2/tweets and /2/media/upload.
 */
function oauth1Header({ method, url, apiKey, apiSecret, accessToken, accessSecret, nonce, timestamp }) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce ?? crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };
  const params = [...u.searchParams.entries(), ...Object.entries(oauth)]
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const baseString = [method.toUpperCase(), enc(baseUrl), enc(params)].join('&');
  const signature = crypto.createHmac('sha1', `${enc(apiSecret)}&${enc(accessSecret)}`).update(baseString).digest('base64');
  const header = { ...oauth, oauth_signature: signature };
  return `OAuth ${Object.keys(header).sort().map((k) => `${enc(k)}="${enc(header[k])}"`).join(', ')}`;
}

module.exports = { oauth1Header };
