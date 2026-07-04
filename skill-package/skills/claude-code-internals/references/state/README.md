# Current-state layer

This directory is the **mutable "as of version X" truth layer**. The lesson
chapters (`../NN-*.md`) are immutable provenance — corrections there land as
new prose, so facts about one feature scatter across chapters. Each file here
states the *current* behavior of one domain, stamped with the binary versions
it reflects, and cites its source lessons in frontmatter.

- `registry.json` — structured records for enumerable facts (env vars, slash
  commands, gates, API betas, hook events, control-protocol subtypes, tools,
  IPC interfaces). Schema: see `scripts/validate-state.js`.
- `<domain>.md` — one page per domain, flat frontmatter:
  `domain` (= filename), `title`, `as_of_cli`, `as_of_desktop` (optional),
  `sources` (JSON array of lesson IDs), `updated` (YYYY-MM-DD).

Status semantics vary by kind (deliberate, don't "fix"):
- `slash-command` / `env-var` / `tool`: user/agent **reachability** — `live`
  means it works when invoked (the three-gate rule: registration, master
  array, empirical). `dark-launched` = present but gated off; `kill-switched`
  = hardcoded off; `disabled` = registered with isEnabled false.
- `gate`: the decoded fcache **on/off state** at the last capture (`live` =
  ON, `dark-launched` = OFF).
- `ipc-interface`: binary **contract presence + operability** — `live` means
  the interface exists and its methods function when called; UI reachability
  is a separate concern noted in the summary (presence of an IPC interface
  is a contract, not a shipped UI). `dark-launched` = present but
  functionally dead behind an off gate (e.g. `LocalPlugins`).

Rules:
1. When a new chapter lands, update the affected records/pages **in the same
   release** and bump their `as_of*` stamps (see CLAUDE.md update workflow).
2. Never delete history from lessons; supersede it here.
3. `node scripts/validate-state.js` must pass before every commit that
   touches this directory. `node scripts/state.js --audit` shows what has
   not been reconciled to the newest baseline.
