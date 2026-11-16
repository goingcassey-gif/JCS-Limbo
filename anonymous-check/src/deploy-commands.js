'use strict';

// Registers /anonymous-check and the "Flag anonymously" menu in the LIMBO server.
// Run once, and again after changing the command definitions.
process.loadEnvFile?.('.env');
const { REST, Routes } = require('discord.js');
const { commandDefinitions } = require('./index');

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !GUILD_ID) {
  console.error('Set DISCORD_TOKEN, DISCORD_CLIENT_ID and GUILD_ID in .env first.');
  process.exit(1);
}

// NOTE: PUT replaces this bot's guild commands. If you merge into Kira, add
// commandDefinitions() to Kira's own registration list instead of running this.
new REST()
  .setToken(DISCORD_TOKEN)
  .put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, GUILD_ID), { body: commandDefinitions() })
  .then(() => console.log('Registered /anonymous-check and "Flag anonymously".'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
