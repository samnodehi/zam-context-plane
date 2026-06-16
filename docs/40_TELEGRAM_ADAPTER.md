# 40 Telegram Adapter — Phase 4d (third adapter; the request-signals tier)

> **Document type:** Scoping + implementation note — Phase 4d (Telegram bot context governance).
> **Status:** Implemented. New package `packages/adapter-telegram/` (open reference adapter).
> **Authority:** Additive new package + CI extension. **No change** to `src/**`, `schemas/**`,
> `fixtures/**`, `tests/**`, `packages/runtime/**`, `packages/types/**`, the other adapters, or
> `benchmarks/**`.
> **Canonical sources:** `docs/37 §5` (adapter contract), `docs/38`/`docs/39` (prior adapters),
> `schemas/inputs/request-signals.schema.json` + `src/core/api.ts` (the `requestSignals` caller tier),
> `docs/05` (registry shape). Locked: **F1 = open-core**; **Sam-decided 2026-06-16** (more adapters).

---

## 1. Purpose & what is new here

The third adapter, on a conversational surface, chosen because it exercises two things the OpenClaw
and MCP adapters did not:

1. **The `group_chat_behavior` / `history_sensitive` families.** A Telegram message's "group-ness" or
   "this is a reply to earlier" lives in **metadata**, not in the message text — so the deterministic
   *text* router cannot see it.
2. **The core's `requestSignals` caller tier.** `plan()` accepts an optional `requestSignals`
   (`promptFamily` + `familyConfidence` + `injectionSuspect`) that **takes precedence over the text
   router** (`src/core/api.ts`). It exists precisely for callers that know something the text doesn't.
   This is the first adapter to use it.

So the Telegram adapter governs a bot's per-message context by **deriving `requestSignals` from the
Telegram update metadata** (chat type, reply) and otherwise deferring to the deterministic text router.

## 2. Honest scope

No live Telegram transport (no bot token, no long-polling/webhook). The adapter operates on a
**provided bot context inventory** + a **Telegram update object** (the standard Bot API `Update`/
`Message` shape) supplied as data, with a synthetic `example-bot.json`. A real bot feeds its live
update; the governance is real and reusable. Single-family by design: a group message is governed as
`group_chat_behavior` even if its text is about code (the metadata signal wins) — documented, not a bug.

## 3. Design decisions

- **DQ-1 — Location: `packages/adapter-telegram/` (`@zam/adapter-telegram`).** Core via
  `"context-plane": "file:../.."`. CI extended.
- **DQ-2 — Input.** `{ components: BotComponent[], update: TelegramUpdate }`. `BotComponent` is a
  *light* shape (`id, type, title, summary, body` + optional governance) — the bot author lists their
  context components; the adapter fills type defaults + the loadable-by-construction normalization
  (critical⇒protected; hard-protected⇒not `omit`) and measures `tokensApprox`/`charsApprox`/`hash`
  from the body. `TelegramUpdate` mirrors the Bot API (`message.chat.type`, `message.reply_to_message`,
  `message.text`).
- **DQ-3 — Metadata → `requestSignals` (the novel part).** `deriveSignals(update)`:
  - `chat.type ∈ {group, supergroup}` ⇒ `{ promptFamily: 'group_chat_behavior', familyConfidence:
    0.95, injectionSuspect: false }`.
  - else `message.reply_to_message` present ⇒ `{ promptFamily: 'history_sensitive', familyConfidence:
    0.9, injectionSuspect: false }`.
  - else ⇒ **`null`** — no signals passed, so the core's deterministic **text router** classifies the
    message (coding/research/greeting/…). This cleanly exercises *both* tiers.
- **DQ-4 — No per-turn model call** (`docs/37 DQ-5`): metadata rules + the deterministic core only.
- **DQ-5 — Assembly.** Same as OpenClaw: concatenate the selected components' bodies; report savings.

## 4. Modules

- `src/types.ts` — `RegistryEntry` (the 18-field shape), `BotComponent`, the Telegram Bot-API shapes,
  `RequestSignals`.
- `src/build.ts` — `buildRegistry(components) → { registry, bodies }` (defaults + normalization +
  measured sizes + SHA-256).
- `src/signals.ts` — `deriveSignals(update) → RequestSignals | null` (DQ-3).
- `src/assemble.ts` — `assemblePrompt(plan, registry, bodies)`.
- `src/index.ts` — `governUpdate({ components, update }) → { promptFamily, signals, prompt, stats,
  plan, registry }`.
- `src/cli.ts` — `zam-telegram --bot <file> --text "<msg>" [--chat-type group] [--reply]` (builds a
  synthetic update from flags).
- `example-bot.json` — a sample bot inventory (persona, safety, group-etiquette, history, coding/
  small-talk skills, memory, output).

## 5. What this is NOT / out of scope

- **Not** a live bot (no token/polling/webhook). - **Not** multi-family (metadata signal wins for
  group/reply). - **Not** a change to the core, schemas, fixtures, runtime, or the other adapters.

## 6. Verification

- **First-run result (2026-06-16):** suite **10/10** green. CLI on the example bot: a greeting →
  `simple_greeting` **via the text router** (59.8% saved), a coding message → `coding_build_debug` via
  the text router (40.2%), a **group** message → `group_chat_behavior` **via the requestSignals tier**
  (35.5%, group-etiquette surfaced), a **reply** → `history_sensitive` via requestSignals (42.6%,
  history surfaced) — both metadata tiers and the text router exercised, safety preserved.
- New `@zam/adapter-telegram` suite: `deriveSignals` maps group⇒`group_chat_behavior`,
  reply⇒`history_sensitive`, plain-private⇒`null`; **a group message surfaces the group-etiquette
  scaffold via the requestSignals tier**; **a private coding message defers to the text router and
  surfaces the coding skill**; a greeting surfaces minimal context; a reply surfaces history; **safety
  components (`never`-omit) are always present**; partition completeness.
- CI extended: build + test the adapter (same `file:` link pattern).
- Root **757/757**, runtime **354/354**, OpenClaw **12/12**, MCP **11/11** untouched.

## 7. Execution contract — Phase 4d

| | |
|---|---|
| **Allowed (create)** | `docs/40_TELEGRAM_ADAPTER.md`; `packages/adapter-telegram/**` |
| **Allowed (modify)** | `.github/workflows/ci.yml` (add the telegram adapter build+test steps only) |
| **Forbidden** | `src/**`, `schemas/**`, `fixtures/**`, `tests/**`, `packages/runtime/**`, `packages/types/**`, `packages/adapter-openclaw/**`, `packages/adapter-mcp/**`, `benchmarks/**` |
| **Deliverable** | A runnable Telegram governance adapter (`governUpdate` + CLI) exercising the `requestSignals` caller tier, with a synthetic bot inventory and a green suite; CI builds+tests it |

---

*4d demonstrates the third surface and the caller-signal tier: the deterministic core governs an
OpenClaw workspace (`docs/38`), an MCP capability set (`docs/39`), and now a Telegram bot's per-message
context — all on the same `docs/37 §5` contract, no core change.*
