# AGENTS.md

Instructions for AI coding agents (Codex, Claude, Cursor, Aider, etc.) working on this repository.

## Project

**Benkyou** — self-hosted personal AI news aggregator with Q&A agent. Open-source, single-user-per-deployment. Bilingual (zh/en). Solo build by a frontend developer learning full-stack.

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
- New background job handler → register in BOTH `packages/core/src/queue/{loop,batch}.ts` dispatchers + handler in `packages/core/src/pipeline/`
- New React component → `apps/web/components/` (or co-located in route folder if single-use)

**Where NOT to put code**:
- ❌ Business logic in API routes (call into `@benkyou/core` instead)
- ❌ Direct DB access from `apps/web` or `apps/worker` (use `@benkyou/core/db`)
- ❌ Provider-specific LLM calls anywhere outside `packages/core/src/ai/`

**Env loading, `@benkyou/core` imports, and Docker builds have non-obvious traps** — read [`docs/dev/env-and-monorepo.md`](docs/dev/env-and-monorepo.md) before touching them.

---

## Hard Invariants

These are load-bearing decisions. **Do not change without discussing with the user.**

### Pipeline state machine

Items flow through 6 stages: `pending → extracted → embedded → scored → dedup_done → done`. On failure, **state does NOT change** during retries — only `attempts++` and `last_error` are written. Only after pg-boss exhausts `user_settings.pipeline_max_attempts` retries does the `onFail` callback set `state='failed'`. **All user-visible queries filter `state='done'`.**

If you add a new pipeline stage, follow the checklist in spec §6.1 (state enum, schema, handler, **both** worker dispatchers).

### Embedding dimension is frozen at install time

`EMBED_DIM` is baked into the migration SQL at `drizzle-kit generate` time (currently `vector(1536)` in `0000_initial.sql`) — it is **not** re-read at `migrate` time, so changing the env var alone does nothing. `user_settings.embed_dim` **must not be writable from the UI**. Changing dimension is a drop-and-re-embed operation with no automated script yet — procedure and the `embed_request_dimensions` truncation option are in spec §5.3.

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

Do not implement these even if they seem helpful (rationale in spec §3.4): multi-user/multi-tenancy, behavior-based personalization (postponed), browser extension (postponed), native mobile app (responsive web only), notes/highlights/annotations, social features, offline mode, self-trained models (all AI is BYO endpoint).

---

## Working with the User

Maintainer communicates in Chinese (technical English fine in code/comments). Wants substantive pushback when something seems wrong, not validation — surface tradeoffs and edge cases explicitly, don't hand-wave.

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

- Library version doesn't match plan → ask before upgrading (versions in plan are pinned for reproducibility)
- New external service / SaaS dependency → ask (this project is self-host-first)
- More than 200 lines of new code in one task → consider whether the task should be split

When asking: cite spec section/line, current code path, and what specifically you can't reconcile.

---

## Design Context

UI/视觉改动前先读根目录 [`PRODUCT.md`](PRODUCT.md)(设计定位、品牌人格、反向参考)与 [`DESIGN.md`](DESIGN.md)(视觉系统,如存在)。UI 结构性内容(路由、布局、交互)以 spec §9 为准;PRODUCT.md/DESIGN.md 负责"长什么样、什么气质"。

---

## UI Development Workflow (superpowers × impeccable)

Two skill systems run on this repo. They are **not competitors — they are different layers**:

- **superpowers** = the process spine for *all* work (brainstorming → writing-plans → subagent-driven-development → requesting-code-review → finishing-branch). Decides *what* to build and gets it safely merged.
- **impeccable** = a specialist for the *visual/design phase only* (`craft`, `live`, `document`). Invents visual language and folds it into `DESIGN.md`. It is **not** an engineering-process tool and does **not** replace superpowers discipline.

**They never both "drive" the same task.** Routing is decided at `writing-plans` time, per task:

- 🔧 **Derivative or logic** — reuses patterns already in `DESIGN.md`, or is pure logic → **pure superpowers**. impeccable is irrelevant.
- 🎨 **Net-new visual** — a surface `DESIGN.md` doesn't yet cover → superpowers builds it functional first, impeccable polishes it later.

As `DESIGN.md` matures, the share of 🎨 tasks shrinks toward zero. That convergence is an *outcome*, not a starting assumption.

### Sequencing within a milestone

1. `brainstorming` + `writing-plans` — tag every task 🔧 / 🎨.
2. **(exception) spike-first** — only for 🎨 surfaces where *the final look dictates DOM structure*, OR *`DESIGN.md` has almost no reusable primitive for it*. Run impeccable `craft` first to settle structure/primitives, `document` into `DESIGN.md`, then build logic into it. Avoids structural rework and starves improvisation.
3. **subagent-driven-development** — build the *whole* milestone to a functional state on a running app with real data/states. TDD the logic. (impeccable's `live` iterates best on a real running app, not mockups — so functional-first, not mockup-first.)
4. **impeccable polish pass** — `live`-iterate the 🎨 surfaces, then `/impeccable document` to fold new tokens into `DESIGN.md`. **Do this before `requesting-code-review`** so review sees the final state (otherwise polish re-diffs already-reviewed code).
5. `requesting-code-review` → fix → `finishing-a-development-branch` → merge.

### Rules that keep the seam clean

The danger in the functional pass is **not** "too plain" (plain → polished is cheap, additive). It's the **half-styled middle state** — a subagent improvising some design sense that doesn't fully meet the system. Un-picking that during polish costs more than building from a clean blank. These rules forbid that state:

- **Presentation stays logic-free.** Structure components as logic-layer (hooks / server actions / state) + **dumb view** (markup fed by props). The clean boundary is the hook/view seam, **not** the task. A view with inline logic can't be polished without touching logic. *(CR checkpoint.)*
- **Subagents compose, never invent.** In the functional pass, presentation may **only** assemble existing `DESIGN.md` tokens / primitives. **No invented visual values** — no raw hex, no magic spacing, no ad-hoc shadow/motion. Where the kit lacks a primitive, leave a **structurally-neutral shell** (correct semantics/layout, zero flourish) marked `{/* DESIGN-GAP: … */}`. Never improvise to "make it look decent."
- **Handoff is a grep, not a guess.** The polish pass finds its targets by grepping `DESIGN-GAP` markers, not by eyeballing every screen.
- **Mechanical guard (rule now; wire into lint/CI).** In `apps/web/components`, never use raw hex, Tailwind arbitrary-value brackets (`p-[13px]`, `bg-[#abc]`), or inline `style=`. Everything goes through tokens. Add a lint/CI check so "no improvisation" is enforced, not aspirational.

> Net: don't rely on subagents *restraining* their taste — make improvisation impossible (closed vocabulary + lint). Where the token kit is too thin to compose from, spike-first to fill it before the functional pass.
