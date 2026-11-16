# /anonymous-check

Lets LIMBO members privately flag a message for the core team.

## What members see

- `/anonymous-check link:<message link> reason:<optional>`, or right-click a message → **Apps → Flag anonymously**.
- Every reply is visible only to the member who used it. Other members never see who flagged.
- First flag: "Your flag was sent privately to the LIMBO core team for review."
- Someone already flagged it: "This message has already been flagged and is being reviewed by the team."
- They already flagged it themselves, or the team already reviewed it: they're told so, and nothing new is posted.
- Abuse limit: 5 new flags per member per hour (change with `MAX_FLAGS_PER_HOUR`). Members can't flag their own messages.

## What the core team sees

One post per flagged message in a private review channel, with:

- a link to the message, who posted it, and a copy of the text taken when it was first flagged (kept even if the message is deleted),
- **who flagged it and their reasons (core team only, as Cassey decided on 2026-11-16)**,
- buttons: **I'm on it**, **Valid concern**, **Not a concern**, and **Reopen** after a decision. Only members with the core role can press them, and the post records who decided.

More flags on the same message update the same post (the count goes up). The post never pings anyone.

## Setup (Nari)

Needs Node 22.13 or newer (uses the built-in `node:sqlite`, no native build). Flags are saved in `data/flags.db`.

**Bot permissions:** View Channel + Read Message History in channels members can flag from; View Channel, Send Messages and Embed Links in the review channel. Only the `Guilds` intent is needed.

**Review channel:** make it private to the core role. Anyone who can see that channel can see reporters.

### Option A: add it to Kira (discord.js 14)

```js
const { setupAnonymousCheck, commandDefinitions } = require('./anonymous-check/src');

setupAnonymousCheck(client, {
  reviewChannelId: process.env.REVIEW_CHANNEL_ID,
  coreRoleId: process.env.CORE_ROLE_ID,
  dbPath: './data/flags.db',
});
// and add ...commandDefinitions() to the list Kira registers with Discord
```

If Kira is not discord.js, the logic to port is in `src/store.js` (the duplicate check and rate limit, with tests) and the reply wording in `src/index.js`.

### Option B: run it as its own bot

```sh
cp .env.example .env        # fill it in yourself, never paste tokens in chat
npm install
npm run deploy-commands     # registers the command in the server
npm start
```

## Tests

`npm test` runs the duplicate, rate-limit and restart tests, plus the full flow against a fake Discord client (flag, second flag, outsider pressing a button, core decision, flag after review, three members flagging at once).

## Before it goes live

Per the LIMBO rules, member-facing changes need Josh's yes. Suggested: shadow-test in a staff-only channel first.
