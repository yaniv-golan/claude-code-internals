# Claude Code Source Deep Dive -- Complete Lesson Extractions
## 10 Lessons: Full Technical Content

---

# LESSON 1: Vim Mode Implementation (Lesson 31)
**Source:** https://www.markdown.engineering/learn-claude-code/31-vim-mode

## Overview
Claude Code implements a full vim keybinding engine in TypeScript across five files (`src/vim/`) totaling ~700 lines. The system uses pure functions, explicit state machines, and discriminated unions for correctness.

## Core Architecture Files

### 1. types.ts -- State Machine Types

The complete vim state is a discriminated union with two modes:

```typescript
export type VimState =
  | { mode: 'INSERT'; insertedText: string }
  | { mode: 'NORMAL'; command: CommandState }
```

**CommandState** tracks parsing progress mid-command sequence:

```typescript
export type CommandState =
  | { type: 'idle' }
  | { type: 'count'; digits: string }
  | { type: 'operator'; op: Operator; count: number }
  | { type: 'operatorCount'; op: Operator; count: number; digits: string }
  | { type: 'operatorFind'; op: Operator; count: number; find: FindType }
  | { type: 'operatorTextObj'; op: Operator; count: number; scope: TextObjScope }
  | { type: 'find'; find: FindType; count: number }
  | { type: 'g'; count: number }
  | { type: 'operatorG'; op: Operator; count: number }
  | { type: 'replace'; count: number }
  | { type: 'indent'; dir: '>' | '<'; count: number }
```

**PersistentState** survives across commands:

```typescript
export type PersistentState = {
  lastChange: RecordedChange | null
  lastFind:   { type: FindType; char: string } | null
  register:   string
  registerIsLinewise: boolean
}
```

**Named Key Constants:**

```typescript
export const OPERATORS = {
  d: 'delete',
  c: 'change',
  y: 'yank',
} as const satisfies Record<string, Operator>

export const SIMPLE_MOTIONS = new Set([
  'h', 'l', 'j', 'k',
  'w', 'b', 'e', 'W', 'B', 'E',
  '0', '^', '$',
])

export const FIND_KEYS = new Set(['f', 'F', 't', 'T'])
```

### 2. transitions.ts -- Transition Table

Main dispatcher function:

```typescript
export function transition(
  state: CommandState,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  switch (state.type) {
    case 'idle':          return fromIdle(input, ctx)
    case 'count':         return fromCount(state, input, ctx)
    case 'operator':      return fromOperator(state, input, ctx)
    case 'operatorCount': return fromOperatorCount(state, input, ctx)
    case 'operatorFind':  return fromOperatorFind(state, input, ctx)
    case 'operatorTextObj': return fromOperatorTextObj(state, input, ctx)
    case 'find':          return fromFind(state, input, ctx)
    case 'g':             return fromG(state, input, ctx)
    case 'operatorG':     return fromOperatorG(state, input, ctx)
    case 'replace':       return fromReplace(state, input, ctx)
    case 'indent':        return fromIndent(state, input, ctx)
  }
}
```

**Return Type:** `TransitionResult` contains optional next state and optional execute callback.

**Shared Input Handler:**

```typescript
function handleNormalInput(
  input: string,
  count: number,
  ctx: TransitionContext,
): TransitionResult | null {
  if (isOperatorKey(input)) {
    return { next: { type: 'operator', op: OPERATORS[input], count } }
  }
  if (SIMPLE_MOTIONS.has(input)) {
    return {
      execute: () => {
        const target = resolveMotion(input, ctx.cursor, count)
        ctx.setOffset(target.offset)
      },
    }
  }
  return null
}
```

**operatorCount State (Compound Counts):**

```typescript
function fromOperatorCount(state, input, ctx) {
  if (/[0-9]/.test(input)) {
    const newDigits = state.digits + input
    const parsedDigits = Math.min(parseInt(newDigits, 10), MAX_VIM_COUNT)
    return { next: { ...state, digits: String(parsedDigits) } }
  }
  const motionCount = parseInt(state.digits, 10)
  const effectiveCount = state.count * motionCount
  const result = handleOperatorInput(state.op, effectiveCount, input, ctx)
  if (result) return result
  return { next: { type: 'idle' } }
}
```

**MAX_VIM_COUNT = 10000** prevents performance catastrophes.

**Repeat Find Implementation:**

```typescript
function executeRepeatFind(reverse: boolean, count: number, ctx: TransitionContext): void {
  const lastFind = ctx.getLastFind()
  if (!lastFind) return
  let findType = lastFind.type
  if (reverse) {
    const flipMap: Record<FindType, FindType> = { f: 'F', F: 'f', t: 'T', T: 't' }
    findType = flipMap[findType]
  }
  const result = ctx.cursor.findCharacter(lastFind.char, findType, count)
  if (result !== null) ctx.setOffset(result)
}
```

### 3. motions.ts -- Pure Cursor Math

Three exported pure functions:

```typescript
export function resolveMotion(key: string, cursor: Cursor, count: number): Cursor {
  let result = cursor
  for (let i = 0; i < count; i++) {
    const next = applySingleMotion(key, result)
    if (next.equals(result)) break
    result = next
  }
  return result
}

export function isInclusiveMotion(key: string): boolean {
  return 'eE$'.includes(key)
}

export function isLinewiseMotion(key: string): boolean {
  return 'jkG'.includes(key) || key === 'gg'
}
```

**Motion Categories:**

| Category | Keys | Method |
|----------|------|--------|
| Character | h l | `left()` / `right()` |
| Line (logical) | j k | `downLogicalLine()` / `upLogicalLine()` |
| Line (visual) | gj gk | `down()` / `up()` |
| Word (small-w) | w b e | `nextVimWord()` / `prevVimWord()` / `endOfVimWord()` |
| Word (WORD) | W B E | `nextWORD()` / `prevWORD()` / `endOfWORD()` |
| Line positions | 0 ^ $ | `startOfLogicalLine()` / `firstNonBlank...()` / `endOfLogicalLine()` |
| File | G gg | `startOfLastLine()` / `startOfFirstLine()` |

### 4. operators.ts -- Text Mutations

**Entry Points:**

- **executeOperatorMotion**: `dw`, `c$`, `y^` -- calls `resolveMotion`, converts to byte range respecting inclusive/linewise flags
- **executeOperatorFind**: `dfx`, `ctY` -- uses `cursor.findCharacter()` then computes inclusive range
- **executeOperatorTextObj**: `diw`, `ca(`, `yi"` -- delegates to `findTextObject()` from textObjects.ts
- **executeLineOp**: `dd`, `cc`, `yy` -- handles doubled operators and edge case of last line

**Core Mutation Function:**

```typescript
function applyOperator(
  op: Operator,
  from: number,
  to: number,
  ctx: OperatorContext,
  linewise: boolean = false,
): void {
  let content = ctx.text.slice(from, to)
  if (linewise && !content.endsWith('\n')) content = content + '\n'
  ctx.setRegister(content, linewise)

  if (op === 'yank') {
    ctx.setOffset(from)
  } else if (op === 'delete') {
    const newText = ctx.text.slice(0, from) + ctx.text.slice(to)
    ctx.setText(newText)
    ctx.setOffset(Math.min(from, newText.length - 1))
  } else if (op === 'change') {
    const newText = ctx.text.slice(0, from) + ctx.text.slice(to)
    ctx.setText(newText)
    ctx.enterInsert(from)
  }
}
```

**cw Special Case:**

```typescript
if (op === 'change' && (motion === 'w' || motion === 'W')) {
  let wordCursor = cursor
  for (let i = 0; i < count - 1; i++) {
    wordCursor = motion === 'w' ? wordCursor.nextVimWord() : wordCursor.nextWORD()
  }
  const wordEnd = motion === 'w'
    ? wordCursor.endOfVimWord()
    : wordCursor.endOfWORD()
  to = cursor.measuredText.nextOffset(wordEnd.offset)
}
```

**Image Reference Guard:** `cursor.snapOutOfImageRef()` called on operator range boundaries to prevent partial `[Image #N]` placeholders.

### 5. textObjects.ts -- Structural Selection

Main entry point:

```typescript
export function findTextObject(
  text: string,
  offset: number,
  objectType: string,
  isInner: boolean,
): TextObjectRange {
  if (objectType === 'w')
    return findWordObject(text, offset, isInner, isVimWordChar)
  if (objectType === 'W')
    return findWordObject(text, offset, isInner, ch => !isVimWhitespace(ch))

  const pair = PAIRS[objectType]
  if (pair) {
    const [open, close] = pair
    return open === close
      ? findQuoteObject(text, offset, open, isInner)
      : findBracketObject(text, offset, open, close, isInner)
  }
  return null
}
```

**Delimiter Pair Table:**

```typescript
const PAIRS: Record<string, [string, string]> = {
  '(': ['(', ')'],  ')': ['(', ')'],  b: ['(', ')'],
  '[': ['[', ']'],  ']': ['[', ']'],
  '{': ['{', '}'],  '}': ['{', '}'],  B: ['{', '}'],
  '<': ['<', '>'],  '>': ['<', '>'],
  '"': ['"', '"'],  "'": ["'", "'"],  '`': ['`', '`'],
}
```

**Bracket Pair Algorithm (Depth Counting):**

```typescript
for (let i = offset; i >= 0; i--) {
  if (text[i] === close && i !== offset) depth++
  else if (text[i] === open) {
    if (depth === 0) { start = i; break }
    depth--
  }
}
```

**Quote Pair Algorithm:** Linear scan + pairing (0-1, 2-3, 4-5) without nesting due to symmetry.

**Unicode Safety:** Uses `Intl.Segmenter` for grapheme segmentation before scanning.

## Context Interfaces (Dependency Inversion)

**OperatorContext:**

```typescript
export type OperatorContext = {
  cursor:      Cursor
  text:        string
  setText:     (text: string) => void
  setOffset:   (offset: number) => void
  enterInsert: (offset: number) => void
  getRegister: () => string
  setRegister: (content: string, linewise: boolean) => void
  getLastFind: () => { type: FindType; char: string } | null
  setLastFind: (type: FindType, char: string) => void
  recordChange:(change: RecordedChange) => void
}
```

**TransitionContext:**

```typescript
export type TransitionContext = OperatorContext & {
  onUndo?:      () => void
  onDotRepeat?: () => void
}
```

No React, Ink, or UI framework imports in vim files. All side effects flow through context callbacks.

## State Diagram

```
[*] --> idle
idle --> count : digit 1-9
idle --> operator : d / c / y
idle --> find : f F t T
idle --> g : g
idle --> replace : r
idle --> indent : > or <
idle --> idle : execute (motion / action)
count --> count : digit 0-9
count --> operator : d / c / y
count --> idle : execute (motion / action)
operator --> operatorCount : digit
operator --> operatorTextObj : i / a
operator --> operatorFind : f F t T
operator --> operatorG : g
operator --> idle : execute (dd cc yy or motion)
operatorCount --> operatorCount : digit
operatorCount --> idle : execute
operatorFind --> idle : execute (char received)
operatorTextObj --> idle : execute (obj type received)
find --> idle : execute (char received)
g --> idle : execute (gg / gj / gk)
operatorG --> idle : execute or cancel
replace --> idle : execute (char received)
indent --> idle : execute (>> or <<)
```

## Special Commands Implementation

**Dot Repeat (.):** Calls `ctx.onDotRepeat?.()`. Caller replays `RecordedChange` by reconstructing context and re-running execute function.

**Find/Till and Repeat:** `;` and `,` read stored `PersistentState.lastFind`, flip direction if needed, repeat search.

**Replace Character (r):** Cancels replace if input is empty string (Backspace/Delete pressed).

**G and gg Navigation:** Check `count === 1` as sentinel for "no count given."

## Key Design Principles

1. **Pure Functions Throughout:** No mutations within vim engine
2. **Exhaustive Type Checking:** TypeScript discriminated unions enforce handler completeness at compile time
3. **Zero UI Dependencies:** All side effects through context callbacks
4. **Compound Counts:** `operatorCount` state multiplies counts (`2d3w` = 6 words)
5. **Grapheme Safety:** `Intl.Segmenter` for correct unicode handling
6. **No Magic Strings:** All keys as named constants with `as const satisfies` type refinement

## Quiz Answers

1. **Answer: B** -- Pressing `d` returns `{ type: 'operator', op: 'delete', count: 1 }`
2. **Answer: C** -- `3d2w` = 3 x 2 = 6 words (counts are multiplied)
3. **Answer: B** -- Quotes are symmetric (no nesting), requiring linear pairing algorithm
4. **Answer: B** -- TypeScript exhaustive switch checking on discriminated union
5. **Answer: C** -- After `d` is `operator` state; digit in `fromOperator` transitions to `operatorCount`

---

# LESSON 2: The Keybindings System (Lesson 33)
**Source:** https://www.markdown.engineering/learn-claude-code/33-keybindings

## Architecture Overview

The system transforms raw terminal bytes into actionable commands via five pipeline stages: **Terminal Decode -> Binding Config -> Key Matching -> Chord Resolution -> React Dispatch**.

## Stage 1: Terminal Parsing

`parse-keypress.ts` decodes three keyboard protocols:
- Legacy VT sequences (arrow keys, function keys)
- CSI u / Kitty protocol (enables Shift+Enter, Ctrl+Space, Super modifier)
- xterm modifyOtherKeys (used by Ghostty/tmux)

The `ParsedKey` type captures: key name, function-key flag, modifier booleans (ctrl/meta/shift/option/super), and paste state.

## Stage 2: Configuration

Default bindings are organized into 18 context blocks (`Global`, `Chat`, `Autocomplete`, etc.). Two bindings compute at runtime: `IMAGE_PASTE_KEY` (Windows uses alt+v) and `MODE_CYCLE_KEY` (checks for VT mode support). User overrides load from `~/.claude/keybindings.json`.

## Stage 3: Key Matching

`match.ts` normalizes Ink's boolean flags to `ParsedKeystroke` format. Notable quirks: alt/meta are indistinguishable in legacy terminals, and Escape always sets meta=true, requiring special handling.

## Stage 4: Chord Resolution

The resolver checks if a keystroke begins a longer chord sequence. If yes, it enters `chord_started` state; otherwise it performs last-wins matching. Five possible outcomes: `match`, `none`, `unbound`, `chord_started`, `chord_cancelled`.

## Stage 5: React Integration

Components use `useKeybinding()` or `useKeybindings()` hooks to register handlers. The `KeybindingContext` maintains active context sets and manages chord state.

## User Customization & Validation

Hot-reload watches keybindings.json via chokidar with 500ms write-stabilization. `validate.ts` catches parse errors, duplicates, reserved keys, invalid contexts, and malformed actions. Protected keys include: `ctrl+c/d/m` (hardcoded), `ctrl+z/\` (terminal signals), and macOS OS-level shortcuts.

## Key Design Patterns

- **Last-wins**: User bindings appended after defaults naturally override
- **Null unbinding**: Setting a value to `null` explicitly disables a key
- **Modifier aliases**: Accepts generous variations (ctrl/control, alt/opt/option, cmd/command/win)
- **Chord prefixes**: A single key waits if longer chords share its prefix

---

# LESSON 3: Fullscreen Mode Architecture (Lesson 42)
**Source:** https://www.markdown.engineering/learn-claude-code/42-fullscreen-mode

## Core Files & Structure

The fullscreen system spans five primary modules:
- `utils/fullscreen.ts` -- detection logic
- `ink/termio/dec.ts` -- DEC escape sequences
- `ink/components/AlternateScreen.tsx` -- React boundary layer
- `components/FullscreenLayout.tsx` -- viewport composition
- `components/OffscreenFreeze.tsx` -- offscreen optimization

## DEC Private Mode Sequences

The system uses standardized terminal control codes defined as constants. Mode 1049 handles alternate screen with cursor preservation, while modes 1000/1002/1003/1006 manage mouse tracking. The critical distinction: "DEC mode 1049 saves the cursor position before switching and restores it on exit. The older mode 47 just switches buffers without cursor save/restore."

Sequences are pre-generated at module level (`ENTER_ALT_SCREEN`, `EXIT_ALT_SCREEN`, `ENABLE_MOUSE_TRACKING`, `DISABLE_MOUSE_TRACKING`) to avoid runtime string formatting during render cycles.

Mouse modes disable in reverse order (1006->1003->1002->1000) for defensive layering -- this ensures clean teardown if process termination interrupts the sequence.

## Fullscreen Detection Logic

Four predicates determine whether fullscreen activates:

1. **Interactive check** -- headless/SDK/`--print` modes disable fullscreen
2. **Environment flags** -- `CLAUDE_CODE_NO_FLICKER` explicit control
3. **tmux -CC probe** -- `spawnSync('tmux', ['display-message', '-p', '#{client_control_mode}'])` runs synchronously to avoid race conditions
4. **User type** -- Anthropic internal (`USER_TYPE=ant`) defaults on; external defaults off

The tmux probe is deliberately synchronous: "an async probe raced against React render and lost" in previous iterations, leaving SSH+tmux users with dead mouse wheels. The ~5ms startup cost prevents an unrecoverable UX failure.

Module-level caching (`tmuxControlModeProbed`) prevents subprocess re-spawning across 15+ render-frame calls per cycle.

## Mouse Control Knobs

Two orthogonal environment variables:

- `CLAUDE_CODE_NO_FLICKER=0` -- disables alt-screen entirely plus mouse tracking
- `CLAUDE_CODE_DISABLE_MOUSE=1` -- preserves alt-screen but kills mouse capture (restores native tmux/kitty text selection)
- `CLAUDE_CODE_DISABLE_MOUSE_CLICKS=1` -- disables only click/drag, keeps wheel scroll

## AlternateScreen Component

Uses `useInsertionEffect` rather than `useLayoutEffect`. The timing matters: "react-reconciler calls resetAfterCommit between the mutation and layout commit phases, and Ink's resetAfterCommit triggers onRender. With useLayoutEffect, that first onRender fires BEFORE this effect -- writing a full frame to the main screen with altScreen=false."

The component:
- Writes escape sequences before first render frame
- Notifies Ink renderer via `setAltScreenActive(true, mouseTracking)`
- Constrains height to terminal rows (no native scrollback in alt-screen)
- Registers signal-exit cleanup handlers

## FullscreenLayout Composition

Dual rendering paths based on fullscreen state:

**Fullscreen ON:** Slot-based layout with ScrollBox (grows), sticky bottom strip (shrinks), absolute modal overlay, all viewport-constrained via AlternateScreen.

**Fullscreen OFF:** Sequential stacking into normal scrollback.

Five named slots: `scrollable` (message list), `bottom` (input/spinner), `overlay` (permission dialogs), `bottomFloat` (speech bubble), `modal` (slash-command dialog).

Modal sizing calculation reserves exactly 2 transcript rows visible above the divider: `rows: terminalRows - MODAL_TRANSCRIPT_PEEK - 1` with `MODAL_TRANSCRIPT_PEEK = 2`.

The "N new messages" pill uses `useSyncExternalStore` subscribing to ScrollBox scroll position -- no parent REPL re-render needed per scroll event.

## OffscreenFreeze Optimization

Solves performance issue where spinner/counter updates force full terminal resets when content scrolled into scrollback. Mechanism: returns cached stale ref while offscreen, exploiting React's object-identity bail-out for zero diff output.

Uses `'use no memo'` directive -- an explicit React Compiler opt-out. Memoization would defeat the freeze since the mechanism relies on returning intentionally stale references, not memoizing component output.

Virtual list exemption prevents breaking click-to-expand, as `useTerminalViewport` visibility can disagree with ScrollBox virtual scroll position.

## Startup to Shutdown Lifecycle

1. `isFullscreenActive()` decision
2. AlternateScreen mounts, `useInsertionEffect` fires
3. Terminal receives: `ENTER_ALT_SCREEN` + clear + `ENABLE_MOUSE_TRACKING`
4. Ink renderer constrained to viewport bounds
5. On unmount: `DISABLE_MOUSE_TRACKING` + `EXIT_ALT_SCREEN` + cursor restore

tmux-specific: when running inside tmux (not -CC mode), mouse wheel requires tmux's `mouse` option enabled. Claude Code does not programmatically set this to avoid leaking state to sibling panes. Instead, `maybeGetTmuxMouseHint()` suggests configuration at startup.

---

# LESSON 4: Theme & Visual Styling System (Lesson 41)
**Source:** https://www.markdown.engineering/learn-claude-code/41-theme-styling

## Core Architecture

Claude Code implements a deliberately layered terminal styling system across four layers:

**Layer 1 - Semantic Color Palette** (`utils/theme.ts`): Six named themes mapping ~70 semantic tokens to raw color values (RGB, hex, or ANSI).

**Layer 2 - Chalk Normalization** (`ink/colorize.ts`): Terminal environment detection at module load time, with chalk level adjustment and color routing.

**Layer 3 - Layout + Style Types** (`ink/styles.ts`): TypeScript types for `Styles` and `TextStyles` defining CSS-like terminal layout API.

**Layer 4 - Theme-Aware Colorizer** (`design-system/color.ts`): Curried helper accepting theme keys or raw colors, resolving at call time.

## Theme Type System

The `Theme` type is a flat record of ~70 named string slots holding raw color values. Key naming conventions:

- `_FOR_SUBAGENTS_ONLY` suffixes act as lint-time guardrails
- `Shimmer` suffix signals lighter animation variants
- `_FOR_SYSTEM_SPINNER` isolates system-specific colors

Six concrete themes exist via the `ThemeName` union:
- `'dark'`
- `'light'`
- `'light-daltonized'`
- `'dark-daltonized'`
- `'light-ansi'`
- `'dark-ansi'`

The `auto` setting resolves at runtime to either dark or light based on system preference.

## Dark vs. Light vs. Daltonized

Daltonized variants systematically replace green-red distinctions with blue-red ones, addressing deuteranopia (green-channel color blindness). For example, the `success` token shifts from `rgb(78,186,101)` (green) in dark mode to `rgb(51,153,255)` (blue) in dark-daltonized mode.

## Terminal Environment Problem Solving

### VS Code Boost
"VS Code terminals don't set `COLORTERM=truecolor`, causing chalk to fall through to 256-color mode where brand orange `rgb(215,119,87)` becomes washed-out salmon via cube quantization." The code manually boosts chalk to level 3 (truecolor) when `TERM_PROGRAM=vscode` and chalk.level equals 2.

### tmux Clamp
tmux drops truecolor backgrounds unless the outer terminal advertises `Tc/RGB` capability. Clamping to level 2 makes chalk emit 256-color sequences that tmux passes through cleanly. The escape hatch is `CLAUDE_CODE_TMUX_TRUECOLOR=1` for users with correctly configured tmux.

Both exports (`CHALK_BOOSTED_FOR_XTERMJS` and `CHALK_CLAMPED_FOR_TMUX`) are exported for debugging purposes.

## colorize() Dispatch Table

The function uses string-prefix dispatch based on color format:
- `'ansi:'` prefix routes to chalk.red/chalk.bgRed
- `'#'` prefix routes to chalk.hex/chalk.bgHex
- `'ansi256'` prefix parses ansi256(N)
- `'rgb'` prefix parses rgb(r,g,b)

## Styles Type System

The `TextStyles` type includes:
- `color?: Color` (raw value, not theme key)
- `backgroundColor?: Color`
- `dim`, `bold`, `italic`, `underline`, `strikethrough`, `inverse` boolean flags

The `Color` type is a discriminated union of `RGBColor | HexColor | Ansi256Color | AnsiColor`. Colors are always raw values; theme resolution occurs at the component layer only.

The `noSelect` property controls text selection exclusion. The `'from-left-edge'` variant extends exclusion from column 0 to the box's right edge specifically to prevent copying diff sigils during selection.

## design-system/color.ts Bridge

The `color()` function accepts either a theme key (`keyof Theme`) or raw color, returning a curried function. This pattern enables components to create colorizers once and reuse them across multiple strings, avoiding repeated theme lookups.

Raw color prefixes bypass theme lookup entirely and colorize directly.

## /theme Command

The `/theme` command renders an interactive `ThemePicker` component inside a `Pane` with `color="permission"`. The `ThemePicker` provides live preview via a `usePreviewTheme()` hook distinct from saved settings. Enter commits; Escape cancels and restores.

## /color Command

The `/color` command is forbidden for swarm teammates -- only the team leader assigns colors. Valid colors: `'red'`, `'blue'`, `'green'`, `'yellow'`, `'purple'`, `'orange'`, `'pink'`, `'cyan'`. Reset aliases (`'default'`, `'reset'`, `'none'`, `'gray'`, `'grey'`) save using the literal string `"default"` (not empty string) to ensure persistence across session restarts via truthiness guards in `sessionStorage.ts`.

## AgentColorManager

Maps agent type strings to one of 8 theme color slots (`_FOR_SUBAGENTS_ONLY`) for visual differentiation. The `satisfies` constraint ensures all entries map to valid `Theme` keys at compile time. General-purpose agents return `undefined` and receive no color.

## Color Resolution Data Flow

1. User selects theme via `/theme`
2. `useTheme` saves `ThemeSetting` to settings.json
3. `ThemeName` resolves at runtime (`auto` -> dark/light)
4. `getTheme(ThemeName)` returns `Theme` object
5. Component calls `color()` from design-system/color.ts
6. Raw colors bypass lookup; theme keys trigger `getTheme()` lookup
7. `colorize()` dispatches based on string prefix
8. chalk.level (3 for truecolor, 2 for 256-color, 0/1 for plain) determines output

Module load time executes boost first, then clamp, with tmux clamp winning in conflicts.

## Why RGB Strings vs. Objects

Storing colors as strings (`"rgb(215,119,87)"`, `"#d77757"`, `"ansi:red"`) provides:
- Trivial JSON serialization for config storage
- Template literal types for compile-time validation without runtime parsing
- Self-describing discriminators via string prefixes requiring no separate type tag
- Direct chalk compatibility

The regex parsing cost in colorize() is negligible compared to terminal I/O overhead.

## Shimmer Animation Pattern

Theme tokens pair base and shimmer variants (e.g., `claude`/`claudeShimmer`). Shimmer variants are slightly lighter (dark mode) or more saturated, creating pulse animations when oscillating. Example: `claude = rgb(215,119,87)` with `claudeShimmer = rgb(235,159,127)` (20 units brighter per channel).

Rainbow color cycling for "ultrathink" keyword follows the same pattern: seven hues x two weights = 14 theme slots enabling intensity alternation during cycling.

## Apple Terminal 256-Color Fallback

Apple Terminal doesn't handle 24-bit SGR sequences well. A separate `Chalk` instance with level 2 (256-color) is created for chart rendering. The escape sequence extraction trick renders a single character and slices everything before it to obtain the opening SGR sequence without a public chalk API.

## Swarm Teammate Color Restriction

Team leaders assign colors to teammates via `AgentColorManager`. If teammates could call `/color`, they could conflict with leader assignments, breaking visual consistency. The `isTeammate()` check in commands/color/color.ts reads from bootstrap/state.ts, set at startup before any user interaction.

---

# LESSON 5: Permissions System (Lesson 06)
**Source:** https://www.markdown.engineering/learn-claude-code/06-permissions

## Core Architecture

The permission system uses a multi-step decision pipeline to determine whether Claude can execute tools. The process evaluates three inputs: the requested tool, its input parameters, and the current permission context. Results are one of three outcomes: **allow** (immediate execution), **deny** (blocked with explanation), or **ask** (user prompt).

## Decision Pipeline Steps

The system follows seven main phases:

1. **Deny rule checks** -- Tool-wide denials trigger immediately
2. **Ask rule evaluation** -- Specific content patterns may require approval
3. **Tool-specific validation** -- Each tool implements custom permission logic via `checkPermissions()`
4. **User interaction requirements** -- Some tools (ExitPlanMode, AskUserQuestion, ReviewArtifact) always need human involvement
5. **Safety-protected paths** -- Writing to `.git/`, `.claude/`, `.vscode/`, or shell configs always prompts
6. **Mode-based transformations** -- Permission context determines how "ask" results are handled
7. **Auto mode classification** -- Optional AI-driven approval routing for ambiguous cases

## Five Permission Modes

- **default**: Standard prompting for unrecognized actions
- **plan**: Read-only phase blocking write operations
- **acceptEdits**: Auto-approves file modifications within working directory
- **bypassPermissions**: Skips prompts except for deny rules, safety checks, and interaction-required tools
- **auto**: Routes decisions through secondary Claude classifier (ANT-only, feature-flagged)
- **dontAsk**: Converts all prompts to automatic denials

## Rule Matching System

Rules follow the format `ToolName` or `ToolName(content)` with three matching types:

- **Exact**: Direct string equality after trimming
- **Prefix (legacy)**: Ends with `:*`, matches command prefixes
- **Wildcard**: Contains unescaped `*`, converted to regex with dotAll flag

The system supports escaping literal asterisks with backslashes for content patterns.

## Rule Sources & Priority

Rules load from six sources with enterprise policy taking precedence:
- Policy settings (enterprise-managed, read-only)
- Project settings (`.claude/settings.json`)
- User settings (`~/.claude/settings.json`)
- Local settings (`.claude/settings.local.json`)
- CLI flags and arguments
- Session-specific rules

When `allowManagedPermissionRulesOnly` is enabled, non-policy sources are ignored entirely.

## Auto Mode Implementation

The classifier employs three fast-path optimizations to reduce API calls:

1. **Safety-check bypass**: Protected paths always prompt regardless of classifier
2. **acceptEdits path**: File edits within CWD skip classifier entirely
3. **Safe allowlist**: Read-only tools (FileRead, Grep, LSP, TodoWrite, etc.) automatically approve

Dangerous patterns like `python`, `npm run`, `bash`, `eval`, `sudo`, and execution multipliers are stripped from allow rules when entering auto mode. The system tracks denial limits (3 consecutive or 20 total) before falling back to human prompting.

## Bypass Limitations

The `bypassPermissions` mode cannot override:
- Deny rules (always checked first)
- Content-specific ask rules (explicit patterns)
- Safety checks on protected system paths
- Tools requiring user interaction

## Shadowed Rule Detection

The system identifies unreachable rules where general rules prevent specific rules from executing. A tool-wide deny makes all specific allow rules for that tool unreachable and triggers warnings.

## Permission Explainer

When prompts appear, a secondary API call generates human-readable context describing what the command does, why Claude needs it, and risk assessment. The explainer operates via `sideQuery()` without consuming session tokens and accepts up to 1,000 characters of recent conversation context for grounding.

---

# LESSON 6: Settings & Configuration (Lesson 16)
**Source:** https://www.markdown.engineering/learn-claude-code/16-settings-config

## Overview

Claude Code operates across diverse contexts requiring a **5-layer priority cascade** that merges independent configuration sources. The system reads settings synchronously during startup with three-tier caching to minimize disk I/O.

## The 5-Layer Cascade

Sources ranked by priority (lowest to highest):

1. **userSettings** (`~/.claude/settings.json`) -- Global developer preferences, writable, shared across projects
2. **projectSettings** (`.claude/settings.json`) -- Version-controlled team settings
3. **localSettings** (`.claude/settings.local.json`) -- Auto-gitignored personal overrides
4. **flagSettings** (`--settings <path>`) -- CLI flag with inline SDK settings, read-only
5. **policySettings** -- IT/MDM enforced, uses first-source-wins internally among four sub-sources

### Policy Sub-Sources (First-Source-Wins)

- "Remote Anthropic API -> /api/claude_code/settings" (Enterprise/Team + Console users)
- "MDM plist/HKLM" (macOS: `/Library/Managed Preferences/com.anthropic.claudecode.plist`; Windows: `HKLM\SOFTWARE\Policies\ClaudeCode`)
- "managed-settings.json + managed-settings.d/" (requires elevated write access)
- "HKCU registry" (Windows only, user-writable)

## SettingsSchema

Zod v4 schema validates every settings source before merging. Invalid files surface `ValidationError[]` without crashing. Key configuration options include:

- `permissions` -- allow/deny/ask arrays, defaultMode
- `hooks` -- PreToolUse, PostToolUse, Notification, SessionStart, Stop
- `env` -- environment variables injected into sessions
- `model` -- override default Claude model
- `availableModels` -- enterprise allowlist
- `allowedMcpServers`/`deniedMcpServers` -- MCP server controls
- `cleanupPeriodDays` -- transcript retention
- `strictPluginOnlyCustomization` -- lock skills/agents to plugin delivery
- `sandbox` -- sandbox configuration
- `worktree` -- symlinkDirectories, sparsePaths

### Backward Compatibility Contract

- **Allowed:** adding new optional fields, new enum values, making validation more permissive
- **Forbidden:** removing fields, removing enum values, making optional fields required, renaming keys

## Merge Semantics

Using `lodash mergeWith` with custom `settingsMergeCustomizer`:

```typescript
if (Array.isArray(objValue) && Array.isArray(srcValue)) {
  return uniq([...objValue, ...srcValue])  // deduplicated concatenation
}
```

- Objects -- deep-merged, higher layer overrides same key
- Arrays -- concatenated and deduplicated
- Scalars -- higher layer wins
- Deletion via `updateSettingsForSource()` -- pass `undefined` as value

## 3-Tier Cache Architecture

| Cache | Keyed by | Holds | Invalidated by |
|-------|----------|-------|----------------|
| `sessionSettingsCache` | singleton | Fully merged `SettingsWithErrors` | `resetSettingsCache()` |
| `perSourceCache` | `SettingSource` | Per-source `SettingsJson` | `resetSettingsCache()` |
| `parseFileCache` | File path string | Parsed `{ settings, errors }` | `resetSettingsCache()` |

**Clone-on-read:** `parseSettingsFile()` always clones before returning from cache.

## Change Detection

### File Watching with Chokidar

Key constants:
- `FILE_STABILITY_THRESHOLD_MS = 1000` -- wait for write stabilization
- `FILE_STABILITY_POLL_INTERVAL_MS = 500`
- `INTERNAL_WRITE_WINDOW_MS = 5000` -- suppress own writes
- `MDM_POLL_INTERVAL_MS = 30 * 60 * 1000` -- 30-minute MDM poll
- `DELETION_GRACE_MS = 1700` -- absorb delete-and-recreate

When Claude Code writes settings, it calls `markInternalWrite(filePath)` before writing, preventing reload loops via `consumeInternalWrite()` detection.

### Delete-and-Recreate Grace Period

"Auto-updaters and some editors delete a file then recreate it atomically. The change detector uses a 1700ms grace period: when a file is deleted, it waits before processing. If an `add` or `change` event arrives within the grace window, deletion is cancelled."

### FanOut Pattern

Single `fanOut()` function prevents N cache clears per change from N subscribers -- "resetSettingsCache() [one clear] -> settingsChanged.emit(source) -> subsequent subscribers hit the repopulated cache"

## Remote Managed Settings

### Eligibility

- Console users (API key) -- always eligible
- OAuth users (Enterprise/Team) -- eligible
- Third-party API provider/custom base URL -- ineligible
- Cowork (`local-agent`) -- ineligible

### Fetch Lifecycle

Reads cached settings synchronously via `getRemoteManagedSettingsSyncFromCache()`, resolving promise immediately, then fetches from `GET /api/claude_code/settings` with `If-None-Match` header asynchronously. Background poll occurs every 60 minutes.

### ETag-Based Caching

Server-side: `json.dumps(settings, sort_keys=True, separators=(",", ":"))`
TypeScript implementation must match server exactly:

```typescript
const sorted = sortKeysDeep(settings)
const normalized = jsonStringify(sorted)
const hash = createHash('sha256').update(normalized).digest('hex')
return `sha256:${hash}`
```

### Fail-Open Design

- Failed fetch with cached file -> use stale cache
- Failed fetch without cache -> proceed without remote settings
- Auth errors (401/403) -> no retry
- Network/timeout -> retry up to 5 times with exponential backoff
- 204/404 -> delete stale cache file

### Security Check

`checkManagedSettingsSecurity()` prompts user approval if incoming settings differ from cache with dangerous content (new hooks, changed permission rules). Rejection preserves previous cached settings.

## Settings Sync (CCR)

Separate mechanism syncing user's own settings between interactive CLI and CCR headless mode.

### Direction & Triggers

- **Upload (CLI -> cloud)** -- interactive CLI startup; syncs user settings.json, CLAUDE.md, local settings.local.json, project CLAUDE.local.md
- **Download (cloud -> CCR)** -- CCR headless startup before plugin install

### Sync Keys

```typescript
USER_SETTINGS: '~/.claude/settings.json'
USER_MEMORY: '~/.claude/CLAUDE.md'
projectSettings: (projectId: string) => `projects/${projectId}/.claude/settings.local.json`
projectMemory: (projectId: string) => `projects/${projectId}/CLAUDE.local.md`
```

Project keys scoped by SHA of git remote URL prevent cross-project overwriting. "Incremental upload: fetch remote copy first, compute diff, send only changed keys." Size limit: 500 KB per file.

## Security Constraints

Settings excluded from `projectSettings` trust domain:

| Setting | Trusted Sources | Reason |
|---------|-----------------|--------|
| `skipDangerousModePermissionPrompt` | user, local, flag, policy | Prevents repo auto-bypass of danger-mode dialog (RCE risk) |
| `skipAutoPermissionPrompt` | user, local, flag, policy | Auto-mode opt-in must be user-driven |
| `useAutoModeDuringPlan` | user, local, flag, policy | Plan-mode semantics are safety-critical |
| `autoMode` classifier config | user, local, flag, policy | Injecting allow/deny rules via repo = RCE vector |

**allowManagedPermissionRulesOnly** -- when true in managed settings, only managed allow/deny/ask rules respected; all user, project, local, CLI rules silently ignored.

**allowManagedHooksOnly** -- only hooks in managed settings execute; prevents user-installed exfiltration or audit-bypass hooks.

## Managed Settings File Paths

| Platform | Base Path | Drop-in Directory |
|----------|-----------|-------------------|
| macOS | `/Library/Application Support/ClaudeCode/managed-settings.json` | `/Library/Application Support/ClaudeCode/managed-settings.d/` |
| Windows | `C:\Program Files\ClaudeCode\managed-settings.json` | `C:\Program Files\ClaudeCode\managed-settings.d\` |
| Linux | `/etc/claude-code/managed-settings.json` | `/etc/claude-code/managed-settings.d/` |

Drop-in files sorted alphabetically; later files override earlier ones following systemd/sudoers convention.

## MDM Startup Parallelism

"Reading macOS plist (`plutil -convert json`) and Windows registry (`reg query`) requires spawning subprocesses. These are fired as early as possible during startup (before module initialization completes) so the subprocess runs in parallel with module loading."

---

# LESSON 7: Session Management (Lesson 29)
**Source:** https://www.markdown.engineering/learn-claude-code/29-session-management

## Core Architecture

Claude Code manages conversations through an **append-only JSONL storage system** organized under `~/.claude/projects/`. Each session has a UUID, transcript file, and metadata entries. The system spans six layers: Storage, State Tracking, Restore/Resume, Recovery, Cloud Sync, and History API.

## Key Data Structures

Messages form a **linked list via `parentUuid`**. The loading process walks from newest leaf backward to root, then reverses to reconstruct chronological order. This design enables branching while maintaining append-only semantics.

## Write Pipeline

All writes flow through a singleton `Project` class that:
- Batches entries into per-file queues
- Drains every 100ms locally (10ms for cloud)
- Deduplicates via `messageSet: Set<UUID>`
- Persists to both local JSONL and remote systems

The session file itself is **lazily materialized** -- created only when the first user or assistant message arrives, preventing metadata-only clutter in resume lists.

## Interrupt Detection

When resuming, the system classifies prior sessions as:
- `none` (completed normally)
- `interrupted_prompt` (user message pending response)
- `interrupted_turn` (tool results without completion)

Interrupted states trigger synthetic "Continue from where you left off." messages for automatic SDK resumption.

## Session State Machine

Three states drive UI and integrations:
- `idle` (waiting for input)
- `running` (model responding)
- `requires_action` (tool approval needed)

Transitions fire callbacks to the CCR bridge, SDK event stream, and metadata listeners.

## Performance Optimization

Resume pickers use **head+tail reads** (4KB head, 64KB tail) to avoid parsing multi-GB files. Metadata entries (title, tag, last-prompt) are re-appended to EOF on exit to remain within the tail window.

## Cloud Persistence

Dual remote paths exist:
- **CCR v2**: Internal events with 10ms flush interval
- **Session Ingress v1**: REST POST with graceful shutdown handling

Reconnection triggers `hydrateFromCCRv2InternalEvents`, overwriting local JSONL with server-authoritative data and reorganizing subagent events by agent ID.

---

# LESSON 8: Context Compaction (Lesson 15)
**Source:** https://www.markdown.engineering/learn-claude-code/15-context-compaction

## Overview

Claude Code implements a four-tier context management system to handle finite context windows across extended coding sessions. The framework prioritizes cost efficiency through a "cost ladder" approach, beginning with zero-API microcompaction and escalating to full LLM summarization only when necessary.

## Core Strategies

**Strategy 1 -- Microcompact:** Instantly clears cached tool-result content from in-memory message arrays without API calls.

**Strategy 2 -- Session Memory Compact:** Replaces aged messages with pre-built session-memory files, eliminating summarization API costs.

**Strategy 3 -- Full LLM Compact:** Forks a sub-agent to generate structured 9-section summaries with one additional API call.

**Strategy 4 -- Reactive Compact:** Triggered by 413 prompt-too-long errors, peeling API rounds from oldest entries until requests fit.

## Threshold Architecture

The system calculates an effective context window by subtracting 20,000 tokens (reserved for compaction output) from the raw context size. This creates five operational states:

- **Normal** (>20k tokens remaining): No action
- **Warning** (<=20k tokens): Yellow UI indicator
- **Error** (<=20k tokens): Red UI indicator
- **Auto-Compact** (<=13k tokens): Triggers automatic compaction
- **Blocking** (<=3k tokens): Prevents new user input

The 20k reservation reflects "p99.99 of compact output as 17,387 tokens" rounded conservatively upward.

## Microcompact Implementation

Eligible tool types for content-clearing include file reads, shell operations, grep, glob, web search/fetch, and file edits. The system offers two execution paths:

**Time-Based Path:** Clears old tool results client-side when server-side prompt cache expires (default 60-minute threshold). Keeps the last 5 tool results by default, replacing cleared content with the sentinel: `'[Old tool result content cleared]'`

**Cached MC Path (Experimental):** Queues server-side cache_edits blocks rather than mutating message content, preserving the prompt cache prefix while removing tool results.

Token estimation uses character-count heuristics padded by 4/3 for conservatism. Images receive flat 2,000-token estimates.

## Session Memory Compaction

This experimental feature avoids summarization API calls by leveraging continuously-updated session memory files. Configuration defaults specify:

- Minimum 10,000 tokens of recent context preserved
- Minimum 5 text-block messages retained
- Hard cap of 40,000 tokens maximum

A critical invariant preserved by `adjustIndexToPreserveAPIInvariants`: tool_use/tool_result pairs must remain paired when slicing messages. The function expands backward boundaries to include orphaned tool_use blocks and thinking-block partners.

## Full LLM Compaction -- Nine-Section Structure

The compact summary prompt mandates this exact nine-section structure:

1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections
4. Errors and Fixes
5. Problem Solving
6. All User Messages (verbatim, captures intent drift)
7. Pending Tasks
8. Current Work
9. Optional Next Step

Section 6 exists specifically because "tool-use history captures what Claude did but not the user's shifting intent." The model drafts reasoning in `<analysis>` XML tags (later stripped) before producing `<summary>` blocks.

A critical preamble prevents tool-call waste: `"CRITICAL: Respond with TEXT ONLY. Do NOT call any tools."`

## Message Grouping by API Round

Safe context-reduction operates at API-round boundaries identified by assistant `message.id` changes. This preserves tool_use/tool_result pairs belonging to identical rounds while enabling safe deletion of older rounds.

## Post-Compact Cleanup

The centralized `runPostCompactCleanup` function invalidates state after any compaction:

- Resets microcompact state (always)
- Clears user context cache (main thread only)
- Resets memory file cache (main thread only)
- Invalidates system prompt sections, classifier approvals, and speculative checks

**Subagent safety:** Main-thread guards prevent subagents (sharing module-level state) from corrupting parent thread memory when clearing caches.

Post-compact file restoration injects up to 5 previously-read files (50k token budget, 5k per file) plus skills (25k budget, 5k per skill) to avoid re-reading in new sessions.

## Context Command Implementation

The `/context` display applies identical pre-API transforms as the query loop: slicing to post-boundary messages, applying context-collapse projections, then microcompacting for accurate token counts. This ensures the displayed count reflects what the API receives, not raw REPL history.

---

# LESSON 9: Analytics & Telemetry (Lesson 32)
**Source:** https://www.markdown.engineering/learn-claude-code/32-analytics-telemetry

## Architecture Overview

Claude Code's telemetry system spans six modular files within `services/analytics/`. The design philosophy separates *what* gets logged from *how* events route, maintaining a "zero dependencies" public API so any module can invoke `logEvent()` without importing Datadog or OpenTelemetry transports at load time.

**Core Components:**

- **index.ts**: Public API exposing `logEvent` and `logEventAsync` with event queueing until sink attachment
- **sink.ts**: Central router applying sampling, feature gates, and PII stripping before fanout
- **datadog.ts**: Batching transport flushing every 15 seconds or at 100 entries
- **metadata.ts**: Enrichment layer attaching platform, model, session, agent ID, process metrics, and repo hash
- **growthbook.ts**: Remote-eval client driving experiments, configs, and kill-switches
- **sinkKillswitch.ts**: Emergency disable mechanism via GrowthBook config `tengu_frond_boric`

## Pre-Sink Event Queue Pattern

Events fired during startup would normally be lost. The solution uses module-level array queueing:

```typescript
const eventQueue: QueuedEvent[] = []
let sink: AnalyticsSink | null = null

export function logEvent(eventName: string, metadata: LogEventMetadata): void {
  if (sink === null) {
    eventQueue.push({ eventName, metadata, async: false })
    return
  }
  sink.logEvent(eventName, metadata)
}

export function attachAnalyticsSink(newSink: AnalyticsSink): void {
  if (sink !== null) return
  sink = newSink

  if (eventQueue.length > 0) {
    const queuedEvents = [...eventQueue]
    eventQueue.length = 0
    queueMicrotask(() => {
      for (const event of queuedEvents) { sink!.logEvent(event.eventName, event.metadata) }
    })
  }
}
```

**Design insight**: "The queue is drained via `queueMicrotask` rather than synchronously. This avoids adding latency to the startup hot path." Both attachment functions are explicitly idempotent, supporting calls from multiple initialization hooks without coordination.

## Sink Routing Logic (sink.ts)

Every event passes three sequential checks before dispatch:

1. **Sampling check**: `shouldSampleEvent()` returns 0 (drop), null (100%), or a probability
2. **Datadog gate**: `shouldTrackDatadog()` and `isSinkKilled('datadog')` determine routing
3. **Field stripping**: `stripProtoFields()` removes PII-tagged `_PROTO_*` keys before Datadog fanout

```typescript
function logEventImpl(eventName: string, metadata: LogEventMetadata): void {
  const sampleResult = shouldSampleEvent(eventName)
  if (sampleResult === 0) return

  const metadataWithSampleRate =
    sampleResult !== null
      ? { ...metadata, sample_rate: sampleResult }
      : metadata

  if (shouldTrackDatadog()) {
    void trackDatadogEvent(eventName, stripProtoFields(metadataWithSampleRate))
  }
  logEventTo1P(eventName, metadataWithSampleRate)
}
```

**PII separation strategy**: Keys prefixed `_PROTO_` route to privileged BigQuery columns via the first-party exporter. The Datadog path strips these defensively so unrecognized `_PROTO_` keys cannot silently reach the general-access backend.

## Datadog Transport Configuration

Datadog receives only an allow-listed set of events. The allowed list includes: `tengu_init`, `tengu_started`, `tengu_api_success`, `tengu_api_error`, `tengu_tool_use_success`, `tengu_tool_use_error`, `tengu_exit`, `tengu_oauth_success`, `tengu_oauth_error`, `tengu_cancel`, `tengu_uncaught_exception`, `tengu_compact_failed`, `chrome_bridge_*`, `tengu_team_mem_*`.

**Batching parameters:**
- Flush interval: 15 seconds (default)
- Batch size trigger: 100 entries
- Network timeout: 5 seconds
- Process exit behavior: `.unref()` prevents blocking shutdown

**Cardinality reduction techniques:**

- Model names: Non-Anthropic users canonicalized to base name; unknown models bucketed as `"other"`
- MCP tool names: `mcp__slack__post_message` becomes `"mcp"` in tags
- Version strings: `2.0.53-dev.20251124.t173302.sha526cc6a` -> `2.0.53-dev.20251124`
- User buckets: IDs hashed to 1 of 30 buckets via SHA-256 for privacy-preserving unique-user approximation

## Metadata Enrichment Structure

Every event receives enrichment via `getEventMetadata()` assembling three layers:

**EnvContext** (built once, memoized):
Platform, architecture, Node version, terminal program, package managers, runtime detection, CI flags, OAuth status, full semver, WSL version, VCS type, GitHub Actions runner metadata, container/remote session IDs.

**ProcessMetrics** (per-event delta):
Uptime, resident set size, V8 heap total/used, CPU percent delta calculated as `(userDeltaus + sysDeltaus) / (wallDeltaMs x 1000) x 100`.

**Agent identification** (swarm-aware):
Agent ID, parent session ID, agent type (`'teammate'` | `'subagent'` | `'standalone'`), team name, repo hash (first 16 chars of SHA-256), subscription type, KAIROS flag.

Attribution checks AsyncLocalStorage first (same-process subagents), then environment variables (separate-process teammates), requiring no manual context propagation.

## PII Sanitization via Type System

String values require explicit casts to marker types preventing silent leaks:

```typescript
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

export function sanitizeToolNameForAnalytics(toolName: string) {
  if (toolName.startsWith('mcp__')) {
    return 'mcp_tool' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }
  return toolName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}
```

**Additional sanitization:**
- Tool input truncation (when `OTEL_LOG_TOOL_DETAILS=1`): strings >512 chars truncated to 128; objects depth-limited to 2, 20 items; total JSON capped at 4 KB
- File extension extraction: bash command file operations tracked by extension only; extensions >10 chars redacted as `"other"`

## GrowthBook Feature Flags & Remote Evaluation

GrowthBook operates in **remote eval mode**: the server evaluates all rules and returns pre-computed values rather than shipping the rule tree to client.

**User attributes for targeting:**
Device/session IDs, platform, organization/account UUIDs, subscription type, email (ant-only), app version semver, GitHub Actions metadata.

**Three-level override priority:**
1. Env var `CLAUDE_INTERNAL_FC_OVERRIDES` (ant-only, evaluation harnesses)
2. Config via `/config Gates` tab stored in `~/.claude.json` (ant-only, runtime)
3. Remote eval from `api.anthropic.com` cached to disk per session

**SDK compatibility workaround**: GrowthBook API returns `{ "value": ... }` but SDK expects `{ "defaultValue": ... }`. Claude Code transforms payloads and maintains independent `remoteEvalFeatureValues` Map bypassing SDK re-evaluation.

**Safety mechanism**: Empty `features` response prevents clearing disk cache, avoiding total flag blackout across processes sharing `~/.claude.json`.

**Exposure deduplication**: Module-level `loggedExposures` Set ensures each experiment fires exposure event once per session, preventing duplicates from hot-path repeated calls.

## Kill-Switch Implementation

```typescript
const SINK_KILLSWITCH_CONFIG_NAME = 'tengu_frond_boric'

export function isSinkKilled(sink: 'datadog' | 'firstParty'): boolean {
  const config = getDynamicConfig_CACHED_MAY_BE_STALE<
    Partial<Record<'datadog' | 'firstParty', boolean>>
  >('tengu_frond_boric', {})
  return config?.[sink] === true
}
```

**Fail-open design**: Missing configs, malformed data, or GrowthBook unavailability return `false` -- sinks remain enabled. Only explicit `{ "datadog": true }` disables.

## Analytics Disablement Conditions

```typescript
export function isAnalyticsDisabled(): boolean {
  return (
    process.env.NODE_ENV === 'test'
    || isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    || isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
    || isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
    || isTelemetryDisabled()
  )
}
```

Test environments and third-party cloud providers (Bedrock, Vertex, Foundry) disable analytics entirely. User privacy settings via `isTelemetryDisabled()` are respected. Notably, feedback surveys bypass this check -- they remain active on third-party clouds since they contain no transcript data.

## Event Sampling Strategy

GrowthBook config key `tengu_event_sampling_config` controls per-event sample rates remotely:

```typescript
export function shouldSampleEvent(eventName: string): number | null {
  const config = getEventSamplingConfig()
  const eventConfig = config[eventName]

  if (!eventConfig) return null

  const sampleRate = eventConfig.sample_rate
  if (sampleRate <= 0)  return 0
  if (sampleRate >= 1)  return null

  return Math.random() < sampleRate
    ? sampleRate
    : 0
}
```

Sampled events include `sample_rate` in metadata enabling inverse-probability weighting for reconstruction.

## File References

**Core**: `services/analytics/index.ts`, `sink.ts`, `config.ts`, `sinkKillswitch.ts`
**Backends**: `datadog.ts`, `metadata.ts`, `growthbook.ts`, `firstPartyEventLogger.ts`

## Key Design Principles

- **Decoupling**: "Zero-dep public API" prevents import cycles across modules.
- **Privacy**: Type-enforced sanitization requires explicit developer sign-off via marker-type casts.
- **Control**: Single GrowthBook endpoint manages sampling, gates, experiments, and emergency disables.
- **Resilience**: Fail-open defaults prevent outages from silencing analytics.
- **Attribution**: Automatic swarm awareness via AsyncLocalStorage and environment variables.
- **Operations**: `shutdownDatadog()` flushes batches before process exit preventing data loss.

---

# LESSON 10: Migration System (Lesson 34)
**Source:** https://www.markdown.engineering/learn-claude-code/34-migrations

## Core Architecture

Claude Code employs a **non-traditional migration system** distinct from database schema migrations. Rather than maintaining a migration table or rollback capability, the system uses idempotent functions that detect their own completion state and exit immediately if work is already done.

## The Runner

All synchronous migrations execute through `runMigrations()` in `main.tsx` during the Commander `preAction` hook. A single version number (`CURRENT_MIGRATION_VERSION = 11`) gates the entire block -- once `getGlobalConfig().migrationVersion` matches this constant, "the entire sync block is skipped; only the async migration runs."

## Five Migration Types

1. **Settings promotions**: Move fields from `~/.claude.json` into `settings.json`
2. **Model alias upgrades**: Remap deprecated model strings in `userSettings`
3. **Config key renames**: Address leaked implementation details
4. **One-shot resets**: Clear flags to resurface UI dialogs
5. **Async file migrations**: Move data to separate files without blocking UI

## Idempotency Patterns

**Pattern A -- Completion Flag**: Uses a boolean/timestamp in GlobalConfig when the "already done" state isn't self-evident. Example: `sonnet1m45MigrationComplete` flag checked at function entry.

**Pattern B -- Self-Idempotent**: Migration condition reflects current data state. "Reading and writing the same source keeps this idempotent without a completion flag."

## Settings Layer Discipline

Migrations deliberately touch only `userSettings` (occasionally `localSettings`). This prevents "silently promoting a per-project preference into the global user default" by avoiding reads from merged settings that combine multiple sources.

## Critical Constraint

"Only touches userSettings. Legacy strings in project/local/policy settings are left alone and are still remapped at runtime by `parseUserSpecifiedModel`."

## Adding New Migrations

Required steps include:
1. Creating the function in `src/migrations/`
2. Choosing an idempotency strategy (completion flag or self-idempotent)
3. Wrapping with try/catch
4. Calling `logEvent()` for analytics
5. **Bumping `CURRENT_MIGRATION_VERSION`** so existing users who passed the version gate will rerun the updated set

---

# CROSS-CUTTING PATTERNS & ARCHITECTURE THEMES

## Recurring Design Patterns Across All 10 Lessons

1. **Discriminated Unions / State Machines**: Vim mode (CommandState), keybindings (chord resolution), session management (state machine), permissions (allow/deny/ask)

2. **Pure Functions with Context Injection**: Vim engine passes all side effects through `OperatorContext`/`TransitionContext`. Analytics uses sink interfaces. Permissions use `checkPermissions()` callbacks.

3. **Module-Level Caching/Memoization**: Theme detection, fullscreen tmux probe, settings 3-tier cache, analytics EnvContext, GrowthBook feature values

4. **Fail-Open / Graceful Degradation**: Settings fail-open on fetch errors. Analytics kill-switch defaults to enabled. Remote managed settings use stale cache on failure.

5. **Last-Wins Override Cascading**: Keybindings (user after defaults), settings (5-layer priority), permissions (6 rule sources)

6. **Idempotent Operations**: Migration system patterns A and B. Settings file watching with internal write detection. Analytics sink attachment.

7. **Append-Only / JSONL Storage**: Session management uses append-only JSONL with linked-list message ordering via parentUuid.

8. **Zero-Dependency Public APIs**: Analytics index.ts has no transport imports. Vim engine has no UI imports. Settings schema validates independently.

9. **Signal-Safe Cleanup**: Fullscreen registers signal-exit handlers. Datadog flushes on shutdown. Session management handles graceful shutdown.

10. **Type-Level Safety**: Analytics PII marker types. Theme color slot constraints via `satisfies`. Vim exhaustive switch checking.
