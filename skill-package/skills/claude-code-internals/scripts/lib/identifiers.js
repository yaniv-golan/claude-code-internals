'use strict';
/**
 * identifiers.js — the published identifier extractor, shared by
 * scripts/prepare-lessons.js (keyword appends + the --check reachability gate)
 * and evals/retrieval (leak masking in gen-questions.js). It lives in the skill
 * package because the package ships without evals/.
 *
 * extractIdentifiers() is the rule set the eval question generator was built
 * with (questions-v1.json leak masking depends on it byte for byte), moved here
 * unchanged from evals/retrieval/lib.js. Do not change its behaviour without
 * cutting a new question-set version.
 *
 * RULES, applied to a lesson's canonical text:
 *   - inline code spans:            `...`   (fenced blocks stripped first)
 *   - CAPS env-var-shaped names:    ALLCAPS_WITH_UNDERSCORES
 *   - numeric GrowthBook gate ids:  7-10 digit runs
 *   - slash commands:               /foo-bar (not URL paths)
 *   - tengu_* identifiers
 *   - mcp__x__y tool names
 * Normalization: lowercase, runs of non-alphanumeric characters collapsed to a
 * single space, trimmed. The five non-span patterns run over the FULL text.
 *
 * keywordCandidates() narrows that output to the strings prepare-lessons.js may
 * append as keyword_map keys — see its own comment.
 */

const CODE_SPAN_RE = /`([^`\n]+)`/g;
const CAPS_ENV_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const GATE_ID_RE = /\b\d{7,10}\b/g;
// Negative lookbehind excludes URL paths (preceded by a word char or another slash).
const SLASH_CMD_RE = /(?<![\w/])\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\b/g;
const TENGU_RE = /\btengu_[a-z0-9_]+\b/gi;
const MCP_TOOL_RE = /\bmcp__[A-Za-z0-9_]+\b/g;

function normalize(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Strip fenced code blocks (```...```), replacing fence lines and their
 * contents with blank lines so line numbers/positions are otherwise stable. */
function stripFencedCode(text) {
  const lines = text.split('\n');
  let inFence = false;
  const out = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push('');
      continue;
    }
    out.push(inFence ? '' : line);
  }
  return out.join('\n');
}

/**
 * True if a raw candidate is "identifier-shaped" rather than a plain English
 * word that happened to sit in backticks (`hooks`, `fork`, `outputs`): it has
 * an underscore, a digit, a camelCase boundary, or normalizes to >= 2 tokens.
 */
function isIdentifierShaped(raw) {
  if (/_/.test(raw)) return true;
  if (/\d/.test(raw)) return true;
  if (/[a-z][A-Z]/.test(raw)) return true; // camelCase boundary
  const norm = normalize(raw);
  const tokenCount = norm ? norm.split(' ').filter(Boolean).length : 0;
  return tokenCount >= 2;
}

/**
 * Extract identifiers from text using the published rules.
 * @returns {Array<{raw, normalized, kind, leakTrigger}>} deduped by (kind, normalized).
 */
function extractIdentifiers(text) {
  const stripped = stripFencedCode(text);
  const out = [];
  const seen = new Set();

  const push = (raw, kind, leakTrigger) => {
    const normalized = normalize(raw);
    if (!normalized) return;
    const key = kind + '\u0000' + normalized;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ raw, normalized, kind, leakTrigger });
  };

  for (const m of stripped.matchAll(CODE_SPAN_RE)) {
    const raw = m[1].trim();
    if (raw.length < 2) continue;
    push(raw, 'code-span', isIdentifierShaped(raw));
  }
  for (const m of text.matchAll(CAPS_ENV_RE)) push(m[0], 'caps-env', true);
  for (const m of text.matchAll(GATE_ID_RE)) push(m[0], 'gate-id', true);
  for (const m of text.matchAll(SLASH_CMD_RE)) push(m[0], 'slash', true);
  for (const m of text.matchAll(TENGU_RE)) push(m[0], 'tengu', true);
  for (const m of text.matchAll(MCP_TOOL_RE)) push(m[0], 'mcp', true);

  return out;
}

/**
 * Identifiers from `identifiers` that leak into `questionText` (eval leak
 * masking). Slash commands: literal substring of the raw question. Others:
 * leakTrigger ones only, as a space-padded normalized phrase containment.
 */
function findLeaks(questionText, identifiers) {
  const normQ = ' ' + normalize(questionText) + ' ';
  const leaks = [];
  for (const ident of identifiers) {
    if (ident.kind === 'slash') {
      if (questionText.includes(ident.raw)) leaks.push(ident);
      continue;
    }
    if (!ident.leakTrigger || !ident.normalized) continue;
    if (normQ.includes(' ' + ident.normalized + ' ')) leaks.push(ident);
  }
  return leaks;
}

// ---------------------------------------------------------------------------
// Keyword candidates (prepare-lessons.js)
// ---------------------------------------------------------------------------
//
// A keyword candidate is a SINGLE identifier token, never a phrase, taken from
// extractIdentifiers() output:
//   - caps-env, gate-id, slash, tengu, mcp: the match itself;
//   - code-span: every compound identifier inside the span (the same
//     [A-Za-z0-9]+([._-]+[A-Za-z0-9]+)+ shape the query tokenizer joins, so
//     `claude plugin install foo-bar` yields `foo-bar`, and
//     `~/.claude/settings.json` yields `settings.json`). A dotted compound that
//     is not a file/host name or a version is a member-access chain
//     (`store.getState`, `r.session_ingress_token`) and contributes its
//     identifier segments instead. Hash-like runs (16+ alphanumerics with a
//     digit: tool-use ids, chunk names) are dropped. Plus the whole span
//     when it is ONE token without separators that is identifier-shaped
//     (camelCase or containing a digit: `isEnabled`, `SendMessage`, `W1e`).
//     Multi-word spans are commands or prose, not identifiers; single plain
//     words (`hooks`) are not identifiers.
// Leading/trailing punctuation that cannot be part of an identifier is trimmed.
//
// OCCURRENCE COUNT (the multi-lesson rule picks the lesson where a candidate
// occurs most). An occurrence is a place where the extraction itself produces
// exactly that raw string, with the same span splitting (spanCandidates(), the
// one function candidate extraction uses too), so `r.session_ingress_token`
// counts as an occurrence of session_ingress_token, and a mention outside the
// extraction contexts (a camelCase name in plain prose) does not count. The
// CAPS / gate / slash / tengu / mcp rules run over the full text, code spans
// over the fence-stripped text; both keep line structure, so occurrences are
// identified by line:column and one place hit by two rules counts once.
// Occurrences in a rejected context do not count: a /slash right after `<` or
// `>` (markup) and an mcp__ match that continues with `-` (truncated).
//
// CONTEXT REJECTIONS (they need the text, so they live here; reported through
// the optional `rejected` sink):
//   - xml-tag: a /slash match that only ever occurs right after `<` or `>`
//     (`</summary>`, `<b>/path`) is markup, not a command;
//   - mcp-truncated: an mcp__ name that never occurs on its own, because every
//     occurrence continues with `-` (the mcp__ rule stops at `-`, so
//     `mcp__scheduled-tasks__x` yields `mcp__scheduled`), or that ends in `_`.
// extractIdentifiers() is deliberately left unchanged (eval leak masking).

const COMPOUND_RE = /[A-Za-z0-9]+(?:[._-]+[A-Za-z0-9]+)+/g;
// A dotted compound is kept whole when it is a file name, a host name or a version.
const FILE_LIKE = /\.(json|jsonl|md|js|ts|tsx|jsx|mjs|cjs|sh|py|yml|yaml|toml|txt|log|lock|crt|pem|sb|plist|html|css|asar|img|zip|db|com|ai|dev|io|org|net|app|exe|dmg|mcpb|dxt|bundle)$/i;
const VERSION_LIKE = /^v?\d+(\.\d+)+/;
// Hashes, session/tool-use ids and bundle chunk names: a 16+ character alphanumeric run with a digit.
const HASH_LIKE = /(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{16,}/;
const MIN_CANDIDATE_LEN = 3;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); }

/** Occurrences of `raw` in `text`, not embedded in a longer identifier. */
function countOccurrences(raw, text) {
  const re = new RegExp(`(?<![A-Za-z0-9_/.-])${escapeRe(raw)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`, 'g');
  let n = 0;
  for (const _ of text.matchAll(re)) n++; // eslint-disable-line no-unused-vars
  return n;
}

/** Why a candidate is rejected in the context of `text`, or null. */
function contextReject(raw, text) {
  if (raw.startsWith('/')) {
    const re = new RegExp(`(?<![\\w/<>])${escapeRe(raw)}\\b`);
    if (!re.test(text)) return 'xml-tag';
  }
  if (raw.startsWith('mcp__') && (/_$/.test(raw) || countOccurrences(raw, text) === 0)) return 'mcp-truncated';
  return null;
}

/** A single token (no separators) that is identifier-shaped: camelCase, or letters with digits. */
function isSingleIdentifier(tok) {
  return /^[A-Za-z0-9]+$/.test(tok) && (/[a-z][A-Z]/.test(tok) || (/\d/.test(tok) && /[A-Za-z]/.test(tok)));
}

/**
 * The candidate tokens inside one (trimmed) code span, with their offsets in it.
 * The single definition of span splitting: keywordCandidates() takes its
 * candidates from it and occurrencePositions() its occurrences.
 * @returns {Array<{raw, at}>} in span order (not deduped, no length filter)
 */
function spanCandidates(span) {
  const out = [];
  const compounds = [...span.matchAll(COMPOUND_RE)];
  for (const m of compounds) {
    const c = m[0];
    if (HASH_LIKE.test(c)) continue;
    if (c.includes('.') && !FILE_LIKE.test(c) && !VERSION_LIKE.test(c)) {
      // A member-access chain (store.getState, r.session_ingress_token) is not an
      // identifier a user searches for; its segments are, when they are identifiers.
      let off = m.index;
      for (const seg of c.split('.')) {
        if (/[_-]/.test(seg)) { for (const s of seg.matchAll(COMPOUND_RE)) out.push({ raw: s[0], at: off + s.index }); }
        else if (isSingleIdentifier(seg)) out.push({ raw: seg, at: off });
        off += seg.length + 1;
      }
      continue;
    }
    out.push({ raw: c, at: m.index });
  }
  if (!compounds.length) {
    const tok = span.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (isSingleIdentifier(tok)) out.push({ raw: tok, at: span.search(/[A-Za-z0-9]/) });
  }
  return out;
}

/** 0-based offset -> "line:col" over `starts` (the offsets at which each line starts). */
function lineStarts(s) {
  const starts = [0];
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}
function place(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
  return `${lo}:${offset - starts[lo]}`;
}

/**
 * Every place in `text` where the extraction produces a raw string (see
 * OCCURRENCE COUNT above): raw -> Set of "line:col".
 */
function occurrencePositions(text) {
  const stripped = stripFencedCode(text);
  const textStarts = lineStarts(text);
  const strippedStarts = lineStarts(stripped);
  const pos = new Map();
  const record = (raw, where) => {
    if (!pos.has(raw)) pos.set(raw, new Set());
    pos.get(raw).add(where);
  };
  for (const m of stripped.matchAll(CODE_SPAN_RE)) {
    const span = m[1].trim();
    if (span.length < 2) continue; // as extractIdentifiers()
    const base = m.index + 1 + (m[1].length - m[1].trimStart().length);
    for (const c of spanCandidates(span)) record(c.raw, place(strippedStarts, base + c.at));
  }
  const rules = [
    [CAPS_ENV_RE, null], [GATE_ID_RE, null],
    [SLASH_CMD_RE, (m) => !/[<>]/.test(text[m.index - 1] || '')],
    [TENGU_RE, null],
    [MCP_TOOL_RE, (m) => text[m.index + m[0].length] !== '-'],
  ];
  for (const [re, accept] of rules) {
    for (const m of text.matchAll(re)) if (!accept || accept(m)) record(m[0], place(textStarts, m.index));
  }
  return pos;
}

/**
 * @param {string} text  lesson canonical text
 * @param {Array} [rejected]  optional sink: {raw, kind, reason} for each context rejection
 * @returns {Array<{raw, kind, normalized, count}>} in first-extraction order, deduped by raw
 */
function keywordCandidates(text, rejected) {
  const out = [];
  const seen = new Set();
  const add = (raw, kind) => {
    if (raw.length < MIN_CANDIDATE_LEN || seen.has(raw)) return;
    seen.add(raw);
    out.push({ raw, kind, normalized: normalize(raw) });
  };
  for (const id of extractIdentifiers(text)) {
    if (id.kind !== 'code-span') { add(id.raw, id.kind); continue; }
    for (const c of spanCandidates(id.raw)) add(c.raw, 'code-span');
  }
  const positions = occurrencePositions(text);
  const kept = [];
  for (const c of out) {
    const why = contextReject(c.raw, text) || (positions.has(c.raw) ? null : 'no-occurrence');
    if (why) { if (rejected) rejected.push({ raw: c.raw, kind: c.kind, reason: why }); continue; }
    c.count = positions.get(c.raw).size;
    kept.push(c);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Key shape (prepare-lessons.js): the key a candidate is stored under, and the
// shapes that are never keys.
// ---------------------------------------------------------------------------

/**
 * The keyword_map key a candidate is stored under. A camelCase/PascalCase
 * token is stored in lowercase separator form (switchSession -> switch-session,
 * getMCPServer -> get-mcp-server). That key is identifier-shaped, so the query
 * token a user typing `switchSession` produces (`switchsession`) hits it through
 * its joined form, and no other token does. Stored raw, a camelCase key is a
 * substring key hit by every word inside it ('send', 'message'), which rule 3c
 * then has to refuse whenever any of those words is already a key.
 */
function keyFormOf(raw) {
  if (!/^[A-Za-z0-9]+$/.test(raw) || !/[a-z][A-Z]/.test(raw)) return raw;
  return raw
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// A separator-delimited segment that is an 8+ character hex blob (a34d41f6, e3b0c442).
const HEX_SEGMENT_RE = /^(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}$/i;
// A joined form that is a 12+ character hex blob.
const HEX_JOINED_RE = /^(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12,}$/;
// Regex character classes and their size descriptors: A-Za-z, 0-9a-f, a-z0-9, 8-hex, 16-char.
const CHAR_CLASS_RE = /^(?:[A-Za-z0-9]-[A-Za-z0-9])+$/;
const SIZE_DESCRIPTOR_RE = /^\d+-(?:hex|char|chars|digit|digits|byte|bytes|bit|bits)$/i;
// Unix permission strings: r-x, rw-r--r--, drwxr-xr-x.
const PERMISSION_RE = /^[-dlcbps]?(?:[-r][-w][-xsStT]){1,3}$/;

/**
 * Why a candidate `raw`, stored as `key`, is never a keyword, or null. The
 * length rules apply to the key's alphanumeric joined form: the token a query
 * produces for it. (HASH_LIKE is not applied to the joined form: joining turns
 * CLAUDE_CODE_ENABLE_OPUS_4_7_FAST_MODE into a 30-character run with a digit.)
 */
function shapeReject(raw, key) {
  const joined = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (joined.length <= 3) return 'short';
  if (/^\d+$/.test(joined) && joined.length < 7) return 'short-digits';
  if (UUID_RE.test(raw) || HEX_JOINED_RE.test(joined)) return 'hash';
  if (raw.split(/[._:/-]+/).some((s) => HEX_SEGMENT_RE.test(s))) return 'hash';
  if (CHAR_CLASS_RE.test(raw) || SIZE_DESCRIPTOR_RE.test(raw)) return 'char-class';
  if (/-/.test(raw) && PERMISSION_RE.test(raw)) return 'permission';
  return null;
}

module.exports = {
  CODE_SPAN_RE, CAPS_ENV_RE, GATE_ID_RE, SLASH_CMD_RE, TENGU_RE, MCP_TOOL_RE, COMPOUND_RE,
  normalize, stripFencedCode, isIdentifierShaped, extractIdentifiers, findLeaks,
  keywordCandidates, spanCandidates, occurrencePositions, countOccurrences, contextReject, keyFormOf, shapeReject,
};
