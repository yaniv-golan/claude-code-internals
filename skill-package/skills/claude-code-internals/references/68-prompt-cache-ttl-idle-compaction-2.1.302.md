Updated: 2026-10-17 (L241) | Source: a code read, done here first-hand, of the standalone **Claude Code CLI 2.1.302** binary (read raw): the cache-TTL choice, the cache-state tracker, the terminal idle-compaction rules (`tengu_sunny_locket`), the cloud sleep compactor, the SessionStart hook fields, and the ScheduleWakeup tool text. Also the CLI's cached server flags in `~/.claude.json` on 2026-10-17 (a claude.ai subscription), and Anthropic's CLI changelog through 2.1.302.

# Chapter 71: The Prompt Cache's Lifetime

---

## TABLE OF CONTENTS

241. [Lesson 241 — Does a Session Know When Its Prompt Cache Expires?](#lesson-241--does-a-session-know-when-its-prompt-cache-expires)

---

# LESSON 241 — DOES A SESSION KNOW WHEN ITS PROMPT CACHE EXPIRES?

**The Claude Code program does: it picks each request's cache lifetime (1 hour or 5 minutes), tracks when the cache was last used, and can compact an idle conversation shortly before the cache expires. The model doesn't: nothing in the conversation tells it how long the cache has left. It sees the lifetime only in the description of the `/loop` wake-up tool. A hook can learn the cache's staleness when a session is resumed.**

## The lifetime (CODE-READ)

The first of these that applies sets a request's cache lifetime:
1. **Environment:** `CLAUDE_CODE_PROMPT_CACHE_TTL`, or `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` for subagents.
2. **Settings:** `promptCacheTtl`, or `subagentPromptCacheTtl`.
3. **The agent's frontmatter:** `experimental.cacheTtl` (`"5m"` or `"1h"`).
4. **`ENABLE_PROMPT_CACHING_1H`** (or `ENABLE_PROMPT_CACHING_1H_BEDROCK` on Bedrock) → 1 hour.
5. **Otherwise, a claude.ai subscription:** 1 hour (reason `subscriber`) when the request's type is on a server allowlist (`tengu_prompt_cache_1h_config`), else 5 minutes. A session in usage overage drops to 5 minutes.

On this machine's cached flags (2026-10-17) the allowlist was the main conversation (`repl_main_thread*`), `sdk`, `auto_mode`, `rolling_compact`, `agent_classifier`, `prompt_suggestion`, `away_summary`, `memdir_relevance` and `extract_memories`. **Subagents aren't on it, so they use 5 minutes** unless a setting says otherwise.

## What the program tracks (CODE-READ)

For each request stream the program keeps the cache's state: tokens written and missed, the cause of the last miss, the last cache activity, an expiry time (last activity plus the lifetime) and whether it is still warm. `/cost` and the status line's `prompt_cache` field show it, including a likely cause for a miss such as "idle past the TTL" (changelog 2.1.251, 2.1.260).

## Idle compaction: acting before expiry (CODE-READ)

**In the terminal** (changelog 2.1.299), an idle conversation is compacted shortly before its 1-hour cache expires, so your next message doesn't reprocess all of it. The server flag `tengu_sunny_locket` sets:
- `mode`: `off`, `log`, `compact` or `compact_on_return` (`compact` on this machine on 2026-10-17);
- `minTokens`: default 200,000, at least 100,000; `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` overrides it;
- `fireAtFraction`: default 0.9 of the lifetime, so about 54 minutes into an hour, kept between 0.5 and 0.95.

It runs only when:
- compaction is on and `"idleCompaction"` isn't `false` in settings (`/config` has an "Idle compaction" row from 2.1.302);
- the cache is the 1-hour kind and still warm;
- the conversation is over the token minimum;
- no newer request has been sent;
- usage isn't near its limit.

Afterwards a notice says "Compacted while idle, before the prompt cache expired", or with `compact_on_return`, "Compacted after an hour idle, using a summary written while you were away".

**In cloud sessions** a separate sleep compactor does the same at 90% of the cache's life. It needs `CLAUDE_CODE_SLEEP_COMPACT` and a cloud (`CLAUDE_CODE_REMOTE`) session, and a minimum of 150,000 tokens by default (`CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` again). It also won't fire while a permission prompt is open.

## What the model is told

- **No countdown.** Nothing in the conversation tells the model when the cache will expire.
- **The lifetime, in one tool.** The `ScheduleWakeup` tool, used by `/loop`, describes the session's lifetime: "This session's requests use a 1-hour Anthropic prompt-cache TTL" (or the 5-minute variant). It explains that with an hour nothing needs keeping warm, and that with 5 minutes a wait over 300 seconds re-reads the conversation uncached. A session without that tool hears nothing about it.

## What a hook is told (CODE-READ)

A `SessionStart` hook for a resumed or forked session (`source` `resume` or `fork`) receives:
- `seconds_since_last_response`;
- `context_tokens`: the size the first request will send;
- `prompt_cache_likely_expired`: true when that time exceeds the cache lifetime;
- `estimated_cache_write_usd`: the estimated cost of re-caching, at the managed price if one is set, else list price.

A hook could pass these to the model as context; nothing does by default.

## For a skill or plugin author

- **A workflow that waits** (for a build, a delegated task or another session) pays nothing while it waits. Each time it wakes, it sends the whole conversation again: cheap if the cache is still warm, a full re-cache if it isn't.
- **What a wake costs.** At Anthropic's standard rates, reading a warm cache costs 0.1× the input price. Re-writing a cold one costs 1.25× on the 5-minute cache and **2× on the 1-hour cache**, which a subscriber's main conversation uses. A cache read also refreshes the lifetime: the client measures expiry from the last request that read or wrote the cache (CODE-READ), as the API documents.
- **On a 1-hour cache, wake once when the work is done** for anything under about 55 minutes. Every wake inside the hour is warm, which is why the `ScheduleWakeup` text calls extra keep-warm wakes waste. For a wait you expect to run past the hour, one wake shortly before the hour costs 0.1× and saves a 2× re-write. A large conversation has an alternative: idle compaction (below) shrinks it at about 54 minutes instead. A wake before then cancels that compaction, so pick one.
- **On a 5-minute cache, a wait over 5 minutes costs one re-cache**, roughly 1.25× the conversation's input price at standard rates. A keep-warm turn every 4–5 minutes costs about 0.1× each plus its output and the context it adds, so a few pings can cost less than one re-cache on a big conversation. Measure with `/cost` before building on that.
- **Subagents are on 5 minutes by default.** A subagent that waits long will re-cache its own context.
- **Expect compaction during a long idle.** In a 200K-token-plus terminal session, idle compaction may summarize the conversation about 54 minutes into an hour's wait. Keep anything a workflow must remember exactly (task ids, briefs, file paths) in files, not only in the conversation. Any request in between (a wake turn, a notification, your message) restarts the timer, because it is set to 90% of the lifetime from the last cache activity, and a newer request cancels a pending one (CODE-READ).
- **Give back what compaction drops with a `SessionStart` hook on `compact`.** `compact` is one of the hook's five `source` values (`startup`, `resume`, `clear`, `compact`, `fork`; CODE-READ, CLI 2.1.305), and a matcher of `compact` runs the hook only after a compaction. Its `additionalContext` reaches the model in the summarized conversation. RELAYED (the nc-skills project's NanoClaw bot, 2026-10-20/21, one run): the hook fired after each of six automatic compactions, and about 2,000 characters of re-added task prompt kept the task's final delivery steps, which the summaries had dropped. The re-added text opened by telling the model to carry on where it left off, and the work already done was not repeated. Keep the text in a file the hook reads and under 10,000 characters: past that, Claude Code puts the text in a file and gives the model the path and only the first 2,000 characters, without asking it to read the rest (documented). If the hook shortens the text itself, cut from the middle: that bot's first version, over its own 9,000-character limit, would have kept the start and cut the end, which is where the delivery steps are. The pattern itself is documented (the hooks guide's "Re-inject context after compaction"); the field result after automatic compactions is not.

## In the official changelog (checked 2026-10-17, through 2.1.302)

**Announced:**
- **Lifetime settings:** `ENABLE_PROMPT_CACHING_1H` and `FORCE_PROMPT_CACHING_5M` (2.1.108), `promptCacheTtl` and `subagentPromptCacheTtl` (2.1.243), and the agent frontmatter `experimental.cacheTtl` (2.1.248).
- **Visibility:** the `/cost` prompt-cache line and the status line's `prompt_cache` object (2.1.251), and the likely cause of a miss (2.1.260).
- **The resume hook fields:** staleness and the estimated re-cache cost (2.1.251).
- **Idle compaction:** in the terminal at about 54 minutes for 200K+ token conversations (2.1.299), `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS` and `"idleCompaction": false` (2.1.299), and the `/config` row (2.1.302).

**Not in the changelog:**
- **The lifetime rules:** the server allowlist that decides which request types get an hour, and that subagents aren't on it.
- **The flag:** `tengu_sunny_locket` and its modes.
- **The cloud sleep compactor:** `CLAUDE_CODE_SLEEP_COMPACT` and its 150,000-token default.
- **The model's view:** that the model is told the lifetime only through `ScheduleWakeup`.

## Not established

- Whether a session in overage that drops to 5 minutes is told mid-session.
- Exactly when the expiry clock restarts (any cache read, or only writes).
- The server's actual cache eviction, which the client can only estimate.
