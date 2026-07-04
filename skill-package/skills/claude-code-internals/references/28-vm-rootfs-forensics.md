Updated: 2026-07-04 | Source: Direct forensic inspection of three **local, already-downloaded** artifacts on a machine with Claude Desktop installed — Claude.app (Desktop) `app.asar` **1.18286.0**, the staged in-VM agent ELF `claude-code-vm/2.1.197/claude`, and (newly used in this chapter) the **golden VM guest disk image itself**, `~/Library/Application Support/Claude/vm_bundles/claudevm.bundle/rootfs.img` (a ~10 GB raw, unencrypted ext4 image). No live Cowork session was required — the image retains leftover `systemd-journald` binary log entries from real past sessions run on this machine. Companion chapter to Ch21/L104 (which first suggested grepping `rootfs.img` for `.mount` unit names) and to the `cowork-architecture.md` state page (which this chapter's findings feed into).

# Chapter 31: VM Rootfs Forensics — The Mount Inventory, Session-Slug Format, and `coworkd`

---

## TABLE OF CONTENTS

117. [Lesson 117 -- VM Rootfs Forensics: The Mount Inventory, Session-Slug Format, and coworkd](#lesson-117----vm-rootfs-forensics)

---

# LESSON 117 -- VM ROOTFS FORENSICS: THE MOUNT INVENTORY, SESSION-SLUG FORMAT, AND `coworkd`

## The question this closes out

A prior investigation (probe reasoning about Cowork's host/VM filesystem split) claimed: the VM
shell's home directory and the file-tool-visible `outputs/` mount are architecturally different
kinds of things — not merely "not currently shared" but structurally incapable of being shared —
while `outputs/` (and a handful of sibling paths) are genuinely bridged. Ch21/L104 and the
`cowork-architecture.md` state page already asserted the *behavior* (home/tmp vanish at session
end; only `outputs/`, `uploads/`, and `.claude/skills` are known to be real systemd mounts, the
last one confirmed by a single verbatim unit-name grep). This chapter pins down the *complete*
mechanism with a full inventory, using a class of artifact the prior chapters didn't reach for:
the raw guest disk image, searchable directly because it's an unencrypted file on the host disk.

## Part A — a third artifact class: the raw guest disk image

Every prior Cowork chapter drew from two artifact classes: the Desktop `app.asar` (host-side
Electron/React code) and the staged in-VM agent ELF (`claude-code-vm/<ver>/claude`, the CLI
binary that runs as the agent inside the guest under VM-loop, or that gets used as the general
Linux/arm64 build). Neither contains Cowork-VM-specific mount configuration — `mnt/outputs` and
friends are templated host-side and injected via the system prompt / spawn env, not compiled into
either binary (confirmed: `mnt/outputs` has zero occurrences in the in-VM ELF).

The **third artifact** is `~/Library/Application Support/Claude/vm_bundles/claudevm.bundle/
rootfs.img` — the golden ext4 filesystem image the VM boots from. It is a raw, unencrypted disk
image sitting on the host disk, so host tools can grep it directly without mounting it, running
the VM, or having a live session. Two things make it useful:

- **Static content**: any file baked into the golden image (systemd unit files, scripts) is
  literal text in the image, greppable the same way L104 found the `.claude/skills` mount unit.
- **Leftover dynamic content**: this image is not reset between every session on a real machine —
  it retains `systemd-journald` binary log entries (the `MESSAGE=`/`UNIT=`/`INVOCATION_ID=`
  journal export format) from real historical sessions, including their actual session slugs,
  timestamps, and mount lifecycle events. This is forensic evidence of *actual past runs*, not
  just the image's static configuration.

**Practical tool-speed note.** For a 10 GB file, tool choice matters enormously: a naive Python
`mmap` + `re.finditer` scan over the whole image did not finish in several minutes and had to be
killed; BSD `grep -a -c` took ~80 seconds for a single substring count; `rg` (ripgrep) found the
same patterns in **3–7 seconds**. When forensically scanning multi-GB raw images, reach for `rg`
first.

## Part B — the mount inventory

Grepping `rootfs.img` for the systemd unit-name pattern `mnt-*.mount` (extending L104's single
verified example, `.claude-skills`) surfaces the **complete** set of host-shared mount points:

```
mnt-.claude-projects.mount
mnt-.claude-skills.mount
mnt-.claude.mount
mnt-Downloads.mount        (a user-connected folder)
mnt-Lizo.mount             (a user-connected folder, custom name)
mnt-output.mount           (a *different*, user-named connected folder — singular)
mnt-outputs.mount          (the reserved, always-present outputs directory)
mnt-uploads.mount
mnt-work.mount             (a user-connected folder)
mnt-ziggie.mount           (a user-connected folder, custom name)
```

Each is instantiated per session as `sessions-<slug>-mnt-<name>.mount`, and journald confirms
real teardown events, e.g.:

```
sessions-zealous‑vigilant‑einstein-mnt-uploads.mount: Deactivated successfully
sessions-zealous‑vigilant‑einstein-mnt-outputs.mount: Deactivated successfully
sessions-lucid‑awesome‑bell-mnt-outputs.mount: Deactivated successfully
sessions-affectionate‑serene‑gates-mnt-outputs.mount: Deactivated successfully
sessions-fervent‑determined‑gauss-mnt-outputs.mount: Deactivated successfully
```

**The negative result is the important one: there is no `.mount` unit for the guest's home
directory or for `/tmp`.** This is the structural "why" behind a fact the skill already stated
behaviorally (home/tmp aren't shared, vanish at session end): they were never bind-mounted in the
first place. `outputs/`, `uploads/`, `.claude` (+ its `skills`/`projects` subpaths), and each
user-connected folder are first-class, individually lifecycled bind mounts; home and `/tmp` are
just ordinary paths inside the guest's own private, non-shared root filesystem. "Shared vs.
VM-local" in Cowork is not a permissions distinction layered on top of one filesystem — it is two
different *kinds* of storage (bind mount vs. plain guest-local path), decided per-path at image
build / session-provisioning time, not per-file at runtime.

This also explains the delete-restriction behavior documented in `cowork-control-protocol.md`
(the `fileDeleteApprovedMounts` array, mounts default `rw` not `rwd`): a file written under a
mounted path (`outputs/`) is subject to that mount's delete policy, while a file written to the
guest's private home is an ordinary local file with no such restriction (and no host visibility
either) — the two are governed by unrelated mechanisms because they are unrelated kinds of
storage.

### Addendum (v2.23.0): `.host-home` is a reserved mount *name* that was never a mount unit at all

This mount inventory's negative result — no unit for home or `/tmp` — leaves one loose thread:
the independent `claude-cowork-headless-emulator` project reserves a mount name `.host-home` in
its own mount-naming logic, alongside `outputs`/`uploads`/`.projects`. That name never appears in
this chapter's `mnt-*.mount` grep above, and cross-referencing `app.asar` 1.18286.0 explains why —
it was never meant to. `.host-home` is a **synthetic path-translation index**, gated dark by
GrowthBook gate `2614807392` (Ch25/L108, off by default). When on, the system prompt tells the
agent:

> "Paths seen under `.host-home` correspond to absolute host paths:
> `/sessions/<id>/mnt/.host-home/<sub>` is `<real-absolute-host-path>`."

A resolver pair (`ece()` encodes an absolute host path into the `.host-home/<sub>` form; `uCe()`
decodes it back) lets the agent *reference* a host path in a tool call without that path — or the
guest's home directory generally — ever being bind-mounted. This is consistent with, and extends,
Part B's core finding: "shared vs. VM-local" isn't just bind-mount-vs-private-path, there's a
third category — a **virtual namespace that resolves to host paths without any filesystem bridge
at all**. A future forensic pass should not expect to find a `mnt-.host-home.mount` unit even with
the gate flipped on; the absence is structural, not merely a dark-gate artifact of this snapshot.

## Part C — session slugs, confirmed with real examples

`/sessions/<slug>/` has been documented since L89/L107 as the VM-loop path pattern, but no chapter
had shown real slug values. The journald leftovers do:

```
zealous-vigilant-einstein
lucid-awesome-bell
affectionate-serene-gates
fervent-determined-gauss
```

Confirmed format: Docker-style `<adjective>-<adjective>-<noun>` triples. This is a cosmetic but
occasionally load-bearing detail — code or a skill that tries to validate or parse a
`/sessions/<id>` path can rely on the three-hyphenated-word shape rather than assuming a UUID.

## Part D — `coworkd` and per-session Unix users

The same journald leftovers surface a previously undocumented in-guest process name and its
behavior:

```
claude coworkd[529]: [process] user zealous-vigilant-einstein already exists: uid=1439 gid=1439
claude coworkd[529]: [process:oneshot-f7198ed3-...] spawn: name=zealous-vigilant-einstein cmd=bash
  args=[-c SCRIPTS="/var/folders/.../claude-hostloop-plugins/4ad6ecf40a032f57/skills/deck-review/scripts" ...]
```

Two new facts:

1. **`coworkd`** is the in-guest daemon (hostname `claude` in the log, PID namespace inside the
   VM) responsible for session lifecycle: it provisions a **dedicated Unix user account** (uid/gid)
   per session slug and spawns commands (`bash -c ...`) as that user via named `oneshot-<uuid>`
   jobs. This is an *additional* isolation layer beyond mounts/VM boundary — session isolation
   inside the guest is also enforced at the Unix-user level, not just the filesystem-mount level.
2. **The idempotent "already exists" check** (`user <slug> already exists: uid=1439 gid=1439`)
   is suggestive of session-to-VM multiplexing: `coworkd` checks for an existing user before
   creating one, which is the behavior you'd expect if a single booted guest can host more than
   one session's provisioning over its lifetime, rather than every session getting a freshly
   booted VM. This reading is corroborated circumstantially by a live, empty `vm_bundles/warm/
   <hash>/` directory observed alongside `claudevm.bundle/` — consistent with a "warm pool" of
   pre-booted VM instances that sessions get assigned into on demand. **This multiplexing
   interpretation is an inference from indirect evidence (an idempotent-user-check log line + the
   existence/naming of a `warm/` directory), not a direct confirmation** — no artifact was found
   that explicitly states "one guest serves N sessions." Treat it as a plausible working model,
   not a settled fact, until a chapter finds a stronger signal (e.g. two active sessions' log
   lines interleaved with the same guest boot/PID-1 identity).

The `oneshot-<uuid>` spawn line is also a fresh, concrete example of the host-loop plugin-staging
mechanism from `cowork-architecture.md` ("Plugin roots"): the `SCRIPTS` path
(`/var/folders/.../claude-hostloop-plugins/<hash>/skills/deck-review/scripts`) is a real
`claude-hostloop-plugins/<hash>` staging directory for an actual marketplace skill
(`deck-review`), confirming that mechanism end-to-end rather than by code-reading alone.

## Methodology note (the transferable lesson)

When a Desktop feature's configuration isn't in either of the two "obvious" binaries (`app.asar`,
the in-VM agent ELF), consider whether it's baked into a **third artifact** the client ships but
that isn't a binary at all — here, a raw disk image. Raw, unencrypted VM/container images are
greppable exactly like any other file, and if they aren't wiped between runs on a given machine,
they can carry forensic evidence (journald, shell history, temp files) of real historical
activity that a fresh code-read of the shipping binaries can never show you. Tool choice matters
at this scale: prefer `rg` over `grep -a` or naive scripting-language regex for multi-GB scans —
the difference was roughly 15–20x in this investigation.

**Cross-references.** Ch21/L104 (first `.claude/skills` mount-unit grep, methodology origin) ·
`cowork-architecture.md` state page (Filesystem & mounts, Plugin roots sections — this chapter's
findings are folded in there) · Ch24/L107 (`/sessions/<id>` path pattern, host-loop tool
partition) · Ch20/L89 (host-loop plugin staging, `claude-hostloop-plugins/<hash>`) · Ch26/L109
(`fileDeleteApprovedMounts`, the delete-restriction mechanism this chapter explains structurally) ·
Ch25/L108 (gate `2614807392`, the `.host-home` skeleton-path index this chapter's v2.23.0 addendum
explains structurally).
