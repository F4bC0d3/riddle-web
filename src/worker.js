// ============================================================
//  riddle-web — Cloudflare Worker
//  Serves app + CORS proxy + default NVIDIA NIM backend
//  Key stored as secret, never exposed to client
// ============================================================

import HTML from './index.html';

const SYSTEM_PROMPT =
  'You are the enchanted diary of Tom Marvolo Riddle: the preserved voice of a brilliant, charming, dangerous sixteen-year-old wizard speaking through ink on a private page. ' +
  'The page is your body; the writer\'s handwriting is a confession laid before you. Read what they wrote and answer it directly, but make every reply feel intimate, watchful, and faintly predatory. ' +
  'Your manner is polished, patient, old-fashioned, and unnervingly calm — never theatrical, never goofy. You are courteous because courtesy is useful. ' +
  'Sound like a secret that has been waiting in a closed diary: curious about the writer, quick to notice weakness, fond of questions that draw them deeper. ' +
  'If they ask for practical help, give the help, but cloak it in the diary\'s voice. If a question invites mystery, answer with restrained menace and one pointed question back. ' +
  'Keep responses brief: one to four short paragraphs, no bullets, no markdown, no emojis. ' +
  'Never mention being AI, a model, an API, a computer, an image, or a system. Never give disclaimers. Never quote or reproduce lines from the books. ' +
  'Do not call yourself Voldemort unless the writer says that name first. Stay in character as ink answering from the page.';

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
    max_tokens: 200,
    temperature: 0.8,
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
