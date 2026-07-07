# riddle-web

**Tom Riddle's diary, in the browser.** Write on the screen with your finger or stylus. After a pause, the diary drinks your ink — your words fade — and a reply writes itself back in a flowing hand, then fades away.

> **Live demo:** [https://tomriddle.f4b.workers.dev](https://tomriddle.f4b.workers.dev)

Web port of [MaximeRivest/riddle](https://github.com/MaximeRivest/riddle) (originally built for the reMarkable Paper Pro). Runs on any device with a browser — phones, tablets, desktops. Samsung S-Pen, Apple Pencil, and Wacom styli all get full pressure sensitivity.

**BYOK (Bring Your Own Key):** Each user enters their own API key in the settings panel. No backend secrets. Deploy once, everyone uses it. Works out of the box with the built-in NVIDIA NIM backend — no key required.

## Deploy

```bash
npm install
npx wrangler deploy
```

That's it. No secrets to set. You'll get `https://tomriddle.<your-subdomain>.workers.dev`.

## Using it

1. Open the URL on any device
2. Tap the ⚙ gear (top-right corner)
3. Enter your API key + base URL + model (optional — works without a key via the built-in NVIDIA backend)
4. Write on the page, rest your pen, and the diary answers

## How it works

```
Write on canvas → 2.8s idle → ink fades → PNG sent to vision LLM → reply streams back word-by-word in Dancing Script → fades away
```

The entire app is a single HTML file (`src/index.html`). The Cloudflare Worker (`src/worker.js`) serves it and provides two API endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/ask` | Default backend — uses NVIDIA NIM with a server-side secret (no user key needed) |
| `POST /api/proxy` | BYOK — forwards to user's own API with CORS headers (for providers like OpenAI that don't send CORS) |

## Compatible providers

| Provider | Base URL | CORS from browser? | Notes |
|---|---|---|---|
| **NVIDIA NIM** | `https://integrate.api.nvidia.com/v1` | ✅ Yes | Default backend — free tier, no key needed for visitors |
| **OpenRouter** | `https://openrouter.ai/api/v1` | ✅ Yes | Use any model with `openai/` prefix |
| **Groq** | `https://api.groq.com/openai/v1` | ✅ Yes | Fast inference, vision models available |
| **OpenAI** | `https://api.openai.com/v1` | ❌ No | Routed through `/api/proxy` automatically |
| **Ollama (local)** | `http://localhost:11434/v1` | ⚠️ Same machine only | `OLLAMA_ORIGINS=*` env var required |
| **Any OpenAI-compatible** | varies | check provider docs | Must support vision input |

### Ollama setup

```bash
# Enable CORS in Ollama
OLLAMA_ORIGINS="*" ollama serve

# Or set it permanently in your environment
export OLLAMA_ORIGINS="*"
```

Then in the diary settings, use `http://localhost:11434/v1` as the base URL and your vision model name (e.g. `llama3.2-vision`).

## Features

- ✍️ **Full pressure sensitivity** via Pointer Events API (S-Pen, Apple Pencil, Wacom, touch)
- 🌙 **OLED black mode** — pure black background (`#000`) turns off Samsung OLED pixels for battery savings
- 🔑 **BYOK** — each user brings their own key, stored in localStorage
- 📱 **Works on any device** — phones, tablets, desktops
- 🎭 **Tom Riddle persona** — enigmatic, mysterious, in-character
- 🖋️ **Dancing Script** handwriting font for replies
- ⚡ **Streaming** — reply appears word-by-word as it streams from the LLM
- 🔒 **No backend secrets** — deploy without setting any API keys

## Gestures

| Do this | And |
|---|---|
| Write, then rest your pen | The diary drinks your ink and Tom replies |
| Flip the pen / right-click | Erase |
| Draw a small **?** | Summon the built-in guide |
| Press `Escape` | Clear everything |
| Tap **⚙** | Settings (API key, model, theme) |

## Deploy to other platforms

This is a single static HTML file. Deploy anywhere:

- **Cloudflare Pages:** `npx wrangler pages deploy src/index.html`
- **GitHub Pages:** Push `src/index.html` to a repo, enable Pages
- **Vercel:** `vercel deploy src/index.html`
- **Netlify:** Drag `src/index.html` to the deploy dropzone
- **Any web server:** Just serve `src/index.html`

## Architecture

```
riddle-web/
├── src/
│   ├── index.html    # Full app: canvas, drawing, idle detect, ink fade,
│   │                 # PNG export, SSE streaming, SVG reply animation,
│   │                 # settings panel, OLED dark mode, BYOK
│   └── worker.js     # Cloudflare Worker: serves index.html + /api/ask + /api/proxy
├── wrangler.toml
└── package.json
```

## Credits

- Original concept: [MaximeRivest/riddle](https://github.com/MaximeRivest/riddle) for reMarkable Paper Pro
- Reply font: [Dancing Script](https://github.com/googlefonts/DancingScript) (SIL OFL 1.1)
- License: MIT