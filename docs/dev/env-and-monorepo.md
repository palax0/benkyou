# Env loading & monorepo build gotchas

Hard-won notes for working in this pnpm monorepo. Read before touching `.env`
loading, `@benkyou/core` imports, or the Docker builds. This file is
authoritative; code comments and agent memories point here.

## One `.env`, loaded per entrypoint

There is a single source-of-truth `.env` at the **repo root**. Nothing
auto-discovers it across packages, so each entrypoint loads it explicitly:

| Entrypoint | How it loads the root `.env` |
|---|---|
| `pnpm migrate` and other root scripts | `tsx --env-file-if-exists=.env scripts/*.ts` (run from repo root) |
| worker (`apps/worker`) dev/start | `--env-file-if-exists=../../.env` on the `tsx` / `node` invocation |
| web (`apps/web`) | `next.config.ts` calls `process.loadEnvFile(<root>/.env)` — Next can't take the CLI flag and only auto-loads `apps/web/.env*` |
| Docker / serverless runtime | vars injected by the platform (compose `env_file`, Vercel env) — no file load |

`--env-file-if-exists` and the `existsSync` guard in `next.config.ts` are
deliberate: in CI/prod the file is absent and vars come from the platform, so
loading must be optional.

**Adding a new entrypoint?** Reuse the matching mechanism above — don't invent a
third one.

## DB host: `localhost` vs `postgres`

`.env`'s `DATABASE_URL` uses the compose **service name** `postgres`, which only
resolves *inside* the compose network (web/worker containers). **Host-run**
scripts (`pnpm migrate`, seeds, `scripts/migrate-embeddings.ts`) run in your
shell, where `postgres` does not resolve (`getaddrinfo EAI_AGAIN postgres`).
Compose publishes `5432:5432`, so override the host inline:

```bash
docker compose up -d postgres
DATABASE_URL=postgres://benkyou:benkyou@localhost:5432/benkyou pnpm migrate
```

**Do not** change `.env`'s host to `localhost` — that breaks the containers.
`--env-file*` does not overwrite an already-set env var, so the inline override
wins.

## Env validation: import is side-effect-free; assert at startup

`@benkyou/core/config` (`env.ts`) parses and exposes `env`, but **importing it
never throws**. A library that validated (threw) at import time would crash any
context that merely imports it without secrets present — `next build` collecting
page data, tooling scripts, and so on. That used to be papered over with a
`SKIP_ENV_VALIDATION` build flag; the flag is gone.

Instead, each **process** fails fast by calling `assertEnv()` at startup:

- worker: first line of `main()` (`apps/worker/src/index.ts`)
- root scripts: top of the script (`scripts/migrate.ts`)
- web: `apps/web/instrumentation.ts` `register()` (nodejs runtime only)

Rule: **never add import-time side effects to `@benkyou/core` modules.** If
something must run at startup, expose a function the application calls.

## Consuming `@benkyou/core`

- The package's `exports` map points straight at `./src/*.ts` (there is no
  prebuilt `dist`). Both consumers compile TS from source — web via turbopack,
  worker/scripts via `tsx`.
- Relative imports **inside** core use the `.js` extension (`./loop.js` from
  `loop.ts`), as required by NodeNext ESM resolution. Turbopack expects this
  too; an extensionless specifier breaks one bundler or the other.
- Any package (or the root) that imports it must declare the dependency
  explicitly (`"@benkyou/core": "workspace:*"`) — pnpm only symlinks declared
  workspace deps.
