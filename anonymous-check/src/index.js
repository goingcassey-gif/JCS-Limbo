'use strict';

const {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  Events,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const { parseMessageLink } = require('./links');
const { FlagStore } = require('./store');
const { buildReviewPost } = require('./review');

const SLASH_NAME = 'anonymous-check';
const MENU_NAME = 'Flag anonymously';

// What the member sees. Only they see it (ephemeral).
const REPLIES = {
  created:
    'Thank you. Your flag was sent privately to the LIMBO core team for review. Other members can\'t see that you flagged it.',
  added:
    'This message has already been flagged and is being reviewed by the team. We added your flag to it, thank you.',
  already_flagged_by_you: "You've already flagged this message. It's being reviewed by the team.",
  already_reviewed:
    'This message has already been reviewed by the team. If something new has happened, please open a ticket.',
  rate_limited:
    "You've sent a lot of flags in the last hour. Please wait a little, or open a ticket if it's urgent.",
  bad_link:
    "That doesn't look like a message link. On the message, open the menu and choose **Copy Message Link**, then paste it here.",
  other_server: 'You can only flag messages from this server.',
  not_found: "I couldn't find that message. It may have been deleted, or it's in a channel I can't see.",
  own_message: "You can't flag your own message.",
  error: 'Something went wrong and your flag was not sent. Please try again or open a ticket.',
};

/** Slash command + right-click menu definitions, for registering with Discord. */
function commandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName(SLASH_NAME)
      .setDescription('Privately flag a message for the core team to review')
      .setContexts(InteractionContextType.Guild)
      .addStringOption((o) =>
        o.setName('link').setDescription('The message link (Copy Message Link)').setRequired(true).setMaxLength(200)
      )
      .addStringOption((o) =>
        o.setName('reason').setDescription('Optional: what worries you about it').setMaxLength(300)
      ),
    new ContextMenuCommandBuilder()
      .setName(MENU_NAME)
      .setType(ApplicationCommandType.Message)
      .setContexts(InteractionContextType.Guild),
  ].map((c) => c.toJSON());
}

function snapshotOf(message) {
  const parts = [];
  if (message.content) parts.push(message.content);
  const files = [...(message.attachments?.values?.() ?? [])].map((a) => a.name);
  if (files.length) parts.push(`[${files.length} attachment(s): ${files.join(', ')}]`);
  if (message.embeds?.length) parts.push(`[${message.embeds.length} embed(s)]`);
  if (message.stickers?.size) parts.push('[sticker]');
  return parts.join('\n').slice(0, 1800) || '(no text)';
}

function isCoreMember(member, coreRoleId) {
  const roles = member?.roles;
  if (!roles) return false;
  return Array.isArray(roles) ? roles.includes(coreRoleId) : roles.cache?.has(coreRoleId) ?? false;
}

/**
 * Add /anonymous-check to an existing discord.js Client (for example Kira).
 *
 * The client needs the Guilds intent. The bot needs View Channel and Read
 * Message History in channels members can flag from, and View Channel,
 * Send Messages and Embed Links in the review channel.
 *
 * @param {import('discord.js').Client} client
 * @param {object} opts
 * @param {string} opts.reviewChannelId private core-team channel
 * @param {string} opts.coreRoleId      role allowed to press the review buttons
 * @param {string} [opts.dbPath='./data/flags.db']
 * @param {number} [opts.maxPerHour=5]
 * @param {(err: unknown) => void} [opts.onError]
 */
function setupAnonymousCheck(client, opts) {
  if (!opts?.reviewChannelId || !opts?.coreRoleId) {
    throw new Error('setupAnonymousCheck needs reviewChannelId and coreRoleId');
  }
  const store = opts.store ?? new FlagStore(opts.dbPath ?? './data/flags.db');
  const maxPerHour = opts.maxPerHour ?? 5;
  const onError = opts.onError ?? ((e) => console.error('[anonymous-check]', e));

  // Review-post updates for one case run one at a time, so a case never gets two posts.
  const queues = new Map(); // caseId -> tail promise

  function syncReviewPost(caseId) {
    const prev = queues.get(caseId) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => doSyncReviewPost(caseId));
    const tail = run.catch(() => {});
    queues.set(caseId, tail);
    tail.then(() => { if (queues.get(caseId) === tail) queues.delete(caseId); });
    return run;
  }

  /** Post the review card for a case, or update it if it already exists. */
  async function doSyncReviewPost(caseId) {
    const c = store.getCase(caseId);
    if (!c) return;
    const channel = await client.channels.fetch(opts.reviewChannelId);
    const payload = buildReviewPost(c, store.listReports(c.id));
    if (c.review_message_id) {
      const post = await channel.messages.fetch(c.review_message_id).catch((err) => {
        if (err?.code === 10008) return null; // review post was deleted: post a fresh one
        throw err;
      });
      if (post) {
        await post.edit(payload);
        return;
      }
    }
    const post = await channel.send(payload);
    store.setReviewMessage(caseId, post.id);
  }

  async function handleFlag(interaction, target, reason) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (target.guildId !== interaction.guildId) return interaction.editReply(REPLIES.other_server);

    let message;
    try {
      const channel = await client.channels.fetch(target.channelId);
      message = await channel.messages.fetch(target.messageId);
    } catch {
      return interaction.editReply(REPLIES.not_found);
    }
    if (message.author?.id === interaction.user.id) return interaction.editReply(REPLIES.own_message);

    const result = store.submitFlag(
      {
        guildId: target.guildId,
        channelId: target.channelId,
        messageId: target.messageId,
        authorId: message.author?.id,
        snapshot: snapshotOf(message),
        reporterId: interaction.user.id,
        reason,
      },
      { maxPerHour }
    );

    if (result.outcome === 'created' || result.outcome === 'added') {
      // A failed post is retried the next time anyone flags this message.
      await syncReviewPost(result.case.id).catch(onError);
    }
    return interaction.editReply(REPLIES[result.outcome]);
  }

  async function handleButton(interaction) {
    const [, action, idText] = interaction.customId.split(':');
    const caseId = Number(idText);
    if (!isCoreMember(interaction.member, opts.coreRoleId)) {
      return interaction.reply({ content: 'Only the core team can review flags.', flags: MessageFlags.Ephemeral });
    }
    if (!store.getCase(caseId)) {
      return interaction.reply({ content: `Flag #${caseId} was not found.`, flags: MessageFlags.Ephemeral });
    }
    let c;
    if (action === 'claim') c = store.claim(caseId, interaction.user.id);
    else if (action === 'valid' || action === 'not_valid') c = store.decide(caseId, action, interaction.user.id);
    else if (action === 'reopen') c = store.reopen(caseId);
    else return;
    await interaction.update(buildReviewPost(c, store.listReports(caseId)));
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === SLASH_NAME) {
        const target = parseMessageLink(interaction.options.getString('link', true));
        if (!target) return interaction.reply({ content: REPLIES.bad_link, flags: MessageFlags.Ephemeral });
        return handleFlag(interaction, target, interaction.options.getString('reason'));
      }
      if (interaction.isMessageContextMenuCommand() && interaction.commandName === MENU_NAME) {
        const m = interaction.targetMessage;
        return handleFlag(interaction, { guildId: m.guildId, channelId: m.channelId, messageId: m.id }, null);
      }
      if (interaction.isButton() && interaction.customId.startsWith('flag:')) {
        return handleButton(interaction);
      }
    } catch (err) {
      onError(err);
      const reply = { content: REPLIES.error, flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.editReply(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
  });

  return { store };
}

module.exports = { setupAnonymousCheck, commandDefinitions, REPLIES, SLASH_NAME, MENU_NAME, isCoreMember, snapshotOf };
