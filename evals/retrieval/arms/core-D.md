Topic requested: $ARGUMENTS

You run **forked**: the parent sees only what you return, so put the whole answer
(and any `Read more:` line) in your final message. If the "Topic requested" line
above is blank, no topic was given — print the menu near the end of this file and
ask which area they want.

## What this skill contains

Everything is plain files in the skill folder — the "Base directory for this skill"
shown above (`${CLAUDE_SKILL_DIR}`). Use your own judgement about which files and
tools a question needs. Always give tools **absolute** paths into that folder.

- `references/NN-*.md` — 56 chapter files holding 218 lessons about Claude Code and
  Claude Cowork internals, read out of the shipping binaries. Each lesson starts at a
  `LESSON` heading. Chapters run up to 151 KB; one lesson (id 89) is 107 KB.
- `references/routing/index-*.md` — the table of contents, in parts. One line per
  lesson: id · title · "Lesson N" as printed in the file · `file:start-end` ·
  description · example questions the lesson answers · a `read-more` URL on some.
  Lessons too big to read in one go list sub-ranges beneath their line. Each part
  fits in one Read.
- `references/routing/sections.md` — every heading of every lesson and state page,
  one per line, with its lesson id (or state page) and `file:line`. About 60 KB;
  built to be grepped for a term.
- `references/state/*.md` — the **current-state** view, one page per domain (Cowork
  architecture, permissions, control protocol, credential channels, plugins/skills/
  hooks, models, commands, memory); `state/README.md` lists them. Each page is
  stamped `as_of` a binary version and may carry a `read_more:` URL. Two pages are
  large (59 KB, 46 KB); their sections are in `sections.md`.
- `references/state/registry.json` (328 KB) and `state/author-facts.json` (153 KB) —
  records keyed by exact names (env vars, gates, commands, settings, tools), with
  status (live, dark, renamed via `renamed_to`, removed) and provenance lesson ids.
- `references/troubleshooting.json` — symptom patterns → lesson ids.
  `references/cross-references.json` — lesson id → related lesson ids.

## Facts that bite

- `Read` refuses any result over ~25k tokens (about 48 KB of this text). Big files:
  read a line range, or grep.
- For lessons 1–50 the "Lesson N" in the file headings is **not** the lesson id (the
  Hooks System is id 32, printed "Lesson 10"). The index shows both; cite the id.
- In Cowork, file tools run on the host and can see this folder; the shell runs in a
  VM that cannot, and a Grep or Glob given no absolute path silently searches a
  different folder and finds nothing. Some surfaces have a shell but no Grep tool.
- The corpus baseline is **v2.1.231**. `scripts/check-version.sh` (run with `bash`)
  warns when the running `claude` differs; it is silent where `claude` is not on
  PATH, as in Cowork. Optional.

## Rules

1. For how anything behaves **now**, the state layer overrides any conflicting older
   lesson. Lessons are history, corrections and provenance.
2. Carry a version stamp into the answer and qualify by lane (CLI, Cowork host-loop,
   VM-loop, cloud) where it matters.
3. Cite lesson ids.

Example (one sensible path, not a required one): "what changed about /cost in
v2.1.118?" → grep `sections.md` for `/cost` → a heading in lesson 88 with its
`file:line` → read that section → answer, citing id 88.
