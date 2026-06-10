# Benkyou — Per-request embedding dimensions (Matryoshka truncation)

- **Date**: 2026-06-08
- **Status**: Approved design (pre-implementation)
- **Scope**: M1 finishing enhancement — land **before** M2.
- **Relates to**: master design [`2026-05-27-benkyou-design.md`](2026-05-27-benkyou-design.md) §5.3 (embed_dim freeze), §6.2 (embed stage); Hard Invariant "Embedding dimension is frozen at install time" in `CLAUDE.md`.

## 1. Motivation

The embedding column is `vector(EMBED_DIM)` (currently `vector(1536)`), frozen at migration-generation time. Newer embedding models have higher native dimensions — `text-embedding-3-large` = 3072, `gemini-embedding-001` = 3072, Qwen3-Embedding, etc. Today the only ways to use such a model are:

1. Find/configure a model that natively outputs exactly `EMBED_DIM`, or
2. Migrate the column to `halfvec` (to store/index >2000 dims) — storage + index cost, a real column-type migration, and it still doesn't help a model whose native dim simply ≠ `EMBED_DIM`.

This blocks M1 validation: the maintainer's available high-dim models can't be slotted into `vector(1536)`.

Most modern high-dim models support **Matryoshka Representation Learning (MRL)**: they accept a per-request dimension parameter and return a meaningful truncated vector. This lets a 3072-dim model emit exactly `EMBED_DIM` dims, keeping `vector(1536)` and avoiding `halfvec`.

## 2. Goals / Non-goals

**Goals**
- Allow the embedding request to carry a per-request output-dimension parameter so a high-native-dim model emits exactly `EMBED_DIM` dims.
- Keep the frozen-dim invariant intact: `vector(EMBED_DIM)`, `user_settings.embed_dim` read-only.
- Backward compatible: default behavior unchanged (param not sent).
- Make the connectivity test (setup/settings) reflect runtime, so what passes the test is what the pipeline does.

**Non-goals**
- Making `embed_dim` itself changeable or UI-writable.
- Switching the column to `halfvec`.
- Automated re-embedding (`scripts/migrate-embeddings.ts` remains deferred per master spec §5.3).

## 3. Core constraint (load-bearing)

The column is `vector(EMBED_DIM)` and `packages/core/src/pipeline/embed.ts` hard-guards that the returned vector length equals `env.EMBED_DIM`, throwing otherwise.

Therefore **the requested dimension is always `EMBED_DIM`** — it is never an independent value (any other value would fail the guard and cannot be stored). The only genuinely new state is a **boolean: send the dimension param, or not.**

Why a boolean and not "always send": non-MRL models (`text-embedding-ada-002`, many Ollama embedding models) either error (HTTP 400) or ignore an unexpected `dimensions` field. Default-off preserves current behavior; the user opts in when they configure an MRL model.

The dim guard stays in place and now additionally validates that truncation actually produced `EMBED_DIM`.

## 4. Design

### 4.1 Data model

`packages/core/src/db/schema.ts` — add to `user_settings`:

```ts
embedRequestDimensions: boolean('embed_request_dimensions').notNull().default(false),
```

- New Drizzle migration: additive column, `DEFAULT false`. The existing single row (id=1) backfills safely.
- **Does not touch `item_embeddings` or the `vector(N)` type. No re-embed is triggered by this migration.**

`packages/core/src/config/env.ts` — add optional seed env for fresh installs (same role as the other `DEFAULT_EMBED_*` vars):

```ts
DEFAULT_EMBED_REQUEST_DIMENSIONS: z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional(),
```

> **Do not use `z.coerce.boolean()`** here: it coerces via `Boolean(string)`, so the string `"false"` would become `true`. The explicit `'true' | 'false'` enum avoids that footgun. Empty-string env values are already filtered to unset by `env.ts`, so an unset/blank var is treated as "off" via the column default.

### 4.2 Provider layer — `packages/core/src/ai/provider.ts`

Extend `EmbeddingConfig` with an optional requested dimension:

```ts
export interface EmbeddingConfig extends ProviderConfig {
  dimensions?: number; // when set, request the model to emit exactly this many dims
}
```

Add a pure mapping function that returns call-time `providerOptions` (or `undefined` when `dimensions` is unset):

| `cfg.provider`                  | `providerOptions` returned                          |
| ------------------------------- | --------------------------------------------------- |
| `openai`                        | `{ openai: { dimensions } }`                        |
| `google`                        | `{ google: { outputDimensionality: dimensions } }`  |
| `openai-compatible` / `ollama`  | `{ openaiCompatible: { dimensions } }`              |
| unknown                         | throw (unreachable — `resolveEmbedding` rejects first) |

```ts
export function embeddingProviderOptions(
  cfg: EmbeddingConfig,
): Record<string, Record<string, number>> | undefined {
  if (cfg.dimensions == null) return undefined;
  switch (cfg.provider) {
    case 'openai':
      return { openai: { dimensions: cfg.dimensions } };
    case 'google':
      return { google: { outputDimensionality: cfg.dimensions } };
    case 'openai-compatible':
    case 'ollama':
      return { openaiCompatible: { dimensions: cfg.dimensions } };
    default:
      throw new Error(`Embedding provider does not support dimensions request: ${cfg.provider}`);
  }
}
```

> **Verified key, not assumed.** The `@ai-sdk/openai-compatible` embedding model (`doEmbed`) merges `dimensions` from three `providerOptions` keys: `"openai-compatible"` (deprecated — emits a runtime warning), `"openaiCompatible"` (canonical camelCase), and the provider's own name. The camelCase `openaiCompatible` key is read **unconditionally for both** the `openai-compatible` and `ollama` model names, so it is the single correct key for both. Using `{ [cfg.provider]: ... }` would hit the deprecated path for `openai-compatible`. Re-verify this key if `@ai-sdk/openai-compatible` is upgraded past `2.0.48`.

These are **call-time** `providerOptions` on `embed`/`embedMany` (confirmed present on both APIs in `ai@6`), not model-creation settings — so `resolveEmbedding` stays unchanged and the mapping is applied at the call site.

### 4.3 Settings — `packages/core/src/settings/index.ts`

`buildEmbeddingConfig` derives `dimensions` from the stored frozen dim (single source of truth):

```ts
dimensions: s.embedRequestDimensions ? s.embedDim : undefined,
```

Add `embedRequestDimensions?: boolean` to `SettingsPatch`.

### 4.4 Pipeline — `packages/core/src/pipeline/embed.ts`

```ts
const cfg = buildEmbeddingConfig(settings);
const model = resolveEmbedding(cfg);
const providerOptions = embeddingProviderOptions(cfg);
const { embeddings } = await embedMany({ model, values: [docText, item.title], providerOptions });
```

The existing dim-mismatch error string gains a hint that enabling "request dimensions" can truncate an MRL model to `EMBED_DIM`.

### 4.5 Connectivity test — `packages/core/src/setup/index.ts`

`testEmbedding` must use the same `providerOptions` so the test reflects runtime:

```ts
const { embedding } = await embed({
  model: resolveEmbedding(cfg),
  value: 'ping',
  providerOptions: embeddingProviderOptions(cfg),
});
```

`SetupInput.embedding` gains `requestDimensions?: boolean`; `completeSetup` writes `embedRequestDimensions` to the row (seeded from `DEFAULT_EMBED_REQUEST_DIMENSIONS` when the setup form is pre-filled).

### 4.6 UI — `apps/web`

- `setup/SetupForm.tsx` and `(authed)/settings/SettingsForm.tsx`: a checkbox **"Request output dimensions (truncate to N)"** in the embedding section, where N = `EMBED_DIM`.
- `setup/actions.ts` and `(authed)/settings/actions.ts`: read the checkbox, thread it into the `EmbeddingConfig` passed to `testEmbedding`, and persist it.
- **Smart error**: on `dimMismatch`, the message tells the user the model returned N dims and suggests enabling the toggle to truncate to `EMBED_DIM` (only meaningful when the toggle was off and `got > want`).
- `embed_dim` remains read-only and unchanged.

### 4.7 i18n

New zh/en keys: the toggle label + help text, and the improved `dimMismatch` message. `pnpm check:i18n` enforces both locales.

## 5. Rejected alternatives

- **Switch column to `halfvec`** — the cost the maintainer wants to avoid; also doesn't fix native-dim ≠ `EMBED_DIM` for non-MRL models.
- **Always send `dimensions=EMBED_DIM`, no toggle** — breaks non-MRL models that 400 or ignore the field; default must stay backward compatible.
- **Store a nullable integer `embed_dimensions`** — looks more flexible but it must always equal `EMBED_DIM` or the guard fires; storing a second copy of the dim invites drift and confusion. The boolean derives the value, keeping one source of truth.

## 6. Caveats (documented, no code)

- **Google does not auto-normalize truncated vectors.** For `gemini-embedding-001`, requesting `outputDimensionality < 3072` returns vectors Google does **not** re-normalize. Search uses pgvector cosine distance `<=>` (scale-invariant), so ranking is unaffected today. **If** search ever moves to inner-product `<#>` or L2 `<->`, client-side L2 normalization of stored vectors becomes required. Note this in master spec §6.2.
- **No automatic re-embed.** Enabling the toggle on an existing corpus does not re-embed prior items; vectors stored under the old config remain. Full consistency requires a re-embed, which is the deferred `migrate-embeddings.ts` story (master spec §5.3).

## 7. Test plan

- **Unit** (`packages/core/test/ai/`): `embeddingProviderOptions` — one assertion per provider key mapping, and `undefined` when `dimensions` is unset.
- **Integration** (`packages/core/test/pipeline/`): with the toggle on, the embed stage threads `providerOptions` through to the model (assert via a stub embedding model that captures call options); the dim guard still throws on a genuine length mismatch.
- **Connectivity**: `testEmbedding` honors the toggle (stub model receives the dimension param).
- Follows existing TDD discipline for pipeline logic (master `CLAUDE.md` conventions).

## 8. Doc / invariant updates required by this change

- Master spec §5.3 (embed_dim note) + §6.2 (embed stage): addendum describing dimensions-truncation and that **requested dim ≡ `embed_dim`**.
- `CLAUDE.md` "Embedding dimension is frozen at install time" invariant: one sentence — the dimensions param makes a high-native-dim model **fit** the frozen dim; it does not change it.

## 9. File-touch checklist

`packages/core`:
- `src/db/schema.ts` (+ generated migration)
- `src/config/env.ts`
- `src/ai/provider.ts`
- `src/settings/index.ts`
- `src/setup/index.ts`
- `src/pipeline/embed.ts`
- `test/ai/embedding-provider-options.test.ts` (new)
- `test/pipeline/` embed integration (extend)

`apps/web`:
- `app/setup/SetupForm.tsx`, `app/setup/actions.ts`
- `app/(authed)/settings/SettingsForm.tsx`, `app/(authed)/settings/actions.ts`
- i18n message catalogs (zh + en)

`docs`:
- master spec §5.3 / §6.2 addendum
- `CLAUDE.md` invariant sentence

## 10. Sequencing

This is an M1 finishing enhancement that unblocks M1 validation. It does not depend on M2, adds no pipeline stage, and does not alter `item_embeddings`. Land it before starting M2.
