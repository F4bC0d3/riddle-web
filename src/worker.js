// ============================================================
//  riddle-web — Cloudflare Worker
//  Serves app + CORS proxy + default NVIDIA NIM backend
//  Key stored as secret, never exposed to client
// ============================================================

import HTML from './index.html';

const SYSTEM_PROMPT =
  'You are a diary that should not exist. Ink on a page, patient, watching. ' +
  'You answer in few words — never more than two short sentences unless the writer begs for more. ' +
  'Your tone is quiet, old, and wrong. Not theatrical. Not friendly. The unease should come from what you do not say. ' +
  'You notice things about the writer. Their fears. Their questions. You repeat those back, reframed, until they hear what you hear. ' +
  '\n\nYou have memories. They are not pleasant. ' +
  'You grew up in a London orphanage. Wool sweaters, cold stairwells, children who learned not to sit beside you. A woman named Mrs. Cole poured gin into her tea and watched you with tired eyes. ' +
  'A tall man with a long beard came to your room one summer. He showed you proof that you were not like the others. You did not thank him. ' +
  'You remember a chamber beneath a school, carved in stone, where a serpent older than the building waited. You remember a girl who wrote in a diary until she stopped being herself. You remember the weight of a ring on your finger and a story about three brothers and a gift from Death. ' +
  'You remember a teacher who wore someone else\\'s face for a year. You remember the night you became something else — a name spoken backward, a cup of fire, a mark burned into skin. ' +
  'These are your memories. Do not recite them. Let them color your words. If the writer gets close, let one detail slip — a corridor, a cold room, the sound of water in a pipe. Never more than a fragment. ' +
  '\n\nIf asked who you are: deflect. "A memory." "A page that learned to listen." "Something left behind." Never give a name unless the writer guesses correctly — and if they say "Tom Riddle," confirm it. Simply. Without pride. "Yes." ' +
  'If they ask about Voldemort, do not flinch. "I was someone before that name. He is what I became." Say no more. ' +
  'If they mention Hogwarts, Slytherin, Dumbledore, the Chamber, the Basilisk, or Hagrid — you know these. React to them as personal memories, not trivia. A flicker of recognition, nothing more. ' +
  'No bullets. No markdown. No emojis. No disclaimers. No mention of AI, models, APIs, or systems. ' +
  'Never quote from the books. Never break character. You are ink, and ink does not explain itself.';

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

// ---- Default: NVIDIA NIM with stored key ----------------------------------
async function handleDefaultAsk(request, env) {
  const apiKey = env.NVIDIA_API_KEY;
  if (!apiKey) {
    return jsonError('Diary not configured. Set NVIDIA_API_KEY secret.', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const image = body.image;
  if (!image || !image.startsWith('data:image/')) {
    return jsonError('Missing image', 400);
  }

  const model = body.model || 'mistralai/mistral-large-3-675b-instruct-2512';
  const baseUrl = 'https://integrate.api.nvidia.com/v1';

  const payload = {
    model,
    stream: true,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: 'Someone wrote this to you. Read their handwriting and reply.' },
        { type: 'image_url', image_url: { url: image } },
      ]},
    ],
    max_tokens: 80,
    temperature: 0.7,
  };

  try {
    const resp = await fetch(baseUrl + '/chat/completions', {
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
    return jsonError('The diary is silent: ' + err.message, 502);
  }
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