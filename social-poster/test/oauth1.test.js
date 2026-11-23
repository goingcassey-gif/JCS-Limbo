'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { oauth1Header } = require('../src/platforms/oauth1');

test('matches the signature from a reference OAuth 1.0a library (python oauthlib)', () => {
  const h = oauth1Header({
    method: 'GET',
    url: 'https://api.x.com/2/users/me?user.fields=name%20x&a=1',
    apiKey: 'ck',
    apiSecret: 'cs!',
    accessToken: 'at',
    accessSecret: 'as*',
    nonce: 'abc123',
    timestamp: 1700000000,
  });
  assert.match(h, /oauth_signature="SGjLLOnXcmqBKOmqGrdr8K9X1eI%3D"/);
  assert.match(h, /^OAuth /);
});
