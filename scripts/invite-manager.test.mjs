// ============================================================
//  Tests for parseWranglerJson() + extractD1Rows()
//  Run: node scripts/invite-manager.test.mjs
// ============================================================

// Duplicated for standalone testing (keep in sync with invite-manager.mjs)
function parseWranglerJson(stdout, stderr) {
  const text = String(stdout || '');
  try { return JSON.parse(text.trim()); } catch (_) {}

  const lines = text.split(/\r?\n/);
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '[' || t === '{' || /^[\[{]"/.test(t)) candidates.push(i);
  }

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

  throw new Error('Failed to parse Wrangler output as JSON.');
}

// ---- extractD1Rows ---------------------------------------------------------

function extractD1Rows(parsed) {
  const SUMMARY_KEYS = [
    'Total queries executed', 'Rows read', 'Rows written',
    'Database size (MB)', 'Total duration', 'Query',
  ];

  function isSummaryRow(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const keys = Object.keys(obj);
    if (keys.length === 0) return false;
    return keys.length > 0 && keys.every(k => SUMMARY_KEYS.includes(k));
  }

  if (Array.isArray(parsed)) {
    if (parsed.length > 0 && parsed[0] !== null && typeof parsed[0] === 'object') {
      if ('results' in parsed[0] && Array.isArray(parsed[0].results)) {
        return parsed[0].results.filter(r => !isSummaryRow(r));
      }
      if (isSummaryRow(parsed[0])) return [];
      const firstKeys = Object.keys(parsed[0]);
      if (!firstKeys.includes('results') && !firstKeys.includes('success') && !firstKeys.includes('meta')) {
        return parsed;
      }
    }
    return parsed;
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if ('results' in parsed && Array.isArray(parsed.results)) {
      return parsed.results.filter(r => !isSummaryRow(r));
    }
  }

  return [];
}

// ---- Test runner ----------------------------------------------------------

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name} — ${err.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('=== parseWranglerJson tests ===\n');

// 1-16: JSON parser tests (same as before)
function testParse(name, input, expected, stderr = '') {
  test(name, () => {
    const result = parseWranglerJson(input, stderr);
    if (expected === 'Error') throw new Error('unexpected success'); // shouldn't reach
    assert(deepEqual(result, expected), `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
  });
}
function testParseError(name, input) {
  test(name, () => {
    try { parseWranglerJson(input, ''); throw new Error('should have thrown'); }
    catch (_) { /* expected */ }
  });
}

testParse('pure JSON array', '[{"a":1}]', [{ a: 1 }]);
testParse('pure JSON object', '{"results":[{"x":"y"}]}', { results: [{ x: 'y' }] });
testParse('progress before JSON', '├ Checking if file needs uploading\n[{"id":1}]\n', [{ id: 1 }]);
testParse('JSON with leading whitespace', '\n  \n  [{"k":"v"}]\n', [{ k: 'v' }]);
testParse('JSON with trailing status', '[{"x":1}]\n✓ Done\n', [{ x: 1 }]);
testParse('progress before, status after', '├ Checking\n[{"a":1}]\n└ Done\n', [{ a: 1 }]);
testParse('warning before JSON', '▲ Warning\n[{"warn":"test"}]\n', [{ warn: 'test' }]);
testParse('Chinese data', '[{"friend_name":"王小明"}]\n', [{ friend_name: '王小明' }]);
testParse('empty array', '[]\n', []);
testParse('empty object', '{}', {});
testParse('nested braces in strings', '[{"msg":"hello {world} [test]"}]', [{ msg: 'hello {world} [test]' }]);
testParse('escaped quotes', '[{"msg":"he said \\"hello\\""}]', [{ msg: 'he said "hello"' }]);
testParseError('non-JSON error', 'ERROR: Something went wrong');
testParse('multiple progress lines', '▲ Mapping\n├ Checking\n[{"result":"ok"}]\n└ Done\n', [{ result: 'ok' }]);
testParse('wrangler result wrapper', '{"success":true,"results":[{"id":1}]}', { success: true, results: [{ id: 1 }] });
testParse('unicode box chars', '┌───\n│ Running\n├───\n[{"id":42}]\n└───\n', [{ id: 42 }]);

console.log('\n=== extractD1Rows tests ===\n');

// ---- extractD1Rows tests ----

function testExtract(name, input, expected) {
  test(name, () => {
    const result = extractD1Rows(input);
    assert(deepEqual(result, expected),
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
  });
}

// Wrangler 4.x format: [{results: [...], success, meta}]
testExtract('Wrangler 4.x single result',
  [{ results: [{ id: 1, friend_name: '王小明', enabled: 1, daily_limit: 20 }], success: true, meta: {} }],
  [{ id: 1, friend_name: '王小明', enabled: 1, daily_limit: 20 }]
);

// Wrangler 4.x with multiple rows
testExtract('Wrangler 4.x multiple rows',
  [{ results: [
    { id: 1, friend_name: 'Alice', enabled: 1, daily_limit: 20 },
    { id: 2, friend_name: 'Bob', enabled: 0, daily_limit: 10 },
  ], success: true, meta: { duration: 0.1 } }],
  [
    { id: 1, friend_name: 'Alice', enabled: 1, daily_limit: 20 },
    { id: 2, friend_name: 'Bob', enabled: 0, daily_limit: 10 },
  ]
);

// Plain row array (backward compat)
testExtract('plain row array',
  [{ id: 1, friend_name: 'test', enabled: 1, daily_limit: 20 }],
  [{ id: 1, friend_name: 'test', enabled: 1, daily_limit: 20 }]
);

// Object with results key
testExtract('object with results',
  { results: [{ id: 1, name: 'x' }], success: true },
  [{ id: 1, name: 'x' }]
);

// Empty results
testExtract('Wrangler 4.x empty results',
  [{ results: [], success: true, meta: {} }],
  []
);

// Empty array
testExtract('empty array', [], []);

// One friend (Chinese name)
testExtract('one friend Chinese',
  [{ results: [{ id: 1, friend_name: '测试用户', enabled: 1, daily_limit: 20 }], success: true, meta: {} }],
  [{ id: 1, friend_name: '测试用户', enabled: 1, daily_limit: 20 }]
);

// Disabled friend
testExtract('disabled friend',
  [{ results: [{ id: 2, friend_name: 'disabled-user', enabled: 0, daily_limit: 5 }], success: true, meta: {} }],
  [{ id: 2, friend_name: 'disabled-user', enabled: 0, daily_limit: 5 }]
);

// Row with session count
testExtract('row with session count',
  [{ results: [{ friend_name: 'alice', active_sessions: 2, max_sessions: 3, daily_limit: 20 }], success: true, meta: {} }],
  [{ friend_name: 'alice', active_sessions: 2, max_sessions: 3, daily_limit: 20 }]
);

// Multiple friends
testExtract('multiple friends',
  [{ results: [
    { friend_name: 'Alice', enabled: 1, daily_limit: 20, active_sessions: 1, max_sessions: 3, last_used_at: '2026-07-17' },
    { friend_name: 'Bob', enabled: 1, daily_limit: 10, active_sessions: 0, max_sessions: 3, last_used_at: null },
    { friend_name: 'Charlie', enabled: 0, daily_limit: 5, active_sessions: 0, max_sessions: 1, last_used_at: null },
  ], success: true, meta: {} }],
  [
    { friend_name: 'Alice', enabled: 1, daily_limit: 20, active_sessions: 1, max_sessions: 3, last_used_at: '2026-07-17' },
    { friend_name: 'Bob', enabled: 1, daily_limit: 10, active_sessions: 0, max_sessions: 3, last_used_at: null },
    { friend_name: 'Charlie', enabled: 0, daily_limit: 5, active_sessions: 0, max_sessions: 1, last_used_at: null },
  ]
);

// Wrangler with progress + Chinese + wrapper
testExtract('progress + Wrangler 4.x + Chinese',
  [{ results: [{ friend_name: '王小明', enabled: 1, daily_limit: 20 }], success: true, meta: {} }],
  [{ friend_name: '王小明', enabled: 1, daily_limit: 20 }]
);

// Wrangler summary object (remote D1, no table / empty DB)
testExtract('Wrangler summary (no table)',
  [{ 'Total queries executed': 1, 'Rows read': 0, 'Rows written': 0, 'Database size (MB)': 0.02 }],
  []
);

// Wrangler summary with results wrapper
testExtract('results wrapper with summary rows',
  [{ results: [{ 'Total queries executed': 1, 'Rows read': 0 }], success: true, meta: {} }],
  []
);

// Wrangler summary mixed with real data (should filter out summary)
testExtract('mixed summary and data',
  [{ results: [
    { 'Total queries executed': 1, 'Rows read': 2 },
    { id: 1, friend_name: 'real', enabled: 1, daily_limit: 20 },
  ], success: true, meta: {} }],
  [{ id: 1, friend_name: 'real', enabled: 1, daily_limit: 20 }]
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
