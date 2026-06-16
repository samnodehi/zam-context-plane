# 02 System Comparison Matrix

> **Version:** Quality Pass 1 — 2026-05-05
> **Status:** Research-grade draft. Not yet decision-grade for all rows.
> **Confidence scale:** 🟢 High (official docs/repo verified) · 🟡 Medium (partial primary docs) · 🔴 Low (category-level or local observation)

## Summary Table

| System | Confidence | License | Primary Runtime Model | Prompt/Context Strategy | Tool Execution Model | Memory/History Strategy | Evaluation/Testing Support | Useful Ideas to Adapt | Risks / Things to Avoid |
|--------|:----------:|---------|-----------------------|-------------------------|----------------------|-------------------------|----------------------------|-----------------------|-------------------------|
| OpenClaw | 🟡 | MIT — verify local LICENSE before reuse | Local CLI / Gateway daemon | Prior investigation suggests static scaffold injection (AGENTS.md, TOOLS.md, skills dir); source mapping pending | Tool execution model needs source verification | History/session strategy needs source verification | Needs verification | Dir-based context injection, workspace files | Massive static context observed; details pending source mapping |
| Claude Code | 🟢 | Proprietary (Anthropic) | CLI + Cloud API (Claude model) | Auto-compaction at ~95% capacity; CLAUDE.md persistent rules; just-in-time file retrieval via tools | Local exec with user approval; subagents for isolated tasks | Compaction-based summarization; /compact manual trigger | Internal Anthropic evals (not public) | Subagent context isolation; persistent CLAUDE.md; /compact with custom instructions | Compaction can lose granular details; exact thresholds may change |
| Codex task runners | 🔴 | Varies by implementation | Varies (CLI / IDE extension) | Varies; common pattern: heuristic chunking, window-sliding | Varies; sandboxed or whitelisted | Sliding window truncation | Varies | Task scoping patterns | Category-level: no single authoritative implementation |
| Cursor / IDE agents | 🟡 | Proprietary | Embedded IDE extension | RAG over codebase; @-mentions for explicit file inclusion; cursor location awareness | LSP integrations; terminal execution | Ephemeral chat history; codebase vector index | Not publicly documented | @-mention explicit inclusion; line-range targeting | Tightly coupled to editor state; implementation details not public |
| Antigravity IDE | 🔴 | Proprietary (Google DeepMind) | IDE Extension + MCP servers | Tool descriptors with schemas; LLM manages context selection | MCP server abstractions | KIs (Knowledge Items); conversation logs | Not publicly documented | KI distilled memory pattern; strict tool schemas | Local observation only; not independently verifiable; dev environment, not reusable |
| OpenHands | 🟢 | MIT | Dockerized runtime + Web UI | Event stream (Observations & Actions) | Sandboxed Docker environments | Event stream with truncation; trajectories | SWE-bench integration | Strict Agent/Environment separation; event stream arch | Heavy Docker dependency; enterprise/ dir has separate license |
| SWE-agent | 🟢 | MIT | CLI + Docker sandbox | Agent-Computer Interface (ACI); custom commands optimizing tool output for context savings | Dockerized bash shell | Linear trajectory log | Native SWE-bench integration | ACI: reshaping tool outputs to save context window | Focused on git/GitHub issue resolution |
| LangGraph | 🟢 | MIT | Python/TS library | State graph; explicit context via typed state schemas | Python/JS function calls | Checkpointers (MemorySaver, PostgresSaver); Thread IDs; Store for cross-thread memory | LangSmith integration | Explicit state schemas; graph-based routing; checkpointer/store separation | Graph definitions can become complex; LangSmith is proprietary |
| CrewAI | 🟢 | MIT | Python library | Role-playing prompts; sequential/hierarchical processes | Tool abstractions (LangChain-compatible + MCP) | Unified Memory: scoped hierarchical memory with composite scoring (semantic + recency + importance); consolidation & dedup | Built-in testing concept; observability integrations (Langfuse, etc.) | Hierarchical scoped memory; composite scoring; memory consolidation | Multi-agent token explosion; LLM-dependent scope inference |
| n8n AI workflows | 🟡 | Sustainable Use License (source-available, not OSI open-source) | Node.js server / hosted cloud | Visual node outputs mapped to prompt template variables | HTTP requests, DB queries, custom code nodes | Window Buffer Memory nodes; DB-backed memory nodes | Visual per-node debugging | Visual traceability of context flow | Not OSI open-source; hidden context limits in node configs; .ee. files have enterprise license |
| Telegram Bot agents | 🔴 | Varies by implementation | Webhooks / long polling | Message history arrays; typically hard-capped at N recent messages | Bot API; inline keyboards; callback queries | Redis/DB keyed by chat_id | Varies; typically low | Cheap ephemeral history; chat_id isolation | Category-level: blind truncation risks losing key context |

## System Details & Extended Notes

### OpenClaw
OpenClaw is used as a **reference and research target only**, not as the product core (see Decision Log #1). The GitHub repository is MIT-licensed, but the local LICENSE file should be verified before any code reuse. Detailed source mapping is deferred to `docs/03_OPENCLAW_SOURCE_MAP.md`. Evaluation/testing support has not yet been verified from source.

### Claude Code
Compaction triggers automatically at approximately **~95% context capacity** (not 80% as previously stated) — sourced from [official GitHub discussions](https://github.com/anthropics/claude-code) and [community guides citing Anthropic docs](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code); exact threshold may vary by version. Users can manually trigger via `/compact` with custom preservation instructions ([official docs](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)). `CLAUDE.md` is loaded at session start as part of the system prompt and **survives compaction** ([official docs](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)). Subagents operate in isolated context windows ([official docs](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)). The exact context window size depends on the underlying Claude model.

### CrewAI Memory (Verified from official docs)
CrewAI has evolved significantly. The current unified Memory system uses:
- **Hierarchical scopes** (e.g., `/project/alpha`, `/agent/researcher`)
- **Composite scoring**: `semantic_weight × similarity + recency_weight × decay + importance_weight × importance`
- **LLM-assisted** scope inference, categorization, and importance scoring
- **Consolidation**: deduplication and merging of near-duplicate records
- **Source tracking and privacy**: memories can be tagged with source and marked private

### Antigravity IDE
Observations are based **solely on local product usage** within this workspace. Antigravity is our development environment, not a system we can freely reuse or reference as an external source. Knowledge Items (KIs) and conversation log persistence are observed behaviors, not officially documented features.

### n8n License Correction
n8n is **not** "Faircode" in the license sense. It uses the **Sustainable Use License**, which is source-available but **not** OSI-approved open-source. Files containing `.ee.` in their path are under a separate enterprise license. Free for internal/personal use; restricted for resale or hosting as a service.

---

## Research Notes & Source Citations

### OpenClaw
- **Source quality:** 🟡 Official GitHub (license verified) + local project references
- **Sources:**
  - [OpenClaw GitHub Repository](https://github.com/openclaw/openclaw) — MIT License confirmed via web search
  - [OpenClaw LICENSE](https://github.com/openclaw/openclaw/blob/main/LICENSE) — verify local copy before reuse
  - `PROJECT_MASTER_PLAN.md` (local workspace)
- **Notes:** Used as reference/testbed per project rules. Architecture claims (scaffold injection, tool exec model, history strategy) are from prior local investigation and need verification during source mapping phase.

### Claude Code
- **Source quality:** 🟢 Official docs + official GitHub
- **Sources:**
  - [Claude Code Documentation](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code) — official docs
  - [Claude Code GitHub](https://github.com/anthropics/claude-code) — official GitHub (proprietary, not open-source)
- **Verified facts:** CLAUDE.md persistence ([official docs](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)), /compact command ([official docs](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)), subagent isolation ([official docs](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)), auto-compaction at ~95% ([GitHub](https://github.com/anthropics/claude-code) + community sources; exact threshold needs exact source pinpointing)
- **Corrected:** Previous draft said "80%" threshold — official sources indicate ~95%

### OpenHands
- **Source quality:** 🟢 Official GitHub
- **Sources:**
  - [OpenHands GitHub Repository](https://github.com/All-Hands-AI/OpenHands) — MIT License confirmed
  - [OpenHands Docs](https://docs.all-hands.dev/) — official docs
- **Verified facts:** MIT license (core), event stream architecture, Docker sandbox, SWE-bench eval
- **Note:** `enterprise/` directory has separate license terms

### SWE-agent
- **Source quality:** 🟢 Official GitHub + academic paper
- **Sources:**
  - [SWE-agent GitHub Repository](https://github.com/princeton-nlp/SWE-agent) — MIT License confirmed
  - [SWE-agent Paper](https://arxiv.org/abs/2405.15793) — academic source
- **Verified facts:** MIT license, ACI concept, Docker sandbox, SWE-bench native eval

### LangGraph
- **Source quality:** 🟢 Official GitHub + official docs
- **Sources:**
  - [LangGraph GitHub Repository](https://github.com/langchain-ai/langgraph) — MIT License confirmed
  - [LangGraph Persistence Docs](https://langchain-ai.github.io/langgraph/concepts/persistence/) — official docs
- **Verified facts:** MIT license, state graph model, checkpointers (MemorySaver, PostgresSaver), Thread IDs, Store for cross-thread state

### CrewAI
- **Source quality:** 🟢 Official GitHub + official docs
- **Sources:**
  - [CrewAI GitHub Repository](https://github.com/crewAIInc/crewAI) — MIT License confirmed
  - [CrewAI Memory Documentation](https://docs.crewai.com/concepts/memory) — official docs (read in full)
- **Verified facts:** MIT license, unified hierarchical scoped memory, composite scoring formula, LLM analysis layer, consolidation, source tracking, privacy controls
- **Corrected:** Previous draft said "short-term, long-term, and shared memory" — current docs show a unified scoped memory system with composite scoring

### Antigravity IDE (Google DeepMind)
- **Source quality:** 🔴 Local observation only
- **Sources:** Direct observation during workspace usage
- **Notes:** KIs, conversation logs, MCP server tool abstractions are observed behaviors. No official public documentation available to cite. Antigravity is our dev environment; do not cite as if independently verifiable.

### Cursor
- **Source quality:** 🟡 Product site + community reports
- **Sources:**
  - [Cursor](https://cursor.com/) — product site
- **Notes:** @-mention file inclusion and RAG over codebase are widely reported. Internal prompt assembly details are not public.

### n8n
- **Source quality:** 🟡 Official docs + official GitHub
- **Sources:**
  - [n8n GitHub Repository](https://github.com/n8n-io/n8n) — Sustainable Use License
  - [n8n AI Documentation](https://docs.n8n.io/advanced-ai/) — official docs
- **Corrected:** Previous draft said "Faircode" license — actual license is "Sustainable Use License" (source-available, not OSI open-source)

### Telegram Bot Agents
- **Source quality:** 🔴 Category-level patterns
- **Sources:**
  - [Telegram Bot API](https://core.telegram.org/bots/api) — official API
- **Notes:** This is a category, not a single product. Patterns described are common but vary by implementation.

### Codex Task Runners
- **Source quality:** 🔴 Category-level patterns
- **Sources:** Various implementations; no single authoritative source
- **Notes:** This is a category. Claims like "heuristic chunking" and "window-sliding" are common patterns, not verified for any specific product.

---

## Known Weak Claims / To Verify Next

| # | Claim | Current Status | Action Required |
|---|-------|----------------|-----------------|
| 1 | OpenClaw evaluation/testing support | "Needs verification" | Inspect OpenClaw source for test harness, eval scripts, or benchmark support |
| 2 | OpenClaw tool execution model ("sync local shell/script") | Unverified assumption from PROJECT_MASTER_PLAN | Verify from source code during source mapping phase |
| 3 | OpenClaw history strategy ("raw turn history appending") | Unverified assumption | Verify — may have summarization or truncation |
| 4 | Cursor internal prompt assembly details | Not publicly documented | Accept as 🟡 unless official docs surface |
| 5 | Antigravity KI system details | Local observation only | Cannot verify independently; mark 🔴 |
| 6 | Claude Code exact context window size | Depends on model version; not hardcoded | Do not state fixed number (e.g., "200k") without model-specific qualification |
| 7 | Codex task runner claims ("heuristic chunking", "blind execution") | Category-level generalizations, unsourced | Replaced with "varies by implementation" |
| 8 | n8n license was listed as "Faircode" | Corrected to "Sustainable Use License" | Verified ✅ |
| 9 | CrewAI memory was listed as "short-term, long-term, and shared" | Corrected to unified scoped memory with composite scoring | Verified from official docs ✅ |
| 10 | Claude Code compaction threshold was listed as "80%" | Corrected to ~95% | Verified from official docs/GitHub ✅ |
