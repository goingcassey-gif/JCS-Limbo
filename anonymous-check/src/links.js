'use strict';

// Matches links copied with "Copy Message Link", including the ptb/canary
// clients and the old discordapp.com domain.
const LINK_RE =
  /^<?https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{15,25})\/(\d{15,25})\/(\d{15,25})\/?(?:\?[^\s>]*)?>?$/i;

/**
 * Parse a Discord message link.
 * @param {string} input
 * @returns {{guildId: string, channelId: string, messageId: string} | null}
 */
function parseMessageLink(input) {
  if (typeof input !== 'string') return null;
  const m = input.trim().match(LINK_RE);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

module.exports = { parseMessageLink };
