# AGENTS.md

Instructions for AI coding agents (Codex, Claude, Cursor, Aider, etc.) working on this repository.

## Project

**Benkyou** — self-hosted personal AI news aggregator with Q&A agent. Open-source, single-user-per-deployment. Bilingual (zh/en). 5-month solo build by a frontend developer learning full-stack.

**Authoritative design**: [`docs/superpowers/specs/2026-05-27-benkyou-design.md`](docs/superpowers/specs/2026-05-27-benkyou-design.md).
**Implementation plans (per milestone)**: [`docs/superpowers/plans/`](docs/superpowers/plans/).

Before making any non-trivial change, **read the relevant section of the spec**. The spec is the source of truth. If the spec is wrong, flag it and propose a spec change — do not silently diverge.

---

## Tech Stack

Versions are pinned in the per-milestone implementation plan (currently `docs/superpowers/plans/2026-05-27-benkyou-m0-foundation.md`). Use **latest stable** of each as the default; the plan's pins are an audited snapshot of "what works together on the day the plan was written".

- **Workspace**: pnpm monorepo, Node 22+ LTS, TypeScript 5.7+ strict (incl. `noUncheckedIndexedAccess`)
- **Web**: Next.js 16 (App Router), React 19, Tailwind v4, next-intl 4
- **Worker**: Node process, pg-boss 12 for jobs
- **DB**: PostgreSQL 16 + pgvector extension, Drizzle ORM 0.45+
- **AI**: Vercel AI SDK 6 (`ai` + provider packages) — abstracts Anthropic / OpenAI / Google / OpenAI-compatible / Ollama
- **Whisper**: OpenAI Whisper-API-compatible endpoint (BYO; Deepgram recommended for diarization)
- **Auth**: Session-based (NOT JWT) — argon2id password, sessions table in PG
- **Validation**: Zod 4 (note: `error.issues` not `error.errors`, behavior change from v3)
- **Test**: Vitest 4 + Playwright 1.60+ + Testcontainers 12 + MSW
- **Deploy**: Primary = Docker Compose (web + worker + postgres). Alt = Vercel + Supabase + external cron (`DEPLOY_MODE=serverless`).

If you encounter a breaking change because a dependency has moved past the plan's pinned version, **don't silently downgrade**. Either fix the call site for the new API or flag it to the user.

---

## Workspace Layout

```
apps/
  web/      Next.js app (UI + API routes). Imports @benkyou/core.
  worker/   Background process. Imports @benkyou/core. Two modes via DEPLOY_MODE env.
packages/
  core/     Shared business logic. ALL DB access, AI calls, pipeline stages, search, agent tools live here.
docs/
  superpowers/specs/    Design docs (canonical).
  superpowers/plans/    Per-milestone implementation plans.
```

**Where to put new code**:
- Pure business logic (a new pipeline stage, a new search ranking strategy) → `packages/core/src/{pipeline,search,...}`
- New REST/Server Action endpoint → `apps/web/app/api/...` (thin layer that calls into `@benkyou/core`)
- New background job handler → register in `apps/worker/src/loop.ts` + handler in `packages/core/src/pipeline/`
- New React component → `apps/web/components/` (or co-located in route folder if single-use)

**Where NOT to put code**:
- ❌ Business logic in API routes (call into `@benkyou/core` instead)
- ❌ Direct DB access from `apps/web` or `apps/worker` (use `@benkyou/core/db`)
- ❌ Provider-specific LLM calls anywhere outside `packages/core/src/ai/`

---

## Hard Invariants

These are load-bearing decisions. **Do not change without discussing with the user.**

### Pipeline state machine

Items flow through 6 stages: `pending → extracted → embedded → scored → dedup_done → done`. On failure, **state does NOT change** during retries — only `attempts++` and `last_error` are written. Only after pg-boss exhausts `user_settings.pipeline_max_attempts` retries does the `onFail` callback set `state='failed'`. **All user-visible queries filter `state='done'`.**

If you add a new pipeline stage, you must update:
1. `items.state` enum values in the spec
2. Drizzle schema if any new columns needed
3. Pipeline handler in `packages/core/src/pipeline/`
4. Worker dispatcher (long-running loop + serverless batch handler — both)

### Embedding dimension is frozen at install time

`pgvector` requires `vector(N)` with a literal N. `EMBED_DIM` env var is read at migration generation time and baked into the SQL. `user_settings.embed_dim` is `NOT NULL` and **must not be writable from the UI**. To change dimension, the user runs `scripts/migrate-embeddings.ts --new-dim=N` which drops + recreates `item_embeddings` and triggers full re-embedding.

### Provider abstraction goes through Vercel AI SDK

Never hard-code Anthropic / OpenAI / Google API calls. Always go through `packages/core/src/ai/provider.ts` (`resolveLLM` / `resolveEmbedding`). Whisper has its own thin client because it's not in Vercel AI SDK.

### Search filters are pre-applied

Hybrid search applies `state='done'` + user filters as `WHERE` clauses in **both** candidate queries (BM25/`ts_rank` and pgvector) before RRF merge. Never filter only after RRF — sparse-filter scenarios will return empty.

### Single-user, no multi-tenancy

No `user_id` foreign keys anywhere. `user_settings` is a single-row table (id=1). Session-based auth — one password. If multi-user comes back as a requirement, it's a deliberate spec change, not an emergent feature.

### Worker has two modes, same code

`DEPLOY_MODE=docker` → long-running loop polls pg-boss.
`DEPLOY_MODE=serverless` → worker entry exits immediately; `/api/cron/work` endpoint is the trigger, calls `processBatch(maxJobs)`.
Both modes call the same per-stage handlers in `packages/core/src/pipeline/`.

---

## Coding Conventions

- **TypeScript strict**: no `any` without explicit `// @ts-expect-error` + comment explaining why
- **No default exports** for modules (named exports only); pages/layout components are exempt (Next.js requirement)
- **Drizzle**: never write raw SQL when a builder pattern works; raw SQL only for `tsvector`, hnsw, custom types
- **Error handling at boundaries**: validate at API request entry (zod schema) and external API responses; trust internal calls
- **No comments restating what the code does**; only comment WHY for non-obvious decisions (hidden constraints, surprising invariants, workarounds with bug links)
- **Tests live next to code or in `test/`**: `*.test.ts` for unit/integration; `e2e/*.spec.ts` for Playwright
- **TDD where there's logic**: pipeline stages, search ranking, dedup thresholds, auth — write failing test first. Setup tasks (configs, migrations) don't need TDD.
- **Commits**: per task in the implementation plan; conventional commit prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `ci:`)
- **i18n**: every user-visible string goes through `useTranslations()` / `getTranslations()`. CI fails on missing zh/en keys.

---

## Explicit Non-Goals

Do not implement these even if they seem helpful:

- Multi-user accounts (single-user only)
- Personalized recommendations based on behavior (postponed to a later phase)
- Browser extension (postponed)
- Native mobile app (responsive web only)
- Notes / highlights / annotations (not rebuilding Readwise)
- Social features (sharing, comments, follows)
- Offline mode
- Self-trained models (all AI is BYO endpoint)

---

## Working with the User

- User is a frontend developer learning full-stack — connect new backend/DB concepts to BFF/frontend analogues they know
- User is sharp at design review — surface tradeoffs and edge cases explicitly, don't hand-wave
- Communicates in Chinese; technical English fine in code/comments
- Wants substantive pushback when a design seems wrong, not validation
- Prefers concrete recommendations + tradeoff over open-ended exploration

---

## Code Authorship Boundary (IMPORTANT)

This project is a portfolio piece. The user must be able to explain and defend every load-bearing design decision in interviews. Therefore there is a **clear split between code the user hand-writes and code agents may freely generate**. Agents must respect this split — do not silently write the user-owned modules.

### Agents may write freely

Scaffolding and glue: monorepo configs, tsconfig, eslint, Dockerfiles, docker-compose, CI workflows, Next.js route shells, React UI components & layouts, Tailwind styling, i18n keys, Drizzle schema definitions (mechanical translation from spec), migration files, test setup/scaffolding, E2E test bodies, REST/Server Action thin wrappers, error message strings, README/docs.

### User hand-writes — agents must NOT generate without explicit request

These modules are the **learning-critical core**. If an agent finds itself about to implement one of these without an explicit "write this for me" instruction, **stop and ask**:

1. **Auth core**: argon2 verify, session token creation, CSRF token check, login rate-limit. (`packages/core/src/auth/`)
2. **Pipeline state machine internals**: the `attempts++` → `onFail` → `state='failed'` transition; the per-stage handler dispatcher loop. (`packages/core/src/pipeline/state.ts` and the worker loop)
3. **First implementation of each new pipeline stage**: when adding a stage type (ingest, extract, embed, score, dedup, summary, transcribe), the user writes the first complete version; subsequent variants/refactors are fair game for agents.
4. **Video transcription chunking & merging**: chunked Whisper calls with overlap, boundary alignment, speaker-label parsing. (`packages/core/src/pipeline/transcribe.ts`)
5. **Search hybrid query**: the lexical + vector candidate SQL, RRF merge formula, quality rerank. (`packages/core/src/search/hybrid.ts`)
6. **Dedup clustering**: similarity threshold logic, canonical re-election. (`packages/core/src/pipeline/dedup.ts`)
7. **Agent tool-use loop**: the `streamText({ tools, maxSteps })` driver, SSE event mapping, conversation persistence. (`packages/core/src/agent/loop.ts`)
8. **Agent tool definitions**: schema + execute for each of the 4 MVP tools. (`packages/core/src/agent/tools/*.ts`)
9. **All LLM prompts**: score rubric, summary, deep summary, digest intro, tool routing system prompts. (`packages/core/src/prompts/`)
10. **Daily digest selection algorithm**: `effective_weight` computation, per-category top-N, intro generation orchestration. (`packages/core/src/pipeline/digest.ts`)
11. **Provider factory**: `resolveLLM` / `resolveEmbedding` — the user writes the initial version to internalize the abstraction (`packages/core/src/ai/provider.ts`).

### Workflow when user is hand-writing a user-owned module

The user prefers this loop with AI assistance:

1. **Sketch pass**: user asks AI for a "throwaway first draft" to see how AI would approach it. Read, do not commit.
2. **User-written pass**: user closes the AI draft and writes their own version from scratch (referencing only the spec, not the draft).
3. **Review pass**: user asks AI "here's my implementation; how does it differ from your draft, and what trade-offs am I making?" — this is where most learning happens.

When asked to do step 1 or step 3, **deliver concretely** (real code, real diff analysis) — these are real work for the user even if AI does most of the typing.

### Timeline impact

Hand-writing the modules above adds ~5 weeks to the M1–M6 timeline (22 → 27 weeks). This is accepted and reflected in execution-time expectations; do not pressure the user to delegate user-owned modules for "speed".

---

## Before Submitting a Change

Run these checks (CI runs all of them):

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm test
```

If you touched DB schema:
```bash
pnpm --filter @benkyou/core exec drizzle-kit generate
# Review the generated SQL — drizzle-kit can miss extension/index nuances.
```

If you touched UI:
```bash
pnpm --filter @benkyou/web dev
# Manually verify in browser: golden path + 2-3 edge cases. Don't claim "looks good" without running.
```

---

## Where to Get Stuck (and Ask)

- Spec says X but reality requires Y → ask, don't silently diverge
- Library version doesn't match plan → ask before upgrading (versions in plan are pinned for reproducibility)
- New external service / SaaS dependency → ask (this project is self-host-first)
- More than 200 lines of new code in one task → consider whether the task should be split

When asking: cite spec section/line, current code path, and what specifically you can't reconcile.
