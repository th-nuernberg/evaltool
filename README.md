# evaltool

A browser-only, anonymous **teaching-evaluation** tool based on the
[Teaching Analysis Poll (TAP)](https://www.dghd.de/blog/teaching-analysis-poll-tap/),
in the spirit of [quiqui](https://github.com/albrechtje/quiqui).

Students answer a short Likert + freeform survey (including the three canonical
TAP questions). Responses are collected **live, only in the instructor's
browser** — the server never stores any response content. At the end the
instructor gets Likert charts, an LLM-assisted digest of the freeform answers,
the three TAP questions in separate sections, and four didactic conclusions to
revise into a printable report.

> **Privacy by design:** no accounts, no cookies, no database. Each submission is
> relayed straight to the instructor's open dashboard (`localStorage`) and then
> forgotten by the server. The poll is only active while that dashboard is
> connected.

## Quick start (development)

```bash
make install     # npm install
make dev         # node --watch server.js  → http://localhost:3000
```

Open <http://localhost:3000/host>, enter a lecture name, and start a poll. Share
the student link / QR code; submitted responses appear live in your browser.
Click **Evaluation beenden** to analyse, then revise the four conclusions and
download the report.

Without an LLM configured (see below), all AI summaries gracefully show
`LLM not available at present`; everything else still works.

## Configuration

Copy `.env.example` to `.env`:

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`). |
| `BASE_PATH` | URL prefix for hosting behind a reverse proxy (default `evaltool` → served under `/evaltool`). Set empty (`BASE_PATH=`) to serve from the root. The proxy must forward the prefix, not strip it. |
| `HOST_KEY` | Optional. If set, creating a poll (and calling the LLM proxy) requires this key — anti-abuse for a public instance. Leave empty for open dev. |
| `LLM_BASE_URL` | OpenAI-compatible root. The app POSTs to `${LLM_BASE_URL}/chat/completions`. Defaults (Docker) to the internal LiteLLM gateway `http://litellm:4000/v1`; override via `.env`. |
| `LLM_MODEL` | Model id served by the proxy. Defaults to `mistralai/Mistral-Medium-3.5-128B`; override to use another. |
| `LLM_API_KEY` | Bearer token, inline. Simplest for local dev. |
| `LLM_API_KEY_FILE` | Path to a file containing the token, used instead of `LLM_API_KEY`. The Docker deployment bind-mounts `.llmcredentials` here, so the token is never baked into the image. |
| `LLM_TEMPERATURE`, `LLM_MAX_TOKENS`, `LLM_TIMEOUT_MS` | Optional generation tuning. |

- **Question sets** live in `config/questionsets/*.yaml` (Likert + freeform).
  The three TAP questions are appended automatically. Add a file to offer another
  questionnaire; pick it when creating a poll. See `config/questionsets/default.yaml`.
- **LLM prompts** live in `config/prompts.yaml` — eight configurable, German,
  TAP-grounded system prompts (freeform summary, the three TAP questions, and the
  four conclusions). Edit freely; the defaults are sensible.

## How a session works

1. Instructor `/host` → creates a session (`POST /api/session`); the browser
   stores `{sessionId, hostToken, …, responses:[]}` in `localStorage`.
2. The dashboard connects over Socket.io and shows a QR + link.
3. Students open `/eval/:sessionId`, answer once, and submit. The server
   **validates and relays** each response to the instructor's browser, increments
   a participant **count**, and keeps **no copy** of the answers.
4. **Ending** the poll → Likert charts, freeform/TAP summaries (LLM), four
   conclusion drafts → revise in the *Digest* view → printable HTML report
   (date · participants · four conclusions · note) and CSV export.

If the instructor's dashboard disconnects, the poll auto-pauses so no accepted
response is ever lost to a missing collector.

## Deployment (Docker)

For the hosted instance (e.g. `kiz1.in.ohmportal.de`):

```bash
cp .env.example .env                        # adjust LLM_MODEL / HOST_KEY if needed
cp .llmcredentials.example .llmcredentials  # paste your LLM proxy token
make build                                  # docker compose build
make up                                      # docker compose up -d
```

The LLM endpoint defaults to the internal LiteLLM gateway `http://litellm:4000/v1`
(override `LLM_BASE_URL` in `.env`); the bearer token is read at runtime from the
`.llmcredentials` Docker secret and never baked into the image. `config/` is
mounted read-only, so question sets and prompts can be edited on the host without
a rebuild.

The startup log reports whether the LLM is reachable (`LLM reachable …` or a
diagnostic). Note this probe is a server→LLM check; the in-page summaries are
browser→server→LLM, so also ensure the reverse proxy forwards `/evaltool/api/*`
and allows a generous read timeout (summaries can take 10–30 s).

### Reverse proxy

The app serves everything under `BASE_PATH` (default `/evaltool`), so the final
URL is `https://kiz1.in.ohmportal.de/evaltool`. The proxy must **forward the
prefix unchanged** (don't strip it) and upgrade the Socket.io WebSocket. nginx:

```nginx
location /evaltool/ {
    proxy_pass http://evaltool:3000;   # no trailing slash → prefix passed through
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;   # Socket.io
    proxy_set_header Connection "upgrade";
}
```

To host at a different sub-path, change `BASE_PATH` and the `location` block to
match. To serve from the domain root, set `BASE_PATH=`.

## Project layout

```
server.js              Express + Socket.io: relay, LLM proxy, config, static
lib/                   term, tap, config (load/validate), llm (client + fallback)
config/                questionsets/*.yaml, prompts.yaml
public/                index · host · eval · privacy + css/js (no build step)
Makefile · Dockerfile · docker-compose.yml
```
