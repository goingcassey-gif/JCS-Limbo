'use strict';

// `npm run check`: tests each account connection without posting anything.
const { loadConfig } = require('./config');
const { PostStore } = require('./store');
const { createPublisher } = require('./publisher');

try {
  process.loadEnvFile?.('.env');
} catch {
  // no .env
}
const cfg = loadConfig();
const store = new PostStore(cfg.dbPath);
createPublisher({ store, cfg })
  .checkConnections()
  .then((status) => {
    for (const [name, s] of Object.entries(status)) console.log(`${s.ok ? 'PASS' : 'FAIL'} ${name}: ${s.detail}`);
    store.close();
  });
