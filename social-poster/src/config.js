'use strict';

const path = require('node:path');

/** Reads settings from environment variables. Secrets only ever come from here (the .env file), never from chat. */
function loadConfig(env = process.env) {
  const flag = (v, dflt) => (v === undefined || v === '' ? dflt : /^(1|true|yes|on)$/i.test(v));
  const dataDir = path.resolve(env.DATA_DIR || './data');
  return {
    port: Number(env.PORT || 3000),
    publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    dataDir,
    dbPath: path.join(dataDir, 'post-desk.db'),
    mediaDir: path.join(dataDir, 'media'),
    sessionSecret: env.SESSION_SECRET || '',
    teamCode: env.TEAM_CODE || '',
    approverCode: env.APPROVER_CODE || '',
    // Safe default: nothing reaches any platform until DRY_RUN=false is set on purpose.
    dryRun: flag(env.DRY_RUN, true),
    timeZone: env.DISPLAY_TZ || 'Asia/Manila',
    graphVersion: env.GRAPH_VERSION || 'v23.0',
    facebook: { pageId: env.FB_PAGE_ID || '', token: env.FB_PAGE_TOKEN || '' },
    instagram: { userId: env.IG_USER_ID || '', token: env.IG_TOKEN || env.FB_PAGE_TOKEN || '' },
    threads: { userId: env.THREADS_USER_ID || '', token: env.THREADS_TOKEN || '' },
    x: {
      apiKey: env.X_API_KEY || '',
      apiSecret: env.X_API_SECRET || '',
      accessToken: env.X_ACCESS_TOKEN || '',
      accessSecret: env.X_ACCESS_SECRET || '',
    },
  };
}

function configProblems(cfg) {
  const problems = [];
  if (cfg.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters.');
  if (cfg.teamCode.length < 8) problems.push('TEAM_CODE must be at least 8 characters.');
  if (cfg.approverCode.length < 12) problems.push('APPROVER_CODE must be at least 12 characters.');
  if (cfg.teamCode && cfg.teamCode === cfg.approverCode) problems.push('TEAM_CODE and APPROVER_CODE must be different.');
  if (!cfg.dryRun && !/^https:\/\//.test(cfg.publicBaseUrl)) {
    problems.push('PUBLIC_BASE_URL must be the https address of this app (Instagram and Threads download photos from it).');
  }
  return problems;
}

module.exports = { loadConfig, configProblems };
