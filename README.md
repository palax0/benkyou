# Benkyou

Self-hosted personal AI news aggregator with Q&A agent.

> ⚠️ M0 foundation only — not yet useful. See `docs/superpowers/specs/2026-05-27-benkyou-design.md` for the full design and `docs/superpowers/plans/` for implementation phases.

## Quickstart (dev)

Prereqs: Node 22+, pnpm 11, Docker.

```bash
git clone <repo>
cd benkyou
cp .env.example .env
# Edit .env: at minimum, set SESSION_SECRET (any 32+ char string)
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env

pnpm install
docker compose up -d postgres
pnpm migrate
pnpm dev
```

Visit http://localhost:3000.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Start web + worker dev mode in parallel |
| `pnpm -w run test` | Run unit + integration tests across all workspaces |
| `pnpm -w run test:e2e` | Run Playwright E2E (requires running stack) |
| `pnpm -w run lint` / `pnpm -w run typecheck` / `pnpm -w run check:i18n` | Quality gates |
| `pnpm migrate` | Apply DB migrations (loads `.env`) |

## Project layout

- `apps/web` — Next.js 16 (App Router, React 19, Tailwind v4)
- `apps/worker` — Node background worker
- `packages/core` — Shared business library (DB, AI, queue, sources, pipeline, search, agent)
- `docs/superpowers/specs/` — Design docs
- `docs/superpowers/plans/` — Implementation plans (per-milestone)

## Status

M0 ships: workspace scaffold, DB schema, Docker Compose, CI green, `/health` endpoint.
M1 (in progress): minimal end-to-end loop — auth, 1 RSS source, pipeline stubs, UI.
