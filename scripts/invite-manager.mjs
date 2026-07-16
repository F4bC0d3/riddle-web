#!/usr/bin/env node

// ============================================================
//  riddle-web — Invite Manager
//  Manage friend invitation codes for the diary.
//
//  Usage:
//    npm run invite -- add    --name "王小明" --code "wangxiaoming" --remote
//    npm run invite -- list --remote
//    npm run invite -- disable  --name "王小明" --remote
//    npm run invite -- enable   --name "王小明" --remote
//    npm run invite -- rotate   --name "王小明" --new-code "wangxiaoming-7k3p" --remote
//    npm run invite -- revoke-sessions --name "王小明" --remote
//    npm run invite -- delete   --name "王小明" --yes --remote
//
//  Flags:
//    --local    Use local D1 (for development)
//    --remote   Use remote D1 (for production)
// ============================================================

import { createHash, createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';

// ---- Config ---------------------------------------------------------------

const DB_NAME = 'tomriddle-auth';
const PEPPER = process.env.INVITE_PEPPER;

if (!PEPPER) {
  console.error('ERROR: INVITE_PEPPER environment variable is not set.');
  console.error('  set INVITE_PEPPER=your-secret-value  (Windows CMD)');
  console.error('  $env:INVITE_PEPPER="your-secret-value"  (PowerShell)');
  process.exit(1);
}

// ---- Parse arguments ------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];

let local = null;
const flags = [];
const params = [];

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--local') { local = true; continue; }
  if (args[i] === '--remote') { local = false; continue; }
  if (args[i].startsWith('--')) {
    flags.push(args[i]);
    if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      params.push({ flag: args[i], value: args[++i] });
    } else {
      params.push({ flag: args[i], value: 'true' });
    }
  }
}

function getParam(name) {
  const p = params.find(p => p.flag === name);
  return p ? p.value : null;
}

function hasFlag(name) {
  return flags.includes(name) || params.some(p => p.flag === name);
}

// ---- Crypto helpers -------------------------------------------------------

function hashCode(code) {
  const normalized = code.trim().toLowerCase();
  return createHmac('sha256', PEPPER).update(normalized).digest('hex');
}

// ================================================================
//  JSON PARSER — robustly extracts JSON from Wrangler's mixed output
//  Wrangler 4.x emits progress lines (├, └, ✓) before/after JSON.
// ================================================================

function parseWranglerJson(stdout, stderr) {
  const text = String(stdout || '');

  // 1) Try direct parse (clean JSON with no noise)
  try { return JSON.parse(text.trim()); } catch (_) { /* not pure JSON */ }

  // 2) Find the first line that looks like a JSON start
  const lines = text.split(/\r?\n/);
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '[' || t === '{' || /^[\[{]"/.test(t)) candidates.push(i);
  }

  // 3) For each candidate, collect until brackets balance
  for (const start of candidates) {
    let depth = 0, inStr = false, esc = false, jsonStr = '';
    for (let i = start; i < lines.length; i++) {
      for (let j = 0; j < lines[i].length; j++) {
        const ch = lines[i][j];
        jsonStr += ch;
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') depth--;
      }
      if (depth === 0 && jsonStr.length > 2) {
        try { return JSON.parse(jsonStr); } catch (_) { break; }
      }
    }
  }

  // 4) Last resort: character-level scan
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '[' && text[start] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') depth--;
      if (depth === 0 && i > start) {
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch (_) { break; }
      }
    }
  }

  // 5) Give up — safe error
  const safe = text.replace(/\b(sk-[a-zA-Z0-9]{10,})\b/g, '[redacted]').slice(0, 500);
  throw new Error('Failed to parse Wrangler output as JSON.\nstdout: ' + safe + '\nstderr: ' + String(stderr || '').slice(0, 300));
}

// ================================================================
//  WRANGLER EXECUTION HELPERS
// ================================================================

// execSync with --command="..." — the only mode that returns actual query
// results on remote D1 (--file mode returns execution summaries, not rows).
function buildWranglerCmd(json, extras) {
  const target = local ? '--local' : '--remote';
  const j = json ? '--json' : '';
  return ['npx wrangler d1 execute', DB_NAME, target, j, ...extras].filter(Boolean).join(' ');
}

function runWrangler(extraArgs) {
  try {
    return execSync(buildWranglerCmd(false, extraArgs), {
      encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    const msg = String(err.stderr || err.stdout || '').slice(0, 500);
    if (msg.includes('UNIQUE constraint failed')) throw new Error('UNIQUE constraint failed');
    throw new Error(msg || 'wrangler command failed');
  }
}

function runWranglerJson(extraArgs) {
  try {
    const stdout = execSync(buildWranglerCmd(true, extraArgs), {
      encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024,
    });
    return parseWranglerJson(stdout, '');
  } catch (err) {
    const sout = String(err.stdout || '');
    const serr = String(err.stderr || '');
    if (serr.includes('UNIQUE constraint') || sout.includes('UNIQUE constraint'))
      throw new Error('UNIQUE constraint failed');
    if (sout.trim()) {
      try { return parseWranglerJson(sout, serr); } catch (_) {}
    }
    throw new Error(serr.slice(0, 500) || sout.slice(0, 500) || 'wrangler command failed');
  }
}

function buildSQL(sql, params) {
  if (!params || params.length === 0) return sql;
  let idx = 0;
  return sql.replace(/\?/g, () => {
    const v = params[idx++];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  });
}

// Collapse whitespace so newlines don't break shell command parsing
function cleanSQL(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

// Quotes around the SQL value protect commas from shell splitting
function runSQL(sql, params) {
  return runWrangler([`--command="${cleanSQL(buildSQL(sql, params))}"`]);
}

function runSQLJson(sql, params) {
  return runWranglerJson([`--command="${cleanSQL(buildSQL(sql, params))}"`]);
}

// ================================================================
//  D1 RESULT EXTRACTION
//  Wrangler 4.x wraps results as: [{results:[...], success, meta}]
//  This extracts the actual database rows regardless of wrapping.
// ================================================================

/**
 * Extract D1 database rows from parsed Wrangler JSON.
 * Handles all known Wrangler 4.x output shapes:
 *   [{results: [...], success, meta}]   ← Wrangler 4.x with --json
 *   [{col: val, ...}, ...]              ← plain row array
 *   {results: [...]}                     ← single object wrapper
 *   []                                   ← empty
 *   [{summary keys...}]                  ← Wrangler summary (no table / empty db)
 */
function extractD1Rows(parsed) {
  // Wrangler summary keys — if a row has these, it's NOT a D1 data row
  const SUMMARY_KEYS = [
    'Total queries executed', 'Rows read', 'Rows written',
    'Database size (MB)', 'Total duration', 'Query',
  ];

  function isSummaryRow(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj);
    if (keys.length === 0) return false;
    // If ALL keys are summary keys, it's a summary row
    return keys.length > 0 && keys.every(k => SUMMARY_KEYS.includes(k));
  }

  // Array case
  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && parsed[0] !== null && typeof parsed[0] === 'object') {
      // Wrangler 4.x wrapper: [{results: [...], success, meta}]
      if ('results' in parsed[0] && Array.isArray(parsed[0].results)) {
        const rows = parsed[0].results;
        // Filter out summary rows that may appear in results
        return rows.filter(r => !isSummaryRow(r));
      }
      // Summary / meta object (no 'results' key) — empty result
      if (isSummaryRow(parsed[0])) return [];
      // Check if it looks like a plain data row (has user column keys)
      const firstKeys = Object.keys(parsed[0]);
      if (!firstKeys.includes('results') && !firstKeys.includes('success') && !firstKeys.includes('meta')) {
        return parsed;
      }
    }
    return parsed;
  }

  // Single object with results
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if ('results' in parsed && Array.isArray(parsed.results)) {
      return parsed.results.filter(r => !isSummaryRow(r));
    }
  }

  return [];
}

/**
 * Validate that each row has the expected fields.
 * Throws a safe error if a key field is missing (prevents silent undefined).
 */
function validateRows(rows, requiredFields) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const field of requiredFields) {
      if (!(field in row)) {
        throw new Error(
          'Unexpected D1 row shape: missing field "' + sanitize(field) +
          '" in row ' + i + '. Available: ' + Object.keys(row).map(sanitize).join(', ')
        );
      }
    }
  }
  return rows;
}

// ---- Shared field list for invite queries ----------------------------------

const INVITE_FIELDS = ['id', 'friend_name', 'enabled', 'daily_limit'];
const INVITE_LIST_FIELDS = ['friend_name', 'enabled', 'daily_limit', 'max_sessions', 'active_sessions', 'last_used_at'];

// ================================================================
//  SHARED: find friend by name
// ================================================================

async function findFriend(name) {
  const rows = validateRows(extractD1Rows(runSQLJson(
    'SELECT id, friend_name, enabled, daily_limit FROM invites WHERE friend_name = ?', [name]
  )), INVITE_FIELDS);
  return rows.length > 0 ? rows[0] : null;
}

// ================================================================
//  COMMANDS
// ================================================================

async function cmdAdd() {
  const name = getParam('--name');
  const code = getParam('--code');
  const limit = parseInt(getParam('--daily-limit') || '20', 10);

  if (!name || !code) {
    console.error('Usage: npm run invite -- add --name "Display Name" --code "invitecode" [--daily-limit 20]');
    process.exit(1);
  }

  const normalized = code.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(normalized) || normalized.length < 3 || normalized.length > 64) {
    console.error('ERROR: Invalid invite code. Must be 3-64 chars, lowercase a-z, 0-9, hyphens.');
    process.exit(1);
  }

  const codeHash = hashCode(normalized);
  const now = new Date().toISOString();

  try {
    runSQL(
      'INSERT INTO invites (code_hash, friend_name, daily_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [codeHash, name, limit, now, now]
    );
    console.log(`✓ Added friend "${name}" with invite code "${normalized}" (daily limit: ${limit})`);
    console.log('  Share the invite code with your friend. They should enter it exactly as shown.');
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      console.error('ERROR: An invite with this code already exists.');
    } else {
      console.error('ERROR: Failed to add friend. ' + sanitize(err.message));
    }
    process.exit(1);
  }
}

async function cmdList() {
  try {
    const rows = validateRows(extractD1Rows(runSQLJson(
      `SELECT id, friend_name, enabled, daily_limit, max_sessions, created_at, last_used_at,
              (SELECT COUNT(*) FROM sessions WHERE invite_id = invites.id AND revoked_at IS NULL AND expires_at > datetime('now')) as active_sessions
       FROM invites ORDER BY created_at DESC`, []
    )), INVITE_LIST_FIELDS);

    if (rows.length === 0) { console.log('No friends invited yet.'); return; }

    console.log('Friends:');
    console.log('─'.repeat(80));
    for (const r of rows) {
      const st = r.enabled ? '✓ active' : '✗ disabled';
      const lu = r.last_used_at ? String(r.last_used_at).slice(0, 10) : 'never';
      console.log(`  ${r.friend_name}  |  ${st}  |  sessions: ${r.active_sessions}/${r.max_sessions}  |  limit: ${r.daily_limit}/day  |  last used: ${lu}`);
    }
    console.log('─'.repeat(80));
    console.log('Note: Invite codes are NOT stored in plain text and cannot be displayed.');
  } catch (err) {
    console.error('ERROR: ' + sanitize(err.message));
    process.exit(1);
  }
}

async function cmdDisable() {
  const name = getParam('--name');
  if (!name) { console.error('Usage: npm run invite -- disable --name "Display Name"'); process.exit(1); }
  const f = await findFriend(name);
  if (!f) { console.error(`ERROR: Friend "${name}" not found.`); process.exit(1); }
  runSQL('UPDATE invites SET enabled = 0, updated_at = datetime(\'now\') WHERE id = ?', [f.id]);
  console.log(`✓ Disabled "${name}". They can no longer use the diary.`);
}

async function cmdEnable() {
  const name = getParam('--name');
  if (!name) { console.error('Usage: npm run invite -- enable --name "Display Name"'); process.exit(1); }
  const f = await findFriend(name);
  if (!f) { console.error(`ERROR: Friend "${name}" not found.`); process.exit(1); }
  runSQL('UPDATE invites SET enabled = 1, updated_at = datetime(\'now\') WHERE id = ?', [f.id]);
  console.log(`✓ Enabled "${name}". They can use the diary again.`);
}

async function cmdRotate() {
  const name = getParam('--name');
  const newCode = getParam('--new-code');
  if (!name || !newCode) { console.error('Usage: npm run invite -- rotate --name "Display Name" --new-code "newcode"'); process.exit(1); }

  const normalized = newCode.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(normalized) || normalized.length < 3 || normalized.length > 64) {
    console.error('ERROR: Invalid invite code. Must be 3-64 chars, lowercase a-z, 0-9, hyphens.');
    process.exit(1);
  }

  const f = await findFriend(name);
  if (!f) { console.error(`ERROR: Friend "${name}" not found.`); process.exit(1); }

  try {
    runSQL('UPDATE sessions SET revoked_at = datetime(\'now\') WHERE invite_id = ? AND revoked_at IS NULL', [f.id]);
    runSQL('UPDATE invites SET code_hash = ?, updated_at = datetime(\'now\') WHERE id = ?', [hashCode(normalized), f.id]);
    console.log(`✓ Rotated invite code for "${name}" to "${normalized}". All sessions revoked.`);
  } catch (err) {
    console.error('ERROR: ' + sanitize(err.message));
    process.exit(1);
  }
}

async function cmdRevokeSessions() {
  const name = getParam('--name');
  if (!name) { console.error('Usage: npm run invite -- revoke-sessions --name "Display Name"'); process.exit(1); }
  const f = await findFriend(name);
  if (!f) { console.error(`ERROR: Friend "${name}" not found.`); process.exit(1); }
  runSQL('UPDATE sessions SET revoked_at = datetime(\'now\') WHERE invite_id = ? AND revoked_at IS NULL', [f.id]);
  console.log(`✓ Revoked all sessions for "${name}". They will need to re-enter their invite code.`);
}

async function cmdDelete() {
  const name = getParam('--name');
  if (!name) { console.error('Usage: npm run invite -- delete --name "Display Name" --yes'); process.exit(1); }

  if (!hasFlag('--yes')) {
    console.error(`WARNING: This will permanently delete "${name}" and all their data.`);
    console.error('Add --yes to confirm.');
    process.exit(1);
  }

  const f = await findFriend(name);
  if (!f) {
    console.log(`✓ Friend "${name}" was not found — nothing to delete.`);
    return;
  }

  // Delete in FK order: daily_usage → sessions → invites
  runSQL('DELETE FROM daily_usage WHERE invite_id = ?', [f.id]);
  runSQL('DELETE FROM sessions WHERE invite_id = ?', [f.id]);
  runSQL('DELETE FROM invites WHERE id = ?', [f.id]);
  console.log(`✓ Deleted "${name}" and all associated data (sessions, usage records).`);
}

// ---- Helpers --------------------------------------------------------------

function sanitize(msg) {
  return String(msg).replace(/\b(sk-[a-zA-Z0-9]{10,})\b/g, '[redacted]').slice(0, 500);
}

// ---- Main -----------------------------------------------------------------

const cmds = {
  add: cmdAdd, list: cmdList, disable: cmdDisable, enable: cmdEnable,
  rotate: cmdRotate, 'revoke-sessions': cmdRevokeSessions, delete: cmdDelete,
};

if (!command || !cmds[command]) {
  console.error('Usage: npm run invite -- <command> [--local|--remote] [options]');
  console.error('Commands: add, list, disable, enable, rotate, revoke-sessions, delete');
  console.error('You must specify either --local (dev D1) or --remote (production D1).');
  process.exit(1);
}

if (local === null) {
  console.error('ERROR: You must specify either --local or --remote.');
  console.error('  --local   Use local D1 database (for development with wrangler dev)');
  console.error('  --remote  Use remote D1 database (for production)');
  process.exit(1);
}

const target = local ? 'local' : 'remote';
console.log(`Using ${target} D1 database: ${DB_NAME}`);
await cmds[command]();
