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
| `HOST_KEY` | Optional. If set, creating a poll (and calling the LLM proxy) requires this key — anti-abuse for a public instance. Leave empty for open dev. |
| `LLM_BASE_URL` | OpenAI-compatible root. The app POSTs to `${LLM_BASE_URL}/chat/completions`. Preconfigured for Docker to `https://kiz1.in.ohmportal.de/llmproxy/v1`. |
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

The LLM endpoint (`https://kiz1.in.ohmportal.de/llmproxy/v1`) is preconfigured in
`docker-compose.yml`; the bearer token is read at runtime from the bind-mounted
`.llmcredentials` file and never baked into the image. `config/` is mounted
read-only, so question sets and prompts can be edited on the host without a rebuild.

## Project layout

```
server.js              Express + Socket.io: relay, LLM proxy, config, static
lib/                   term, tap, config (load/validate), llm (client + fallback)
config/                questionsets/*.yaml, prompts.yaml
public/                index · host · eval · privacy + css/js (no build step)
Makefile · Dockerfile · docker-compose.yml
```
