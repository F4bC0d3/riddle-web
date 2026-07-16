// ============================================================
//  riddle-web — Cloudflare Worker
//  Serves app + CORS proxy + default NVIDIA NIM backend
//  Keys stored as secrets, never exposed to client
// ============================================================

import HTML from './index.html';

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

// ---- Abuse guards -----------------------------------------------------------
const ASK_RATE_WINDOW_MS = 5 * 60 * 1000;
const ASK_RATE_MAX = 30;                   // requests per IP per window (per isolate)
const MAX_IMAGE_CHARS = 8 * 1024 * 1024;   // data-URL length cap for the current page
const MAX_HISTORY = 6;                     // remembered exchanges
const MAX_HISTORY_IMAGE_CHARS = 150 * 1024;
const MAX_HISTORY_REPLY_CHARS = 2000;
const MAX_PROXY_PAYLOAD_CHARS = 10 * 1024 * 1024;

// Hosts the BYOK proxy will talk to — prevents use as an open relay.
const PROXY_HOSTS = new Set([
  'integrate.api.nvidia.com',
  'openrouter.ai',
  'api.openai.com',
  'api.groq.com',
  'api.mistral.ai',
  'api.x.ai',
  'api.deepseek.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
]);
const PROXY_LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

// Naive per-isolate rate limiting — not exact across isolates, but a real
// speed bump against drive-by abuse of the default backend.
const rateBuckets = new Map();

function rateLimitOk(ip) {
  const now = Date.now();
  if (rateBuckets.size > 10000) rateBuckets.clear();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.reset) {
    bucket = { count: 0, reset: now + ASK_RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count <= ASK_RATE_MAX;
}

function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const ex of raw.slice(-MAX_HISTORY)) {
    if (!ex || typeof ex !== 'object') continue;
    const image = typeof ex.image === 'string' &&
      ex.image.startsWith('data:image/') &&
      ex.image.length <= MAX_HISTORY_IMAGE_CHARS ? ex.image : null;
    const reply = typeof ex.reply === 'string' && ex.reply.trim()
      ? ex.reply.slice(0, MAX_HISTORY_REPLY_CHARS) : null;
    if (image && reply) out.push({ image, reply });
  }
  return out;
}

function buildMessages(image, history) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const ex of history) {
    messages.push({ role: 'user', content: [
      { type: 'text', text: 'Earlier, the writer wrote this to you.' },
      { type: 'image_url', image_url: { url: ex.image } },
    ]});
    messages.push({ role: 'assistant', content: ex.reply });
  }
  messages.push({ role: 'user', content: [
    { type: 'text', text: history.length
      ? 'The writer returns and writes this to you. Read their handwriting and reply.'
      : 'Someone wrote this to you. Read their handwriting and reply.' },
    { type: 'image_url', image_url: { url: image } },
  ]});
  return messages;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        },
      });
    }

    // Default path: POST /api/ask — uses stored NVIDIA key (no user key needed)
    if (url.pathname === '/api/ask' && request.method === 'POST') {
      return handleDefaultAsk(request, env);
    }

    // BYOK path: POST /api/proxy — user has their own key
    if (url.pathname === '/api/proxy' && request.method === 'POST') {
      return handleProxy(request);
    }

    return new Response(HTML, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  },
};

// ---- Default: fallback chain (NVIDIA → OpenRouter free) -------------------
async function handleDefaultAsk(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!rateLimitOk(ip)) {
    return jsonError('The diary needs a moment to rest. Try again in a few minutes.', 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const image = body.image;
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return jsonError('Missing image', 400);
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return jsonError('Image too large', 413);
  }

  const history = sanitizeHistory(body.history);
  const model = body.model || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';

  const payload = {
    model,
    stream: true,
    messages: buildMessages(image, history),
    max_tokens: 1000,
    temperature: 0.7,
  };

  // Try NVIDIA first, fall back to OpenRouter free
  const apiKeys = [
    { key: env.NVIDIA_API_KEY, url: 'https://integrate.api.nvidia.com/v1', model: 'mistralai/mistral-large-3-675b-instruct-2512' },
    { key: env.OPENROUTER_API_KEY, url: 'https://openrouter.ai/api/v1', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free' },
  ];

  for (const provider of apiKeys) {
    if (!provider.key) continue;
    try {
      const payloadOverride = provider.model !== model ? { ...payload, model: provider.model } : payload;
      const resp = await fetch(provider.url + '/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + provider.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloadOverride),
      });

      if (resp.ok) {
        return new Response(resp.body, {
          status: resp.status,
          headers: {
            'Content-Type': resp.headers.get('Content-Type') || 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      // If rate limited (429), try next provider
      if (resp.status === 429) continue;
      // Other error — return it
      const errText = await resp.text();
      return jsonError('The diary is silent: ' + errText.slice(0, 200), resp.status);
    } catch (err) {
      // Network error — try next provider
      continue;
    }
  }

  return jsonError('The diary is silent. No backend available — bring your own API key (⚙ settings).', 503);
}

// ---- BYOK: proxy to user's own API ----------------------------------------
async function handleProxy(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const targetUrl = body.url;
  const apiKey = body.apiKey;
  const payload = body.payload;

  if (!targetUrl || !apiKey || !payload) {
    return jsonError('Missing url, apiKey, or payload', 400);
  }

  // Only forward to known LLM API hosts (or localhost for Ollama) so the
  // worker cannot be used as a general-purpose open relay.
  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return jsonError('Invalid url', 400);
  }
  const isLocal = PROXY_LOCAL_HOSTS.has(target.hostname);
  if (target.protocol !== 'https:' && !(isLocal && target.protocol === 'http:')) {
    return jsonError('Proxy only allows https targets (http allowed for localhost)', 400);
  }
  if (!isLocal && !PROXY_HOSTS.has(target.hostname)) {
    return jsonError('Proxy target not allowed: ' + target.hostname, 403);
  }
  if (JSON.stringify(payload).length > MAX_PROXY_PAYLOAD_CHARS) {
    return jsonError('Payload too large', 413);
  }

  try {
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return new Response(resp.body, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return jsonError('Proxy failed: ' + err.message, 502);
  }
}

function jsonError(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
