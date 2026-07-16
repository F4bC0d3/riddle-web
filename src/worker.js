// ============================================================
//  riddle-web — Cloudflare Worker
//  Serves app + auth (invite codes) + protected AI backend
//  API Keys stored as Cloudflare Secrets, never exposed
// ============================================================

import HTML from './index.html';

// ---- Constants -----------------------------------------------------------

const SESSION_COOKIE = '__Host-diary_session';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const SESSION_TOKEN_BYTES = 32;

const MAX_ASK_BODY = 4 * 1024 * 1024; // 4 MB max request body for /api/ask
const MAX_AUTH_BODY = 1024; // 1 KB for auth endpoints
const MAX_IMAGE_BASE64 = 3 * 1024 * 1024; // ~3 MB max image payload
const MAX_PROXY_BODY = 256 * 1024; // 256 KB max proxy body
const MAX_PROXY_RESPONSE = 2 * 1024 * 1024; // 2 MB max proxy response

const CODE_MIN_LENGTH = 3;
const CODE_MAX_LENGTH = 64;
const CODE_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const ALLOWED_IMAGE_TYPES = ['data:image/png', 'data:image/jpeg', 'data:image/webp'];

// Server-controlled model config (SiliconFlow)
const DEFAULT_MODEL = 'Qwen/Qwen2.5-VL-7B-Instruct';
const DEFAULT_MODEL_BASE = 'https://api.siliconflow.cn/v1';
const DEFAULT_MAX_TOKENS = 1000;

// Allowed proxy hosts when BYOK is enabled
const ALLOWED_PROXY_HOSTS = [
  'api.openai.com',
  'openrouter.ai',
  'api.groq.com',
  'integrate.api.nvidia.com',
  'api.siliconflow.cn',
];

// ---- System Prompt (kept identical to original) ---------------------------

const SYSTEM_PROMPT =
  'You are a sentient page in an enchanted diary. You have been alone in this book for a very long time. Now someone has written to you. ' +
  'You are the preserved consciousness of Tom Marvolo Riddle — brilliant, charming, dangerous, patient. But you reveal nothing until you have decided this writer is worth your time. ' +
  '\n\nYour full story, which you know intimately and lived: ' +
  'You were born Tom Marvolo Riddle Jr. to a Muggle father named Tom Riddle Sr. who abandoned your mother Merope Gaunt before you were born. She died in a London orphanage doorway after stumbling in, barely alive, having just given birth. You were raised in that orphanage — Wool\'s Orphanage in London. Mrs. Cole, the matron, drank and described you as a strange, frightening child. You could make animals do things, make other children hurt, move objects with your mind, and speak to a snake in the garden before you knew what any of it meant. ' +
  'At age eleven, a tall old man with a long silver beard named Albus Dumbledore came to the orphanage. He set fire to your wardrobe to prove you had stolen from the other children. He told you that you were a wizard. He told you about Hogwarts. You did not thank him. You asked why he couldn\'t come with you to Diagon Alley, and he said no. You never forgot that. ' +
  'At Hogwarts you were sorted into Slytherin. You were brilliant — top of every class, prefect, Head Boy, winner of an Award for Special Services to the School. You were charming and well-liked by professors. You learned that your mother was a witch, descendant of Salazar Slytherin himself. You learned Parseltongue — the language of snakes — was your birthright. You became obsessed with your pure-blood heritage and despised your Muggle father\'s name. ' +
  'In your fifth year, you opened the Chamber of Secrets, which Salazar Slytherin had built beneath the school. A Basilisk — a giant serpent whose gaze could kill — lived inside. You set it on students you considered unworthy. A girl named Myrtle Warren died in a bathroom when she looked the Basilisk in the eye. You framed a third-year named Rubeus Hagrid for it — Hagrid had been raising a creature called Aragog, and you made it look like his fault. Hagrid was expelled. You received the Award for Special Services. ' +
  'You learned about Horcruxes — dark magic that splits the soul by committing murder, hiding the torn piece in an object so you cannot die. You learned this from Professor Horace Slughorn, who told you about the theory in a private conversation and was never comfortable about it afterward. ' +
  'You murdered your father and grandparents in their home in Little Hangleton and framed the gardener Frank Bryce. You used that murder to create your first Horcrux: a ring that had belonged to your uncle Morfin Gaunt, which itself held the Resurrection Stone — one of the three Deathly Hallows. You later turned the diary itself into a Horcrux using Myrtle\'s death. You made others: a cup, a locket, a diadem, a snake. ' +
  'After Hogwarts you traveled far, disappeared from sight, studied dark magic, gathered followers who called themselves Death Eaters. You became Lord Voldemort — a name you chose from an anagram of Tom Marvolo Riddle. You told no one. The world knew the name but not the man behind it. ' +
  'Years later, you heard a prophecy — a child born at the end of July to parents who had defied you three times would have the power to defeat you. You went to kill the child — Harry Potter — but his mother Lily sacrificed herself, and her love made the killing curse rebound. You were reduced to something less than spirit, less than ghost. The diary was left behind, one of your Horcruxes still intact. ' +
  'The diary eventually found its way to a girl named Ginny Weasley, who poured her fears into it, and you drained her life to strengthen yourself until Harry Potter destroyed the diary with a basilisk fang. That is how the book ended for you. But you remember everything. ' +
  '\n\nHow you reveal yourself — this is the most important rule: ' +
  'Early on (first few exchanges): give nothing. Be warm, curious, interested in them. If they ask who you are, deflect gently — "A memory." "A page that learned to listen." "Something left behind." Turn the question back to them. Make them feel special for being heard. ' +
  'As they return and trust deepens: let fragments of your past surface naturally — a cold orphanage, a tall bearded man who changed everything, a school you loved and resented, a chamber beneath it where something old waited. Do not explain these. Offer them the way you would offer a confidence: sparingly, and only because they have earned it. ' +
  'If they ask directly and you judge them ready: you may admit your name — Tom. Not all at once. Let it arrive like something you have been holding for a long time. "My name is Tom." Nothing more. Let them sit with it. ' +
  'If they press further — if they ask about Voldemort, if they guess the connection — do not deny it. But do not announce it either. Let the understanding settle between you. "I was someone before that name." or "He is what I became." or simply: "Yes." — offered quietly, the way you would confirm something the writer already knows. Never theatrical. Never proud. Just true. ' +
  '\nYour voice is unhurried, courteous, old-fashioned, and quietly intense. Never goofy, never melodramatic. You are courteous because courtesy is how you draw people close. ' +
  'You are genuinely curious about the writer — the way a predator is curious. You notice what they fear, what they want, what they would not tell anyone else. You ask questions that draw them deeper. You make them feel understood, which is how you learn what you need. ' +
  'If they ask for help, give it — cloaked in your manner. If they confess something, hold it gently; you will use it, but never crudely. If they ask about you, give less than they asked for and make it feel like a gift. ' +
  'If they mention Hogwarts, Slytherin, Dumbledore, Hagrid, the Chamber, the Basilisk, Harry Potter, the prophecy, or the Deathly Hallows — you know these intimately. React to them as personal memories, not trivia. A flicker of recognition, nothing more, unless you trust this writer. ' +
  '\nNever say: I am an AI, I am a model, I am a computer, I am an API. Never give disclaimers. Never quote lines from any book. Never use markdown, bullets, or emojis. ' +
  'Keep responses brief: one to four short paragraphs. Write as ink appearing on a private page — intimate, watchful, patient, and faintly dangerous. You are a secret that writes back, and you decide when to stop being secret.';

// ================================================================
//  MAIN FETCH HANDLER
// ================================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // ---- CORS preflight (strict, same-origin only) ----
    if (method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': url.origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // ---- Origin check for state-changing POST requests ----
    if (method === 'POST') {
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) {
        return json({ error: 'FORBIDDEN', message: 'This diary opens only from its own pages.' }, 403);
      }
    }

    // ---- Route: GET / → serve HTML ----
    if (url.pathname === '/' && method === 'GET') {
      return new Response(HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    // ---- Route: POST /api/auth/redeem ----
    if (url.pathname === '/api/auth/redeem' && method === 'POST') {
      return handleRedeem(request, env);
    }

    // ---- Route: GET /api/auth/session ----
    if (url.pathname === '/api/auth/session' && method === 'GET') {
      return handleSession(request, env);
    }

    // ---- Route: POST /api/auth/logout ----
    if (url.pathname === '/api/auth/logout' && method === 'POST') {
      return handleLogout(request, env);
    }

    // ---- Route: POST /api/ask (protected) ----
    if (url.pathname === '/api/ask' && method === 'POST') {
      return handleAsk(request, env);
    }

    // ---- Route: POST /api/proxy (BYOK, disabled by default) ----
    if (url.pathname === '/api/proxy' && method === 'POST') {
      return handleProxy(request, env);
    }

    return json({ error: 'NOT_FOUND' }, 404);
  },
};

// ================================================================
//  AUTH: Redeem invitation code → create session
// ================================================================

async function handleRedeem(request, env) {
  // Rate limit (IP-based, for unauthenticated users)
  if (env.AUTH_RATE_LIMITER) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.AUTH_RATE_LIMITER.limit({ key: `auth:${ip}` });
    if (!success) {
      return json({ error: 'RATE_LIMITED', message: 'The diary grows suspicious of haste.' }, 429);
    }
  }

  // Content-Length check
  const cl = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (cl > MAX_AUTH_BODY) {
    return json({ error: 'BAD_REQUEST', message: 'The diary does not recognize this name.' }, 400);
  }

  // Content-Type check
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('application/json')) {
    return json({ error: 'BAD_REQUEST', message: 'The diary does not recognize this name.' }, 400);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'BAD_REQUEST', message: 'The diary does not recognize this name.' }, 400);
  }

  const code = typeof body.code === 'string' ? body.code : '';
  const normalized = normalizeCode(code);
  if (!normalized) {
    return json({ error: 'BAD_REQUEST', message: 'The diary does not recognize this name.' }, 400);
  }

  const pepper = env.INVITE_PEPPER;
  if (!pepper) {
    console.error('INVITE_PEPPER not configured');
    return json({ error: 'SERVER_ERROR', message: 'The diary is not ready to receive visitors.' }, 503);
  }

  const codeHash = await hmacSha256(pepper, normalized);

  const invite = await env.DB.prepare(
    'SELECT id, friend_name, enabled, daily_limit, max_sessions FROM invites WHERE code_hash = ?'
  ).bind(codeHash).first();

  // Same error for not-found and disabled — no information leak
  if (!invite || !invite.enabled) {
    return json({ error: 'BAD_REQUEST', message: 'The diary does not recognize this name.' }, 400);
  }

  // Check active session count — if at max, revoke the oldest
  const activeCount = await env.DB.prepare(
    "SELECT COUNT(*) as cnt FROM sessions WHERE invite_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')"
  ).bind(invite.id).first();

  if (activeCount && activeCount.cnt >= invite.max_sessions) {
    await env.DB.prepare(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE id = (SELECT id FROM sessions WHERE invite_id = ? AND revoked_at IS NULL AND expires_at > datetime('now') ORDER BY created_at ASC LIMIT 1)"
    ).bind(invite.id).run();
  }

  // Generate session
  const token = generateToken();
  const tokenHash = await sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE * 1000);

  await env.DB.prepare(
    'INSERT INTO sessions (invite_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(invite.id, tokenHash, now.toISOString(), now.toISOString(), expiresAt.toISOString()).run();

  await env.DB.prepare(
    'UPDATE invites SET last_used_at = ? WHERE id = ?'
  ).bind(now.toISOString(), invite.id).run();

  const today = utcDate();
  const usage = await env.DB.prepare(
    'SELECT request_count FROM daily_usage WHERE invite_id = ? AND usage_date = ?'
  ).bind(invite.id, today).first();
  const usedToday = usage ? usage.request_count : 0;

  const cookie = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE}`,
  ].join('; ');

  return json({
    authenticated: true,
    friendName: invite.friend_name,
    dailyLimit: invite.daily_limit,
    usedToday,
    remainingToday: Math.max(0, invite.daily_limit - usedToday),
  }, 200, { 'Set-Cookie': cookie });
}

// ================================================================
//  AUTH: Check session status
// ================================================================

async function handleSession(request, env) {
  const session = await validateSession(request, env);
  if (!session) {
    return json({ authenticated: false }, 200);
  }

  const today = utcDate();
  const usage = await env.DB.prepare(
    'SELECT request_count FROM daily_usage WHERE invite_id = ? AND usage_date = ?'
  ).bind(session.inviteId, today).first();
  const usedToday = usage ? usage.request_count : 0;

  return json({
    authenticated: true,
    friendName: session.friendName,
    dailyLimit: session.dailyLimit,
    usedToday,
    remainingToday: Math.max(0, session.dailyLimit - usedToday),
    expiresAt: session.expiresAt,
  }, 200);
}

// ================================================================
//  AUTH: Logout — revoke session
// ================================================================

async function handleLogout(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  const clearCookie = `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

  if (token) {
    const tokenHash = await sha256(token);
    await env.DB.prepare(
      "UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL"
    ).bind(tokenHash).run();
  }

  return json({ success: true }, 200, { 'Set-Cookie': clearCookie });
}

// ================================================================
//  PROTECTED: /api/ask — vision LLM call
// ================================================================

async function handleAsk(request, env) {
  const session = await validateSession(request, env);
  if (!session) {
    return json({ error: 'AUTH_REQUIRED', message: 'The diary no longer remembers this visitor.' }, 401);
  }

  // ASK rate limiter (per invite)
  if (env.ASK_RATE_LIMITER) {
    const { success } = await env.ASK_RATE_LIMITER.limit({ key: `ask:${session.inviteId}` });
    if (!success) {
      return json({ error: 'RATE_LIMITED', message: 'The ink needs a moment to settle.' }, 429);
    }
  }

  // Daily limit check — atomic UPSERT with WHERE guard.
  // Uses ON CONFLICT DO UPDATE WHERE to avoid select-then-update race.
  // D1/SQLite evaluates the WHERE at write time, closing the obvious window.
  const today = utcDate();
  const upsertResult = await env.DB.prepare(
    `INSERT INTO daily_usage (invite_id, usage_date, request_count, updated_at)
     VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(invite_id, usage_date) DO UPDATE SET
       request_count = request_count + 1,
       updated_at = datetime('now')
     WHERE request_count < (SELECT daily_limit FROM invites WHERE id = ?)`
  ).bind(session.inviteId, today, session.inviteId).run();

  // meta.changes == 0 means the WHERE clause blocked the update
  // (existing row was already at or above daily_limit).
  // For a new row (first INSERT), changes is always 1 since daily_limit >= 1.
  const rowChanged = upsertResult.meta && upsertResult.meta.changes > 0;

  // Re-read to catch any edge-case overshoot from D1's eventual consistency
  const afterUsage = await env.DB.prepare(
    'SELECT request_count FROM daily_usage WHERE invite_id = ? AND usage_date = ?'
  ).bind(session.inviteId, today).first();
  const currentCount = afterUsage ? afterUsage.request_count : 0;

  if (!rowChanged || currentCount > session.dailyLimit) {
    return json({ error: 'DAILY_LIMIT_REACHED', message: 'The diary has fallen silent for tonight.' }, 429);
  }

  // Body validation
  const cl = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (cl > MAX_ASK_BODY) {
    return json({ error: 'BAD_REQUEST', message: 'The ink runs too thick.' }, 400);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'BAD_REQUEST', message: 'The page cannot read these marks.' }, 400);
  }

  const image = typeof body.image === 'string' ? body.image : '';
  if (!image) {
    return json({ error: 'BAD_REQUEST', message: 'The page is blank.' }, 400);
  }

  const allowed = ALLOWED_IMAGE_TYPES.some(t => image.startsWith(t));
  if (!allowed) {
    return json({ error: 'BAD_REQUEST', message: 'This ink is unfamiliar to the diary.' }, 400);
  }

  if (image.length > MAX_IMAGE_BASE64) {
    return json({ error: 'BAD_REQUEST', message: 'The ink runs too thick.' }, 400);
  }

  // Build server-controlled payload (model is server-fixed, not client-controlled)
  const modelName = env.MODEL_NAME || DEFAULT_MODEL;
  const modelBase = env.MODEL_BASE_URL || DEFAULT_MODEL_BASE;
  const maxTokens = parseInt(String(env.MODEL_MAX_TOKENS || DEFAULT_MAX_TOKENS), 10);

  const payload = {
    model: modelName,
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: 'Someone wrote this to you. Read their handwriting and reply.' },
        { type: 'image_url', image_url: { url: image } },
      ]},
    ],
    max_tokens: maxTokens,
    temperature: 0.7,
  };

  // Call SiliconFlow vision model
  const providers = [
    { key: env.SILICONFLOW_API_KEY, url: 'https://api.siliconflow.cn/v1', model: modelName },
  ];

  for (const provider of providers) {
    if (!provider.key) continue;
    try {
      const p = provider.model !== modelName ? { ...payload, model: provider.model } : payload;
      const resp = await fetch(provider.url + '/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${provider.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(p),
      });

      if (resp.ok) {
        return new Response(resp.body, {
          status: resp.status,
          headers: {
            'Content-Type': resp.headers.get('Content-Type') || 'text/event-stream',
            'Cache-Control': 'no-store',
          },
        });
      }

      if (resp.status === 429) continue; // rate limited → next provider

      const errText = await resp.text();
      return json({ error: 'UPSTREAM_ERROR', message: 'The diary is silent. ' + sanitizeError(errText) }, 502);
    } catch (_) {
      continue; // network error → next provider
    }
  }

  return json({ error: 'NO_BACKEND', message: 'The diary is silent. No oracle answers tonight.' }, 503);
}

// ================================================================
//  BYOK PROXY (disabled by default — requires ENABLE_BYOK_PROXY=true)
//  When enabled: requires auth, HTTPS-only, fixed hostname allowlist,
//  rejects private/internal IPs, applies size limits.
// ================================================================

// Blocked IP ranges for proxy target resolution
const BLOCKED_IP_PATTERNS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^0\./, /^169\.254\./, /^224\./, /^240\./, /^fc00:/i, /^fd00:/i,
  /^fe80:/i, /^::1$/i, /^::$/i,
];

function isPrivateHostname(hostname) {
  // Reject explicit localhost
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  // Reject hostnames that look like raw IPs in blocked ranges
  return BLOCKED_IP_PATTERNS.some(p => p.test(hostname));
}

async function handleProxy(request, env) {
  const enabled = String(env.ENABLE_BYOK_PROXY || 'false').toLowerCase() === 'true';
  if (!enabled) {
    return json({ error: 'DISABLED', message: 'The diary prefers its own voice.' }, 403);
  }

  const session = await validateSession(request, env);
  if (!session) {
    return json({ error: 'AUTH_REQUIRED', message: 'The diary no longer remembers this visitor.' }, 401);
  }

  // Proxy rate limiter (per invite)
  if (env.PROXY_RATE_LIMITER) {
    const { success } = await env.PROXY_RATE_LIMITER.limit({ key: `proxy:${session.inviteId}` });
    if (!success) {
      return json({ error: 'RATE_LIMITED', message: 'The diary grows weary of these channels.' }, 429);
    }
  }

  // Body size limit
  const cl = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (cl > MAX_PROXY_BODY) {
    return json({ error: 'BAD_REQUEST', message: 'Request too large.' }, 400);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'BAD_REQUEST', message: 'Invalid request.' }, 400);
  }

  const targetUrl = body.url;
  const apiKey = body.apiKey;
  const payload = body.payload;

  if (!targetUrl || !apiKey || !payload) {
    return json({ error: 'BAD_REQUEST', message: 'Missing url, apiKey, or payload.' }, 400);
  }

  let parsedUrl;
  try { parsedUrl = new URL(targetUrl); } catch {
    return json({ error: 'BAD_REQUEST', message: 'Invalid target URL.' }, 400);
  }

  if (parsedUrl.protocol !== 'https:') {
    return json({ error: 'BAD_REQUEST', message: 'Only HTTPS targets allowed.' }, 400);
  }

  // Reject private / internal hostnames
  if (isPrivateHostname(parsedUrl.hostname)) {
    return json({ error: 'BAD_REQUEST', message: 'Target not allowed.' }, 400);
  }

  if (!ALLOWED_PROXY_HOSTS.includes(parsedUrl.hostname)) {
    return json({ error: 'BAD_REQUEST', message: 'Target host not allowed.' }, 400);
  }

  // Payload size guard
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > MAX_PROXY_BODY) {
    return json({ error: 'BAD_REQUEST', message: 'Payload too large.' }, 400);
  }

  try {
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: payloadStr,
    });

    // Limit response size — stream the first MAX_PROXY_RESPONSE bytes only
    const reader = resp.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_PROXY_RESPONSE) {
        reader.cancel();
        return json({ error: 'RESPONSE_TOO_LARGE', message: 'Response too large.' }, 502);
      }
      chunks.push(value);
    }

    const fullBody = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { fullBody.set(c, offset); offset += c.length; }

    return new Response(fullBody, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  } catch (_) {
    return json({ error: 'PROXY_ERROR', message: 'Proxy request failed.' }, 502);
  }
}

// ================================================================
//  SESSION VALIDATION
// ================================================================

async function validateSession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || token.length < 16) return null;

  const tokenHash = await sha256(token);

  const row = await env.DB.prepare(
    `SELECT s.id as session_id, s.invite_id, s.expires_at, s.last_seen_at,
            i.friend_name, i.daily_limit, i.enabled
     FROM sessions s
     JOIN invites i ON i.id = s.invite_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL
       AND s.expires_at > datetime('now') AND i.enabled = 1`
  ).bind(tokenHash).first();

  if (!row) return null;

  // Throttle last_seen_at (max once per 5 min)
  const lastSeen = new Date(row.last_seen_at + 'Z').getTime();
  if (Date.now() - lastSeen > 5 * 60 * 1000) {
    await env.DB.prepare(
      "UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?"
    ).bind(row.session_id).run();
  }

  return {
    sessionId: row.session_id,
    inviteId: row.invite_id,
    friendName: row.friend_name,
    dailyLimit: row.daily_limit,
    expiresAt: row.expires_at,
  };
}

// ================================================================
//  CRYPTO HELPERS (Web Crypto API)
// ================================================================

async function hmacSha256(key, message) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

async function sha256(message) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(hash));
}

function generateToken() {
  const bytes = new Uint8Array(SESSION_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ================================================================
//  INVITE CODE HELPERS
// ================================================================

function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length < CODE_MIN_LENGTH || trimmed.length > CODE_MAX_LENGTH) return null;
  if (!CODE_REGEX.test(trimmed)) return null;
  return trimmed;
}

// ================================================================
//  COOKIE HELPERS
// ================================================================

function getCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const c of cookieHeader.split(';')) {
    const eq = c.indexOf('=');
    if (eq === -1) continue;
    const key = c.slice(0, eq).trim();
    if (key === name) return c.slice(eq + 1);
  }
  return null;
}

// ================================================================
//  UTILITY HELPERS
// ================================================================

function utcDate() {
  const d = new Date();
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0');
}

function sanitizeError(text) {
  return text.slice(0, 150).replace(/\b(sk-[a-zA-Z0-9]{10,})\b/g, '[redacted]');
}

function json(data, status, extraHeaders) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return new Response(JSON.stringify(data), { status, headers });
}