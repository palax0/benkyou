# Benkyou

Self-hosted personal AI news aggregator. Point it at your sources (RSS, YouTube, Bilibili, pasted links), and it ingests, extracts, transcribes, embeds, and makes everything searchable — running entirely on infrastructure you control, against any LLM/embedding/Whisper endpoint you bring. Single-user, bilingual (zh/en).

**Technical highlights**: a 6-stage pipeline state machine with strict `state='done'` filtering and per-stage retries; a fully BYO AI layer (any Anthropic/OpenAI/Google/OpenAI-compatible/Ollama endpoint via the Vercel AI SDK); hybrid search (PostgreSQL `ts_rank` + pgvector, merged with RRF); and an anti-bot credential model (machine-generated YouTube PoToken + Bilibili QR login) that unblocks video transcription.

> **Status: pre-release.** This is a solo learning/portfolio build. Core ingestion, extraction, transcription, and search work end-to-end (≈ M2b). The LLM Q&A agent, real topic/depth scoring, dedup clustering, and the daily digest are designed but not yet built (M3+) — see [Design & status](#design--status).

## What works today

- **Sources & ingestion** — RSS/Atom polling, plus pasted URLs (articles, direct media, podcasts).
- **Article extraction** — Readability with a configurable reader-endpoint fallback for Cloudflare/SPA pages.
- **Video & audio transcription** — YouTube/Bilibili captions (cheap path), with Whisper fallback for caption-less videos. Gated by the credential model below.
- **Hybrid search** — lexical (`ts_rank`) + semantic (pgvector) candidates merged via Reciprocal Rank Fusion, with `state='done'` and user filters pre-applied to both legs.
- **Lazy deep summaries** — generated on demand from item detail.
- **Observability** — `/admin/jobs` pipeline panel (stage distribution, queue health, orphan/failed-item retry, token ledger, embedding-dimension drift) and a feed-level failure banner.
- **Source management** — CRUD, per-source fetch status, and on-demand fetch.

> Not yet (M3+): real LLM topic/depth scoring (currently a fixed-midpoint stub), dedup clustering (currently every item is its own cluster), the daily digest, and the Q&A agent. Tracked in [`docs/superpowers/plans/`](docs/superpowers/plans/).

## Quickstart (dev)

Prereqs: Node 22+, pnpm 11, Docker.

```bash
git clone <repo>
cd benkyou
cp .env.example .env
# At minimum, set SESSION_SECRET (any 32+ char string):
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env

pnpm install
docker compose up -d postgres
pnpm migrate
pnpm dev
```

Visit http://localhost:3000. First boot uses `INITIAL_PASSWORD` (from `.env`); then configure your LLM/embedding endpoints, add a source, and trigger a fetch from the UI.

For a full self-hosted stack (web + worker + postgres + PoToken sidecar), use `docker compose up` instead of `pnpm dev`.

## Configuration

All config is env-based; copy `.env.example` and fill it in. Key variables:

| Variable | Required | Notes |
|---|---|---|
| `SESSION_SECRET` | ✅ | 32+ chars (`openssl rand -base64 32`). |
| `DATABASE_URL` | ✅ | `localhost` for host-run tooling; `docker compose up` overrides to `postgres` host for containers. |
| `EMBED_DIM` | ✅ | **Frozen at install time** — baked into the migration SQL, not re-read on migrate. Changing it is a drop-and-re-embed. Default `1536`. |
| `INITIAL_PASSWORD` | first boot | Admin password used only on first boot; clear it afterwards. |
| `DEPLOY_MODE` | — | `docker` (long-running worker loop) or `serverless` (`/api/cron/work` trigger). Default `docker`. |
| `DEFAULT_LLM_*` / `DEFAULT_EMBED_*` | — | Onboarding defaults; blank means the user fills them in the UI. Providers: `anthropic` / `openai` / `openai-compatible` / `google` / `mistral` / `ollama`. |
| `DEFAULT_WHISPER_*` | — | Any OpenAI-Whisper-API-compatible endpoint; needed for the no-caption transcription fallback. |
| `POTOKEN_PROVIDER_URL` | — | YouTube anti-bot sidecar (see below); unset = capability off. |
| `CRON_SECRET` | serverless | Shared secret guarding `/api/cron/work`. |

## Scrape sources & credentials

Some sources (YouTube, Bilibili) are gated by anti-bot, so transcription needs credentials.

### YouTube transcription (PoToken)

A pasted YouTube video flows: **captions first** (cheap — Innertube caption fetch, no download), and only if a video has no usable captions does it fall back to **Whisper** (resolve a fresh audio stream at download time → chunked transcription). Both paths are blocked by YouTube's anti-bot unless the worker holds a **PoToken** — so without it, every YouTube video silently degrades to `transcript_status='unavailable'` (no error, just no transcript).

The PoToken is **machine-generated** (no Google account, no login): the worker asks a self-hosted sidecar to run BotGuard, then caches the token (6h TTL) in the `platform_credentials` table and auto-refreshes on expiry. You configure exactly one thing — `POTOKEN_PROVIDER_URL`:

| Deployment | What to do |
|---|---|
| Full `docker compose up` | **Nothing** — the `potoken-provider` sidecar is wired automatically (`POTOKEN_PROVIDER_URL=http://potoken-provider:4416`). |
| Worker run locally (no compose) | Start the sidecar yourself: `docker run -p 4416:4416 brainicism/bgutil-ytdlp-pot-provider:1.1.0`, then set `POTOKEN_PROVIDER_URL=http://localhost:4416` in `.env`. |
| Don't want YouTube transcription | Leave `POTOKEN_PROVIDER_URL` unset → capability off, graceful degrade. |

The Whisper fallback additionally needs `DEFAULT_WHISPER_BASE_URL` / `DEFAULT_WHISPER_API_KEY` / `DEFAULT_WHISPER_MODEL` set (any OpenAI-Whisper-API-compatible endpoint). With only PoToken configured, caption-less videos stay `unavailable`.

docker-mode only (serverless does not transcribe). Sidecar health (`/ping`) surfaces in the pipeline panel — a dead sidecar shows up as clustered YouTube degradation.

### Bilibili (SESSDATA)

Bilibili subtitles need a `SESSDATA` cookie. Supply it via the in-browser **QR login** on the settings page (scan with the Bilibili app); status (valid/expired/unset) is shown there. SESSDATA expires in months — re-scan when it does.

Design rationale and the full failure/degrade matrix: [`docs/superpowers/specs/2026-06-22-scrape-source-credentials-design.md`](docs/superpowers/specs/2026-06-22-scrape-source-credentials-design.md).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start web + worker dev mode in parallel |
| `pnpm -w run test` | Run unit + integration tests across all workspaces |
| `pnpm -w run test:e2e` | Run Playwright E2E (requires running stack) |
| `pnpm -w run lint` / `pnpm -w run typecheck` / `pnpm -w run check:i18n` | Quality gates |
| `pnpm migrate` | Apply DB migrations (loads `.env`) |

## Project layout

- `apps/web` — Next.js 16 (App Router, React 19, Tailwind v4, next-intl)
- `apps/worker` — Node background worker (pg-boss; two modes via `DEPLOY_MODE`)
- `packages/core` — Shared business library (DB, AI, queue, sources, pipeline, search, agent) — all DB/AI access lives here
- `docs/superpowers/specs/` — Design docs (canonical)
- `docs/superpowers/plans/` — Implementation plans (per-milestone)

## Design & status

The authoritative design is [`docs/superpowers/specs/2026-05-27-benkyou-design.md`](docs/superpowers/specs/2026-05-27-benkyou-design.md), with per-feature specs alongside it in [`docs/superpowers/specs/`](docs/superpowers/specs/). Milestone scope and current progress live in [`docs/superpowers/plans/`](docs/superpowers/plans/) — that's the source of truth for what's built versus planned, so this README doesn't go stale tracking it. Contributor/agent conventions are in [`CLAUDE.md`](CLAUDE.md).
