# M1b Product Code Review Handoff

Date: 2026-06-10

Worktree:

```bash
/home/lacanian/learning/benkyou/.claude/worktrees/m1b-product
```

Branch:

```bash
worktree-m1b-product
```

Review range:

```bash
BASE_SHA=9f424b393f5388565cbe4ec139279c84650f5066
HEAD_SHA=5c33a776f684e5deb21904dbcba0cba0f7d7892b
```

There is also an uncommitted diff in the worktree:

```bash
M apps/web/next.config.ts
```

## Instructions for the Next Session

Fix the review issues in the m1b worktree above. Do not edit the main worktree.

Before changing code, read:

- `AGENTS.md`
- `docs/superpowers/plans/2026-05-31-benkyou-m1b-product.md`
- `docs/superpowers/specs/2026-05-27-benkyou-design.md`, especially sections 7, 8.3, 9, 10, and 11.4

Keep these project invariants in mind:

- Business logic belongs in `packages/core`; `apps/web` should stay thin.
- User-visible item queries must filter `state='done'`.
- Hybrid search must pre-apply `state='done'` and user filters in both lexical and vector candidate queries before RRF.
- Auth is session-cookie based, not JWT.
- Single-user deployment: no `user_id` or multi-tenancy.

## Merge Blockers

### 1. Public Setup Action Can Mint a Session After Initialization

Files:

- `apps/web/app/setup/actions.ts`
- `packages/core/src/setup/index.ts`

Problem:

`setupAction` is a public mutation and does not re-check initialization at the action boundary. The page redirects initialized installs away from `/setup`, but a direct action invocation can still run. `completeSetup()` uses `onConflictDoNothing`, so after initialization the settings insert can no-op while the action still adds an RSS source, triggers fetch, creates a session, and sets the auth cookie.

Why it matters:

This is an auth bypass for an initialized deployment.

Fix guidance:

- Add an action-level `isInitialized()` guard before connectivity tests.
- Make `completeSetup()` report whether it inserted the row.
- Only add the first source, trigger fetch, and create a session if initialization actually succeeded.
- Prefer a transaction around first setup.
- Add a regression test for direct setup submission after initialization.

### 2. Settings and Password Server Actions Do Not Authorize Themselves

File:

- `apps/web/app/(authed)/settings/actions.ts`

Problem:

`updateSettingsAction` and `changePasswordAction` mutate provider config and password without calling `requireAuth()`. Middleware only checks whether a cookie exists; it does not validate the session in Postgres. Layout auth should not be relied on to authorize server actions.

Why it matters:

An invalid/random `session` cookie can reach these server actions and mutate sensitive settings.

Fix guidance:

- Call `requireAuth()` at the top of every non-public server action.
- Add tests for no cookie and invalid/random `session` cookie.

### 3. Stored Provider API Keys Are Rendered Back to the Browser

File:

- `apps/web/app/(authed)/settings/SettingsForm.tsx`

Problem:

The form renders stored `llmApiKey` and `embedApiKey` as password input `defaultValue`s.

Why it matters:

Secrets are sent to the browser and become available in page HTML/React state/browser tooling.

Fix guidance:

- Do not pass raw API key values to client components.
- Show a neutral "configured" placeholder/state instead.
- On submit, only overwrite a key if the user typed a new non-empty value; otherwise preserve the existing value server-side.
- Consider separate "clear key" controls if needed later.

### 4. Hybrid Search Ignores `embed_request_dimensions`

File:

- `packages/core/src/search/hybrid.ts`

Problem:

`hybridSearch()` calls `embed()` without passing `providerOptions: embeddingProviderOptions(cfg)`. `buildEmbeddingConfig(settings)` may include `dimensions`, but the option is not forwarded.

Why it matters:

Setup, settings, and the pipeline can work with a high-native-dim embedding model, but `/search` can still request native vectors and then fail against the frozen `vector(1536)` column.

Fix guidance:

- Build the embedding config once.
- Pass `embeddingProviderOptions(cfg)` into the search `embed()` call.
- Assert `embedding.length === settings.embedDim` before building the vector literal.
- Add a regression test for `embedRequestDimensions=true`.

### 5. Search Final Fetch Skips the Defensive Filter Pass

File:

- `packages/core/src/search/hybrid.ts`

Problem:

The lexical and vector candidate queries correctly pre-apply filters, but the final detail query only fetches by ranked IDs.

Why it matters:

Spec section 7.1 requires a defensive re-filter after RRF for race cases, such as source/filter state changing between candidate selection and final fetch.

Fix guidance:

- Re-apply `state='done'` and all user filters in the final query.
- Alternatively, use a CTE that joins ranked IDs against a filtered `items`/`sources` query.

### 6. Browser Cookie Expiry Is Not Truly Sliding

Files:

- `packages/core/src/auth/session.ts`
- `apps/web/lib/auth.ts`

Problem:

`validateSession()` extends `sessions.expires_at` in Postgres, but the browser cookie expiry is only set at login/setup.

Why it matters:

The spec requires 30-day sliding expiry with a 90-day absolute cap. Active users still lose the browser cookie 30 days after the original login.

Fix guidance:

- Return the refreshed expiry from session validation, or add a helper that returns session validity plus refreshed cookie expiry.
- Refresh the cookie from a boundary that is allowed to set cookies.
- Keep the DB session as the source of truth.

### 7. Uncommitted Debug Fetch Logging

File:

- `apps/web/next.config.ts`

Problem:

There is an uncommitted change enabling:

```ts
logging: {
  fetches: {
    fullUrl: true,
  },
}
```

Why it matters:

This can add noisy or sensitive full URL logging. It is also dirty worktree state before merge.

Fix guidance:

- Remove it unless the maintainer explicitly wants it in production diagnostics.

### 8. Settings Form Has Hardcoded English Placeholders

File:

- `apps/web/app/(authed)/settings/SettingsForm.tsx`

Problem:

Placeholders such as `llm provider`, `embed model`, and `interest tags` bypass i18n.

Fix guidance:

- Add message keys in both `apps/web/messages/en.json` and `apps/web/messages/zh.json`.
- Use `useTranslations()` for all user-visible placeholders.

## Verification Already Run During Review

These commands were run in `worktree-m1b-product` during review:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm test
pnpm --filter @benkyou/web test:e2e
git diff --check
```

Observed results:

- `pnpm install --frozen-lockfile`: passed
- `pnpm lint`: passed
- `pnpm typecheck`: passed
- `pnpm check:i18n`: passed
- `pnpm test`: passed outside the sandbox with Docker/Testcontainers access
- `pnpm --filter @benkyou/web test:e2e`: passed outside the sandbox; 4 Playwright tests passed
- `git diff --check`: passed

Notes:

- In the sandbox, `tsx` commands can fail with `listen EPERM` on `/tmp/tsx-1000/*.pipe`. Re-run affected commands outside the sandbox if needed.
- Testcontainers need Docker access; run Docker-backed tests outside the sandbox if the container runtime is not visible.

## Required Verification After Fixes

After applying fixes, run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm test
pnpm --filter @benkyou/web test:e2e
git diff --check
git status --short --branch
```

Final report should include:

- Files changed
- How each issue above was resolved
- Command results
- Whether the worktree is clean

## Current Assessment

Not ready to merge before the fixes above. The architecture is close and automated checks were green during review, but the setup/auth action issues and search dimensions regression are merge blockers.
