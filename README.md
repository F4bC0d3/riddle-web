# riddle-web

**Tom Riddle's diary, in the browser.** Write on the screen with your finger or stylus. After a pause, the diary drinks your ink — your words fade — and a reply writes itself back in a flowing hand, then fades away.

> **Live demo:** [https://tomriddle.f4b.workers.dev](https://tomriddle.f4b.workers.dev)

---

## What is this?

An AI-powered handwriting diary web app deployed on Cloudflare Workers. Inspired by Tom Riddle's enchanted diary from *Harry Potter*.

### Core Features

- ✍️ Write on the page with a stylus (or finger), with full pressure sensitivity
- ⏱️ After ~3 seconds of idle, your handwriting is automatically captured
- 🧠 A vision LLM (SiliconFlow / Qwen) reads your handwriting
- 🎭 Tom Riddle's persona and voice replies in English
- 🖋️ Replies appear word-by-word in Dancing Script handwriting font, like ink blooming on paper
- 🔑 Invite-only access: each friend gets a unique invite code, no AI key needed
- 🌙 OLED black mode, works on phones, tablets, and desktops

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single HTML file: Canvas drawing + Pointer Events + SVG animation + CSS transitions |
| Backend | Cloudflare Worker (`src/worker.js`) |
| Database | Cloudflare D1 (SQLite): invites, sessions, daily usage |
| AI | SiliconFlow API (OpenAI-compatible, vision model) |
| Auth | Invite codes + HMAC-SHA-256 + HttpOnly Session Cookies |

Web port of [MaximeRivest/riddle](https://github.com/MaximeRivest/riddle) (originally built for the reMarkable Paper Pro). Runs on any device with a browser. Samsung S-Pen, Apple Pencil, and Wacom styli all get full pressure sensitivity.

---

## For Friends: How to Use

> This section is for the people you've invited. Share this with them.

**1. Open the website** on your phone, tablet, or computer.

**2. Enter your invite code.** The diary will ask "This diary belongs to..." — type the code your friend gave you (e.g., `wangxiaoming-7k3p`) and tap **Open the diary**.

**3. You're in!** The diary remembers you for 30 days — you won't need the code again on the same device.

**4. Write something.** Use your finger or a stylus. Rest your pen for a few seconds — the ink will fade and Tom Riddle will reply in flowing handwriting.

**5. (Optional) Dark mode.** Tap the ⚙ gear in the top-right corner to toggle OLED black mode.

| Gesture | What it does |
|---|---|
| Write, then pause | The diary reads your handwriting and replies |
| Flip pen / right-click | Erase |
| Draw a small **?** | Show the built-in guide |

> 💡 **Tips:** Works best on iPad with Apple Pencil or Android tablets with S-Pen. On phones, use your finger or any capacitive stylus.

---

## How It Works

```
Write on canvas → ~2.8s idle → ink fades → PNG sent to vision LLM → reply streams back word-by-word in Dancing Script → fades away
```

The entire app is a single HTML file. The Worker serves it and provides the API:

| Endpoint | Purpose |
|---|---|
| `POST /api/ask` | Vision LLM call — uses server-side API key (SiliconFlow) |
| `POST /api/auth/redeem` | Redeem invite code → get session cookie |
| `GET /api/auth/session` | Check if logged in |
| `POST /api/auth/logout` | Revoke session |
| `POST /api/proxy` | BYOK proxy (disabled by default) |

### Security

- API keys stored in Cloudflare Secrets, never exposed to the browser
- Invite codes stored as HMAC-SHA-256 digests (with `INVITE_PEPPER`), not plaintext
- Session tokens: browser stores raw token (HttpOnly), D1 stores SHA-256 hash
- Rate limiting: per-IP for auth attempts, per-invite for model calls
- Daily per-user request limits enforced atomically in D1
- CORS restricted to same-origin

---

## Deploy

### Prerequisites

1. Install [Node.js](https://nodejs.org/) (LTS)
2. Sign up for [Cloudflare](https://dash.cloudflare.com/sign-up)
3. Get a [SiliconFlow](https://siliconflow.cn/) API key

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Login to Cloudflare
npx wrangler login

# 3. Create D1 database
npx wrangler d1 create tomriddle-auth
# → Copy the returned database_id

# 4. Edit wrangler.toml — paste your database_id
#    [[d1_databases]]
#    binding = "DB"
#    database_name = "tomriddle-auth"
#    database_id = "your-database-id"

# 5. Apply database migration
npx wrangler d1 migrations apply tomriddle-auth --remote

# 6. Generate INVITE_PEPPER (PowerShell)
$bytes = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Fill($bytes); [Convert]::ToHexString($bytes).ToLower()
# Or (requires OpenSSL): openssl rand -hex 32

# 7. Set secrets
npx wrangler secret put INVITE_PEPPER
npx wrangler secret put SILICONFLOW_API_KEY

# 8. Add a friend (set pepper in terminal first)
# CMD: set INVITE_PEPPER=your-pepper-value
# PowerShell: $env:INVITE_PEPPER = "your-pepper-value"
npm run invite -- add --name "Friend Name" --code "friendname-7k3p" --daily-limit 20 --remote

# 9. Test locally
npm run dev
# → Open http://localhost:8787

# 10. Deploy
npm run deploy
# → Your site is live at https://tomriddle.your-subdomain.workers.dev
```

**Deploy to other platforms:** This is a static HTML file + Worker. You can deploy `src/index.html` to Cloudflare Pages, GitHub Pages, Vercel, Netlify, or any web server. The Worker API endpoints won't be available, so users must bring their own API key (set `ENABLE_BYOK_PROXY=true` in `wrangler.toml`).

---

## Invite Management

All commands require `INVITE_PEPPER` set in the terminal.

```bash
# Add a friend
npm run invite -- add --name "Display Name" --code "invitecode" --daily-limit 20 --remote

# List all friends (codes are not stored in plaintext)
npm run invite -- list --remote

# Disable / enable
npm run invite -- disable --name "Display Name" --remote
npm run invite -- enable --name "Display Name" --remote

# Rotate invite code (revokes all sessions)
npm run invite -- rotate --name "Display Name" --new-code "newcode" --remote

# Force logout all devices
npm run invite -- revoke-sessions --name "Display Name" --remote

# Permanently delete
npm run invite -- delete --name "Display Name" --yes --remote
```

> You must specify `--local` (dev D1) or `--remote` (production D1). No default.

**Invite code tips:** Full pinyin names are guessable. For small groups of friends this is fine, but we recommend adding 4–6 random characters (e.g., `wangxiaoming-7k3p`).

---

## Configuration

Non-sensitive config goes in `wrangler.toml` `[vars]`:

```toml
[vars]
MODEL_NAME = "Qwen/Qwen3.5-35B-A3B"
MODEL_BASE_URL = "https://api.siliconflow.cn/v1"
MODEL_MAX_TOKENS = "1000"
ENABLE_BYOK_PROXY = "false"
```

Sensitive values (`INVITE_PEPPER`, `SILICONFLOW_API_KEY`) must be Cloudflare Secrets — never commit them.

For local development, copy `.dev.vars.example` to `.dev.vars` and fill in the values. This file is gitignored.

---

## Daily Limits

- Reset at **UTC midnight** (08:00 Beijing time)
- Atomic UPSERT + WHERE guard prevents race conditions
- A request is counted as soon as it's accepted (even if the upstream model later fails)

---

## Features

- ✍️ **Full pressure sensitivity** via Pointer Events API (S-Pen, Apple Pencil, Wacom, touch)
- 🌙 **OLED black mode** — pure black background (`#000`) turns off Samsung OLED pixels for battery savings
- 🔑 **Invite-only access** — friends only need an invite code, no personal API key
- 📱 **Works on any device** — phones, tablets, desktops
- 🎭 **Tom Riddle persona** — enigmatic, mysterious, in-character
- 🖋️ **Dancing Script** handwriting font with smooth word-by-word animation
- ⚡ **Streaming** — reply appears word-by-word as it streams from the LLM
- 🔒 **Server-side secrets** — API keys live in Cloudflare Secrets, never in the browser
- 🛡️ **Secure sessions** — HttpOnly cookies, 30-day expiry

## Gestures

| Do this | And |
|---|---|
| Write, then rest your pen | The diary drinks your ink and Tom replies |
| Flip the pen / right-click | Erase |
| Draw a small **?** | Summon the built-in guide |
| Press `Escape` | Clear everything |
| Tap **⚙** | Settings (OLED dark mode) |

## Project Structure

```
riddle-web/
├── src/
│   ├── index.html          # Full app: canvas, drawing, idle detection, ink fade,
│   │                       # PNG export, SSE streaming, SVG reply animation,
│   │                       # login UI, session management, OLED dark mode
│   └── worker.js           # Cloudflare Worker: auth + /api/ask + /api/proxy
├── migrations/
│   └── 0001_auth.sql       # D1 schema: invites, sessions, daily_usage
├── scripts/
│   └── invite-manager.mjs  # CLI invite code management
├── wrangler.toml
├── package.json
├── .dev.vars.example       # Template for local dev secrets
└── .gitignore
```

## Credits

- Original concept: [MaximeRivest/riddle](https://github.com/MaximeRivest/riddle) for reMarkable Paper Pro
- Reply font: [Dancing Script](https://github.com/googlefonts/DancingScript) (SIL OFL 1.1)
- License: MIT