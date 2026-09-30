Topic requested: $ARGUMENTS

You run **forked**: the parent sees only what you return, so put the whole answer
(and any `Read more:` line) in your final message. If the "Topic requested" line
above is blank, no topic was given — print the menu near the end of this file and
ask which area they want. Otherwise follow the steps below.

## The procedure

**Step 1 — Find the skill folder.** It is the "Base directory for this skill" shown
above (`${CLAUDE_SKILL_DIR}`). Give every tool an **absolute** path inside it. In
Cowork a relative path is refused, and a Grep or Glob with no path silently searches
a different folder and finds nothing.

**Step 2 — Current-state layer first** (for "how does it behave now" questions).
Read `references/state/README.md`, then the matching `references/state/<domain>.md`.
If that page is large, grep `references/routing/sections.md` for `state:<page>` and
read only the matching section. For an exact name (flag, command, gate, env var,
setting), grep `references/state/registry.json` for it, including `renamed_to`.
Never Read `registry.json` or `author-facts.json` whole. The state layer overrides
any conflicting older lesson.

**Step 3 — Route.** Read every `references/routing/index-*.md` part. Each line is
`id · title · Lesson N · file:start-end · description · asks: … · read-more`. Pick
up to 3 lessons whose line fits the question.

**Step 4 — Grep.**
- Grep `references/routing/sections.md` for the question's key terms: each hit gives
  a lesson id and `file:line`.
- For each exact identifier in the question (env var, function, gate id, flag,
  command, event name), grep the lesson files `references/[0-9][0-9]-*.md` in
  content mode with line numbers (`-n`), capped at about 30 lines. Map each hit to a
  lesson with the index's `file:start-end` ranges.
- When an identifier hits many lessons, prefer the lesson whose index line or
  heading is about it.

**Step 5 — Read** the chosen lessons' line ranges (at most 4 lessons). For a lesson
the index lists with sub-ranges (e.g. id 89), read only the matching sub-range.
`Read` refuses results over ~25k tokens, so never read a whole chapter file. If what
you read doesn't answer the question, make one more pick or grep, then stop.

**Step 6 — Version.** The corpus baseline is **v2.1.231**. Carry a version stamp
into the answer and qualify by lane (CLI, Cowork host-loop, VM-loop, cloud).
`bash <skill-dir>/scripts/check-version.sh` warns on drift where `claude` is on
PATH; optional.

**If there is no Grep tool** (a shell only): do Steps 2–5 with `grep -n` and
`sed -n 'START,ENDp' <file>` on the absolute paths. **In Cowork, if the file tools
can't open the folder**, find it from the VM shell with
`find /sessions -type d -path '*/skills/claude-code-internals' 2>/dev/null | head -1`
and use that absolute path with `grep -n` / `sed -n`.

## IDs are not the "Lesson N" numbers

For lessons 1–50 the id and the "Lesson N" number in the file headings disagree (the
Hooks System is id 32, printed "Lesson 10"). The index shows both; cite the **id**.
