'use strict';

// Run /anonymous-check as its own bot, if it isn't merged into Kira.
// Reads settings from .env (see .env.example).
process.loadEnvFile?.('.env');
const { Client, Events, GatewayIntentBits } = require('discord.js');
const { setupAnonymousCheck } = require('./index');

const required = ['DISCORD_TOKEN', 'REVIEW_CHANNEL_ID', 'CORE_ROLE_ID'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing settings in .env: ${missing.join(', ')}`);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
setupAnonymousCheck(client, {
  reviewChannelId: process.env.REVIEW_CHANNEL_ID,
  coreRoleId: process.env.CORE_ROLE_ID,
  dbPath: process.env.DB_PATH || './data/flags.db',
  maxPerHour: Number(process.env.MAX_FLAGS_PER_HOUR) || 5,
});
client.once(Events.ClientReady, (c) => console.log(`anonymous-check ready as ${c.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
