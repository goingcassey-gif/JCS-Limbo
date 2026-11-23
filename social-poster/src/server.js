'use strict';

const { loadConfig, configProblems } = require('./config');
const { PostStore } = require('./store');
const { createPublisher } = require('./publisher');
const { createApp } = require('./app');

try {
  process.loadEnvFile?.('.env');
} catch {
  // No .env file: use the real environment.
}

const cfg = loadConfig();
const problems = configProblems(cfg);
if (problems.length) {
  console.error(`Cannot start. Fix these in .env:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const store = new PostStore(cfg.dbPath);
const recovered = store.recoverInterrupted();
if (recovered) console.warn(`${recovered} post(s) were mid-posting when the app stopped. They are marked for a manual check.`);

const publisher = createPublisher({ store, cfg });
const app = createApp({ store, cfg, publisher });

// Threads sign-ins expire after 60 days unless renewed; renew once a day.
publisher.refreshThreadsToken();
setInterval(() => publisher.refreshThreadsToken(), 24 * 60 * 60 * 1000).unref();

app.listen(cfg.port, () => {
  console.log(`LIMBO Post Desk on port ${cfg.port} (${cfg.dryRun ? 'practice mode: nothing is sent' : 'LIVE'}).`);
});
