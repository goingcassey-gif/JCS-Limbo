'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const COLORS = { open: 0xe67e22, claimed: 0x3498db, valid: 0xc0392b, not_valid: 0x7f8c8d };
const STATUS_TEXT = {
  open: 'Open, waiting for a core team member',
  claimed: 'Being checked',
  valid: 'Valid concern',
  not_valid: 'Not a concern',
};

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

function messageUrl(c) {
  return `https://discord.com/channels/${c.guild_id}/${c.channel_id}/${c.message_id}`;
}

/** The private post the core team sees in the review channel. */
function buildReviewPost(c, reports) {
  let status = STATUS_TEXT[c.status] ?? c.status;
  if (c.status === 'claimed' && c.claimed_by) status += ` by <@${c.claimed_by}>`;
  if (c.decided_by) status += ` (decided by <@${c.decided_by}>)`;

  const reporters = reports.map((r) => `<@${r.reporter_id}>`).join(', ');
  const reasons = reports
    .filter((r) => r.reason)
    .map((r) => `• <@${r.reporter_id}>: ${clip(r.reason, 200)}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`Flag #${c.id}`)
    .setURL(messageUrl(c))
    .setColor(COLORS[c.status] ?? 0x95a5a6)
    .addFields(
      { name: 'Status', value: status },
      { name: 'Message', value: `[Jump to message](${messageUrl(c)}) in <#${c.channel_id}>`, inline: true },
      { name: 'Posted by', value: c.author_id ? `<@${c.author_id}>` : 'Unknown', inline: true },
      { name: 'Copy of the message when first flagged', value: clip(c.content_snapshot || '(no text)', 1000) },
      {
        name: `Flagged by ${reports.length} member${reports.length === 1 ? '' : 's'} (core team only)`,
        value: clip(reporters || 'None', 1000),
      }
    )
    .setFooter({ text: 'Reporters are visible to the core team only. Never share who flagged.' })
    .setTimestamp(c.created_at);
  if (reasons) embed.addFields({ name: 'Reasons', value: clip(reasons, 1000) });

  const decided = c.status === 'valid' || c.status === 'not_valid';
  const row = new ActionRowBuilder().addComponents(
    decided
      ? [
          new ButtonBuilder()
            .setCustomId(`flag:reopen:${c.id}`)
            .setLabel('Reopen')
            .setStyle(ButtonStyle.Secondary),
        ]
      : [
          new ButtonBuilder()
            .setCustomId(`flag:claim:${c.id}`)
            .setLabel("I'm on it")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(c.status === 'claimed'),
          new ButtonBuilder().setCustomId(`flag:valid:${c.id}`).setLabel('Valid concern').setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`flag:not_valid:${c.id}`)
            .setLabel('Not a concern')
            .setStyle(ButtonStyle.Secondary),
        ]
  );

  // Never ping anyone from the review post.
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

module.exports = { buildReviewPost, messageUrl };
