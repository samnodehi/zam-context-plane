# @zam/adapter-telegram

The third reference adapter for the ZAM context plane (`docs/40`). It governs a Telegram bot's
**per-message** context, and it is the adapter that exercises the core's **`requestSignals` caller
tier** — because a message's *group-ness* or *is-a-reply* lives in **metadata**, not in the text the
deterministic router sees.

Same `docs/37 §5` contract as the OpenClaw (`docs/38`) and MCP (`docs/39`) adapters — a third surface,
no core change.

> **Honest scope:** no live Telegram transport (no token, no polling/webhook). The adapter operates on
> a provided bot context inventory + a Telegram `Update` object (Bot API shape) supplied as data, with
> a synthetic `example-bot.json`. Single-family by design: a group message is governed as
> `group_chat_behavior` even if its text is about code (the metadata signal wins).

## How it works

1. **Build** the bot's `BotComponent[]` (body + light governance) → a schema-valid registry.
2. **Derive signals** from the update metadata (`deriveSignals`):
   - `chat.type ∈ {group, supergroup}` → `group_chat_behavior` (via `requestSignals`, which takes
     precedence over the text router),
   - a reply (`reply_to_message`) → `history_sensitive`,
   - otherwise → `null`, so the deterministic **text router** classifies the message.
3. **Plan** (`plan()`) and **assemble** the prompt from the selected components only.

`governUpdate` does all three.

## Usage

```ts
import { governUpdate } from '@zam/adapter-telegram';

const { promptFamily, signals, prompt, stats } = governUpdate({
  components,                                   // the bot's context inventory
  update: { message: { message_id: 1, chat: { id: 1, type: 'group' }, text: 'hi all' } },
});
// promptFamily === 'group_chat_behavior' (from metadata); prompt includes the group-etiquette scaffold
```

### CLI

```bash
zam-telegram --bot ./example-bot.json --text "fix the build error" --chat-type private
zam-telegram --bot ./example-bot.json --text "hi everyone" --chat-type group   # group-etiquette surfaced
```

## Build & test

```bash
npm install   # links the workspace-local `context-plane` (file:../..); build the core first
npm run build
npm test
```
