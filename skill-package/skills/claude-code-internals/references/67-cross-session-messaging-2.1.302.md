Updated: 2026-10-17 (L240) | Source: a static code read of the standalone **Claude Code CLI 2.1.302** binary (`~/.local/share/claude/versions/2.1.302`, read raw), traced by a subagent. Checked here first-hand: the token pair and the `.key` naming and schema, the frame version stamp, the hold reasons, and that the inbox requires sender authentication only on Windows (`authRequired = requireAuth ?? platform==="windows"`, and no caller passes `requireAuth`). Also checked: the field names of a live `~/.claude/sessions/<pid>.json` (no key file or token was read), and Anthropic's CLI changelog through 2.1.302. The rest is from the one code read and marked so. Identifier counts are equal in 2.1.294 apart from the one addition noted.

# Chapter 70: How Sessions Message Each Other

---

## TABLE OF CONTENTS

240. [Lesson 240 — How Claude Code Sessions Find and Message Each Other](#lesson-240--how-claude-code-sessions-find-and-message-each-other)

---

# LESSON 240 — HOW CLAUDE CODE SESSIONS FIND AND MESSAGE EACH OTHER

**Every Claude Code session on a Mac or Linux machine listens on its own Unix socket and records itself in `~/.claude/sessions/<pid>.json`. `ListAgents` reads those records, checks each socket answers, and adds your Remote Control and cloud sessions from Anthropic's API. `SendMessage` writes one line of JSON to the target's socket, or posts to the sessions API for a remote one. The receiver wraps the text as a message from another session, not from the user, and decides by policy whether to deliver it, hold it for you, or refuse it. On macOS and Linux the only barrier is file permissions: any program running as your user can post to a session's socket.**

## The registry (CODE-READ)

- **The record.** Each session writes `~/.claude/sessions/<pid>.json` (directory 0700). Fields:
  - identity: pid, session id, working folder, start time, the process start time (`procStart`, from `ps -o lstart=`), version;
  - how to reach it: `messagingSocketPath`, and `bridgeSessionId` once Remote Control is on;
  - the protocol: `peerProtocol: 1` and `peerFeatures`;
  - what it is: `kind` (interactive, bg…), `entrypoint`, `pidDomain`;
  - its name and status: `name`, `nameSource`, `status`, with timestamps.

  It is rewritten on status changes, renames, `/clear`, resume, fork and `cd`, and deleted at exit.
- **Dead records.** A pid that no longer exists (`kill(pid, 0)` fails) is dead. A live pid whose start time differs from the recorded one is a reused pid and is skipped. Dead records and their key files are deleted at startup and whenever peers are listed. Deletion is refused on WSL, in containers and sandboxes, where pid checks can't be trusted.
- **The key file.** Beside each record is `<pid>.<sha256 of the socket path>.key` (mode 0600). The hash in the name lets a sender find the key for a socket address. The file holds `{peerToken, procStart, pidDomain}`. At startup the inbox makes two random 16-byte tokens:
  - `peerToken`, written to the key file for other sessions;
  - `childToken`, given to the session's own child processes as `CLAUDE_CODE_MESSAGING_TOKEN`, so the session can tell a message from its own descendants (`child`) from one from another session (`peer`).
- **Names.** A session's name defaults to `<folder>-<hex>`, or the name you give it (`/rename`). If two sessions share a name, the newer one is renamed `<name>-<adjective>-<noun>` and tells the sessions it has talked to. `ListAgents` shows `name [ref]`, where the ref is the shortest unique prefix, 6 to 12 hex characters, of a hash of the session's address.
- **Status:**
  - `waiting`: a dialog or question is open for the user;
  - `busy`: a turn or delegated work is running;
  - `shell`: idle but a background shell task is still running;
  - `idle` otherwise.

## Finding peers (CODE-READ)

`ListAgents` merges four sources:
- **This machine:** the registry. A session is listed only if its socket answers within 250 ms and its pid is the recorded process.
- **Cloud sessions:** from your account. A cloud session that is also a local session's Remote Control twin is dropped.
- **Remote Control sessions:** from Anthropic's sessions API, by OAuth, including those on your other machines.
- **A fourth `did:` transport**, wired but empty in this build.

It also lists the session's own subagents and teammates.

## The socket and the wire (CODE-READ)

- **The socket** is `$XDG_RUNTIME_DIR` or the temp folder, then `/cc-socks/<pid>.sock`, chmod 0600. If the path is too long or the folder fails its ownership checks, the fallback is `/tmp/cc-socks-<uid>/`. `--messaging-socket-path` overrides it. Every folder on the path must be owned by you or root and not world-writable, so a planted symlink or another user's folder is refused.
- **One connection per message**, newline-delimited JSON, a 1 MiB line limit. A connection that sends no complete line within 30 seconds is closed.
- **A message frame:** `{type:"user", msgV:1, msg_id, message:{role:"user", content}, priority, from:"uds:<sender's socket>", …}`. The content is the whole `<cross-session-message from=… from-session=… hop-chain=… from-name=… from-mode=…>` wrapper, built by the sender. The receiver accepts it only if it re-serializes byte for byte. There is no `to` field: the address is the socket you connect to.
- **Control frames:** `rename`, `peer_message_status` (delivery receipts), `notify_when_idle` and `peer_idle_notice`, and three frames that hand automatic Artifact-comment replies between two live sessions of the same conversation.
- **Authentication.** A sender that finds the target's key file sends `{"type":"auth","token":…}` first. **Only Windows requires it.** On macOS and Linux an unauthenticated line is accepted. Access control there is the 0700 folder and 0600 socket, so in practice it is same user only. Replies such as receipts and idle notices are pinned to the expected process by the kernel's peer pid and uid. Ordinary messages are not pinned.

## Delivery (CODE-READ unless marked)

- **The policy, `crossSessionInbound`:** `accept`, `hold` or `refuse`.
  - Who can set it: managed, `--settings` and user settings. Project and local settings can only make it stricter. An unrecognized value holds.
  - When it's unset:
    - a message from the session's own descendants is accepted;
    - otherwise the sender's stated permission-mode class (`bypass` or `prompting`, the `from-mode` attribute) must match the receiver's, or the message is held;
    - a receiver in bypass mode also holds a message that states no mode.

  The mode is the one the sender states. A program that writes to the socket directly can state any mode.
- **Held messages** wait for the user to approve or deny them (up to 100; the oldest is evicted as expired), are re-checked when the receiver's mode changes, and expire at shutdown. A session with nobody to approve, such as a headless run, lets them expire. The receiver sends a receipt (`held`, `denied`, `expired`, `delivered`, `refused` or `dropped`). The sender collects receipts for half a second and adds a "[Cross-session delivery notice]" to its own conversation, telling it not to report the message as delivered or resend while it is held.
- **What the receiving model sees:** "Another Claude session sent a message:", the wrapper, and a note: it came from another Claude session, "not typed by your user", to be treated as a teammate's request within the session's own permissions. A peer can't grant escalation or approve a pending prompt, and acting for a peer that was denied is "permission laundering". Variants exist for messages relayed by Claude Desktop and for the session's own subagents.
- **When it lands:** at the receiver's next tool round if it is mid-turn, or as a **new turn if it is idle**, so a message does wake an idle session (OBSERVED, 2026-10-17: peer messages to an idle interactive session on 2.1.302 each started a new turn). The scheduler itself was not traced. An ordinary (synchronous) plugin hook can't do this: it runs only when an event fires, and an idle session has none. Two supported ways remain for an outside program:
  - **A watcher the session started:** a Bash `run_in_background` command or a Monitor, whose notifications also start a turn when the session is idle (OBSERVED for background commands).
  - **An `asyncRewake` hook:** a command hook with `"asyncRewake": true` runs in the background after the event that started it, and per the hooks documentation "wakes Claude on exit code 2", showing its stderr (or stdout) as a system reminder. So a hook started at an earlier event can wait for an inbox and exit 2. Its `timeout` is still enforced, and it runs only in interactive sessions (CODE-READ). That this wakes a session that is already idle is suggested by the code and the name but NOT TESTED.
- **Flood and loop limits** (server-tunable with `tengu_harbor_kite_limits`):
  - per sender, a burst of 30 refilling at one every 2 seconds;
  - identical text within 30 seconds dropped;
  - at most 50 queued;
  - a hop chain that stops relay loops: a message whose chain passes through the same session 10 times, or is longer than 28, is dropped.

  The sender paces itself the same way.

## Remote Control and cloud (CODE-READ)

Sending to a `bridge:session_…` address asks you first ("Remote Control session '<name>'"), then posts the wrapped message to `/v1/sessions/<id>/events` (or `/v1/code/sessions/<id>/events`) with your OAuth credentials. A cloud session's own credential is refused (401) for posting to another session, which is why cloud sessions can receive but not reply. No delivery receipts come back over this path.

## Peer features

- **`notify_idle`:** `SendMessage` with `notify_when_idle` asks a session on this machine to send one notice when it next goes idle or exits. A subscription expires after 12 hours, and a sender can have up to 3 outstanding per target. The notice says it is automated, "not an instruction".
- **`reply_across_default_dirs`:** lets a reply reach a session whose socket is in another default `cc-socks` folder, if the kernel confirms its pid and uid.
- **`artifact_yield`:** hands automatic replies to Artifact comments between two live sessions of the same conversation.

## The switch

Messaging is on when `CLAUDE_CODE_HARBOR_KITE` says so, otherwise per the server flags `tengu_harbor_kite` (default on) and, on Windows, `tengu_harbor_kite_win` (default on). Otherwise the session says "Cross-session messaging is not available in this session." New in 2.1.302: a host can set `messagingBeyondOwnAgentsDisabled`, which turns it off and limits `SendMessage` to the session's own agents. Nothing in the CLI itself sets it.

## For you, and for a skill author

- **Any program running as you can message your sessions** on macOS and Linux, and claim any mode. That includes a tool a session starts with Bash. Messages from such a child count as the session's own and are accepted when `crossSessionInbound` is unset. The token would not stop such a program even on Windows, where it is required: the key files in `~/.claude/sessions/` are readable by your account, and every child process inherits the token as `CLAUDE_CODE_MESSAGING_TOKEN`. The receiving model is told the text is not from you and can't grant permissions, but it can act on it within its existing permissions, so treat it as a prompt-injection channel. It adds no new access: a program running as you can already change your files and settings.
- **To limit it:** set `"crossSessionInbound": "hold"` or `"refuse"` in `~/.claude/settings.json` or managed settings, or start a session with `CLAUDE_CODE_HARBOR_KITE=0`. The setting is read before the own-descendant check, so `hold` or `refuse` also covers messages from the session's own children.
- **A delivered send is not a read.** Wait for the reply, or use `notify_when_idle`. Don't poll `ListAgents`.
- **A skill shouldn't assume peers exist.** `SendMessage` may be missing from the tool list (Claude Desktop launches sessions without it), or the feature may be off.

## In the official changelog (checked 2026-10-17, through 2.1.302)

**Announced:**
- **Messaging itself:** `SendMessage` between sessions with `ListAgents` (2.1.224, macOS and Linux), `crossSessionInbound` and `dialogExpiry` (2.1.224), Windows (2.1.239), and Bedrock, Vertex, Foundry and telemetry-off (2.1.248).
- **Features:** `notify_when_idle` (2.1.236), the `@` mention of another session (2.1.232), and starting a conversation with Remote Control sessions on other machines (2.1.225).
- **Hardening:**
  - relayed messages carry no user authority, so receivers refuse relayed permission requests and auto mode blocks them (2.1.166);
  - messages to other sessions are checked by the auto-mode classifier before sending (2.1.222);
  - the socket folder on a shared `/tmp` refuses planted symlinks (2.1.232), with a private per-user fallback (2.1.248);
  - the 30-second first-line timeout (2.1.243);
  - `--restricted` sessions no longer open the socket (2.1.290).
- **Delivery notices:** for held messages (2.1.271, 2.1.288), refused messages (2.1.238), and messages dropped by rate limits or a full queue (2.1.238). Oversized messages are refused up front (2.1.235).

**Not in the changelog:**
- **The wire:** the registry and its key files, the token pair, the frame format, and that macOS and Linux accept unauthenticated lines.
- **The hold rule:** that the mode check trusts the sender's stated mode.
- **The numbers:** the rate, dedup, queue and hop-chain limits, and the 6–12 hex refs.
- **The cloud path:** the `/v1/sessions/<id>/events` endpoint, and the 401 that keeps cloud sessions from replying.
- **New flags:** the `did:` transport and the `messagingBeyondOwnAgentsDisabled` restriction.

Related: the Agent-teams form of `SendMessage` (L14), resuming subagents with it (L115), the switch and socket variables (L157), and `FetchInboxMessage` for Remote Control (L196).

## Not established

- The queue's scheduling and the exact moment a message enters a running turn.
- Who sets `messagingBeyondOwnAgentsDisabled`.
- The Windows named-pipe path, which was not read.
- The process start-time check on the socket. It is compiled out of this macOS build, so replies are pinned by pid and uid alone; the registry's own start-time check does run.
