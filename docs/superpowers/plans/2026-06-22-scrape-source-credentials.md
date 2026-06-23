# Scrape-source credentials (YouTube PoToken + Bilibili SESSDATA) & YouTube Whisper fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give scrape sources a unified per-platform credential model — an anonymous YouTube PoToken from a self-hosted sidecar (unblocking captions *and* audio) and a user-supplied Bilibili `SESSDATA` via QR login — and wire YouTube caption-less videos into the existing Whisper `transcribe` chain.

**Architecture:** A new `platform_credentials` table stores both kinds. A docker-compose sidecar mints anonymous PoTokens; `youtube-session.ts` owns the token lifecycle (cache + refresh-once-on-expiry) and builds the Innertube session. Bilibili SESSDATA is injected into the existing caption fetcher via the same `credentials` thread used for `reader` config. A new *post-adapter* branch in `extractItem` routes YouTube `unavailable`-but-known-duration videos into `transcribePolicy` → the existing `transcribe` queue, with the ephemeral audio URL resolved fresh at download time.

**Tech Stack:** TypeScript 5.7 strict, Drizzle ORM, youtubei.js ^17.0.1, pg-boss, Next.js 16 (App Router) server actions + API routes, Vitest 4 + Testcontainers + MSW, `qrcode` (new dep, server-side QR rendering), Docker Compose.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-06-22-scrape-source-credentials-design.md`). Every task's requirements implicitly include this section.

- **M2a degrade contract (hard invariant):** any definitive failure → `transcript_status='unavailable'` + continue, **never throw to fail the item**. Missing/invalid credential = definitive = degrade. Only genuine transient (network/5xx) throws → pg-boss retry.
- **`isTranscribeEligible` stays unchanged** — it is the *pre-adapter* gate and must keep matching `media_url`-bearing items only (`contentType∈{audio,video}` && `media_url != null` && `transcriptStatus≠present`). The Layer-2 seam is *post*-adapter. Its existing tests stand.
- **No new `transcript_status` enum value** — schema churn not worth it; cases converge once Layer 2 is on. Distinguish degrade reasons via `console.warn` only.
- **YouTube uses anonymous PoToken** (visitor_data-based, no Google account cookie). Members/age-restricted = future extension, not built.
- **YouTube stores no `media_url`** — audio-stream URLs are ephemeral; resolved fresh at download time from the watch `url`.
- **docker-mode only.** Serverless does not transcribe and tolerates caption degradation (`skipped_serverless`); `POTOKEN_PROVIDER_URL` is normally unset there. Sidecar shares the worker network, reached by service name, **no published port**.
- **`POTOKEN_PROVIDER_URL` unset = capability off** → YouTube falls back to current "can't fetch → unavailable" behavior (graceful, no error).
- **Sidecar image is pinned and bumped** — anti-bot churn is absorbed by bumping the image tag, no Benkyou code change.
- **SSRF guard must not break googlevideo** — Range/redirects on the public googlevideo host must pass `assertSafeHttpUrl` (§4.4); verify, don't assume.
- TypeScript strict (no `any` without `// @ts-expect-error` + reason), named exports only, validate at boundaries with zod, every user-visible string through `useTranslations`/`getTranslations` with both zh + en keys.

---

## File Structure

**New files:**
- `packages/core/src/sources/platform-credentials.ts` — DB store for `platform_credentials` (get/upsert/status). The ONLY module that touches that table.
- `packages/core/src/sources/potoken-client.ts` — thin HTTP client for the sidecar (`fetchAnonymousPoToken`, `pingPotokenSidecar`).
- `packages/core/src/sources/youtube-session.ts` — owns `{Innertube, po_token, visitor_data}`: token cache (TTL), refresh-once-on-expiry, `withYoutubeSession`, `resolveYoutubeAudioUrl`, `isPotokenEnabled`.
- `packages/core/src/sources/bilibili-qr.ts` — QR login state machine (`generateBilibiliQr`, `pollBilibiliQr`).
- `apps/web/app/api/credentials/bilibili/qr/generate/route.ts` — POST: mint QR.
- `apps/web/app/api/credentials/bilibili/qr/poll/route.ts` — GET: poll + persist SESSDATA.
- `apps/web/app/(authed)/settings/sections/CredentialsSection.tsx` — credential status + Bili QR UI.
- Test files alongside each (see tasks).

**Modified files:**
- `packages/core/src/db/schema.ts` — add `platformCredentials` table.
- `packages/core/src/config/env.ts` — add `POTOKEN_PROVIDER_URL`.
- `packages/core/src/sources/types.ts` — add `credentials` to `ExtractInput`.
- `packages/core/src/sources/youtube.ts` — rewire `fetchYoutubeSubtitle` onto `youtube-session`.
- `packages/core/src/sources/bilibili.ts` — accept + attach SESSDATA cookie.
- `packages/core/src/pipeline/extract.ts` — read credentials, post-adapter Layer-2 branch, `applyTranscribePolicy` refactor.
- `packages/core/src/pipeline/transcribe.ts` — YouTube audio-URL resolver before download.
- `packages/core/src/pipeline/status.ts` — sidecar health + credential status into `PipelineStatus`.
- `apps/web/app/(authed)/settings/page.tsx` + `apps/web/app/(authed)/admin/jobs/page.tsx` — render new status.
- `apps/web/messages/{zh,en}.json` — new keys.
- `docker-compose.yml`, `.env.example` — sidecar service + env doc.
- `docs/superpowers/specs/2026-05-27-benkyou-design.md` — ordering correction (Task 10).

---

## Task 1: PoToken sidecar + anonymous-token client + Step-0 spike (GATE)

> **This task is the §7 gate.** The whole design rests on: *with a PoToken, both `get_transcript` and the audio stream unblock.* We have proven only the negative. **If the spike fails for captions, STOP and re-diagnose before building anything else.**

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `packages/core/src/config/env.ts:3-32` (add `POTOKEN_PROVIDER_URL`)
- Create: `packages/core/src/sources/potoken-client.ts`
- Create: `packages/core/test/sources/potoken-client.test.ts`
- Create: `packages/core/test/sources/youtube-potoken-spike.int.test.ts` (gated live test)

**Interfaces:**
- Produces: `fetchAnonymousPoToken(providerUrl: string, visitorData: string): Promise<string>` — POSTs `{ content_binding: visitorData }` to `${providerUrl}/get_pot`, returns `po_token`. Throws on non-2xx / missing field.
- Produces: `pingPotokenSidecar(providerUrl: string): Promise<boolean>` — `GET ${providerUrl}/ping`, true iff 2xx.
- Produces: `env.POTOKEN_PROVIDER_URL: string | undefined`.

- [ ] **Step 1: Add the sidecar service to `docker-compose.yml`**

Append under `services:` (sibling of `worker`). No published port; worker reaches it by service name.

```yaml
  potoken-provider:
    # Pinned anonymous-PoToken provider (bgutil-class). Bump the tag to absorb
    # anti-bot churn — no Benkyou code change (design §2). docker-mode only.
    image: brainicism/bgutil-ytdlp-pot-provider:1.1.0
    restart: unless-stopped
    expose:
      - '4416'
```

Then add `POTOKEN_PROVIDER_URL` to the `worker` service `environment:` block:

```yaml
      POTOKEN_PROVIDER_URL: http://potoken-provider:4416
```

- [ ] **Step 2: Document the env var in `.env.example`**

Add after the Whisper block:

```bash
# Optional: anonymous YouTube PoToken provider sidecar (docker-mode only).
# Unset = capability off → YouTube captions/Whisper degrade gracefully (design §2).
# The full `docker compose up` stack sets this to the sidecar service automatically.
POTOKEN_PROVIDER_URL=
```

- [ ] **Step 3: Add `POTOKEN_PROVIDER_URL` to the env schema**

In `packages/core/src/config/env.ts`, add to the `z.object({...})` (after `DEFAULT_WHISPER_MODEL`):

```typescript
  POTOKEN_PROVIDER_URL: z.string().url().optional(),
```

- [ ] **Step 4: Write the failing test for the sidecar client**

Create `packages/core/test/sources/potoken-client.test.ts`:

```typescript
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchAnonymousPoToken, pingPotokenSidecar } from '../../src/sources/potoken-client.js';

afterEach(() => vi.restoreAllMocks());

describe('fetchAnonymousPoToken', () => {
  test('POSTs visitor_data as content_binding and returns po_token', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ po_token: 'POT123', content_binding: 'VD' }), { status: 200 }),
    );
    const tok = await fetchAnonymousPoToken('http://sidecar:4416', 'VD');
    expect(tok).toBe('POT123');
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('http://sidecar:4416/get_pot');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ content_binding: 'VD' });
  });

  test('throws on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(fetchAnonymousPoToken('http://sidecar:4416', 'VD')).rejects.toThrow(/500/);
  });

  test('throws when po_token missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(fetchAnonymousPoToken('http://sidecar:4416', 'VD')).rejects.toThrow(/po_token/);
  });
});

describe('pingPotokenSidecar', () => {
  test('true on 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await pingPotokenSidecar('http://sidecar:4416')).toBe(true);
  });
  test('false on error / non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await pingPotokenSidecar('http://sidecar:4416')).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test, verify it fails**

Run: `pnpm --filter @benkyou/core test potoken-client`
Expected: FAIL — cannot resolve `../../src/sources/potoken-client.js`.

- [ ] **Step 6: Implement `potoken-client.ts`**

Create `packages/core/src/sources/potoken-client.ts`:

```typescript
// Thin HTTP client for the anonymous-PoToken sidecar (bgutil-class provider, design §2).
// The worker hands the sidecar a visitor_data "content binding"; the sidecar runs
// BotGuard and returns a po_token. No retry/cache here — youtube-session owns lifecycle.

interface GetPotResponse {
  po_token?: string;
}

export async function fetchAnonymousPoToken(providerUrl: string, visitorData: string): Promise<string> {
  const base = providerUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/get_pot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content_binding: visitorData }),
  });
  if (!res.ok) throw new Error(`PoToken provider /get_pot failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as GetPotResponse;
  if (!json.po_token) throw new Error('PoToken provider response missing po_token');
  return json.po_token;
}

export async function pingPotokenSidecar(providerUrl: string): Promise<boolean> {
  const base = providerUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/ping`);
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `pnpm --filter @benkyou/core test potoken-client`
Expected: PASS (5 tests).

- [ ] **Step 8: Write the Step-0 spike (gated live test)**

Create `packages/core/test/sources/youtube-potoken-spike.int.test.ts`. This is the load-bearing proof — off by default, run manually with the sidecar up.

```typescript
import { describe, expect, test } from 'vitest';
import { Innertube } from 'youtubei.js';
import { fetchAnonymousPoToken } from '../../src/sources/potoken-client.js';

// §7 SPIKE — the load-bearing assumption. Proves that an anonymous PoToken unblocks
// (a) caption fetch and (b) audio-stream download for the known-blocked video.
// Run: `docker compose up -d potoken-provider` then
//   RUN_NET_TESTS=1 POTOKEN_PROVIDER_URL=http://localhost:4416 \
//   pnpm --filter @benkyou/core test youtube-potoken-spike
// (publish 4416 locally for the spike only; production uses `expose` + service name).
const RUN = process.env.RUN_NET_TESTS === '1' && Boolean(process.env.POTOKEN_PROVIDER_URL);
const BLOCKED_ID = '7qO8-kx3gW8'; // §0: captions [zh-Hans, zh-Hant], blocked without PoToken

describe.skipIf(!RUN)('PoToken spike (§7 gate)', () => {
  test('anonymous PoToken unblocks captions AND audio stream', async () => {
    const providerUrl = process.env.POTOKEN_PROVIDER_URL!;
    const probe = await Innertube.create({ retrieve_player: false });
    const visitorData = probe.session.context.client.visitorData ?? '';
    expect(visitorData.length).toBeGreaterThan(0);

    const poToken = await fetchAnonymousPoToken(providerUrl, visitorData);
    expect(poToken.length).toBeGreaterThan(0);

    const yt = await Innertube.create({ retrieve_player: true, po_token: poToken, visitor_data: visitorData });
    const info = await yt.getInfo(BLOCKED_ID);
    expect(info.playability_status?.status).toBe('OK');

    // (a) captions
    const transcript = await info.getTranscript();
    const segments = transcript.transcript.content?.body?.initial_segments ?? [];
    expect(segments.length).toBeGreaterThan(0);

    // (b) audio stream — decipher + fetch the first bytes
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    const url = format.decipher(yt.session.player);
    expect(url).toMatch(/^https:\/\//);
    const head = await fetch(url, { headers: { range: 'bytes=0-1023' } });
    expect([200, 206]).toContain(head.status);
  }, 120_000);
});
```

- [ ] **Step 9: Run the spike (the gate)**

```bash
docker compose up -d potoken-provider
# Temporarily publish the port for the host-run test (do NOT commit a published port):
docker run -d --rm -p 4416:4416 --name pot-spike brainicism/bgutil-ytdlp-pot-provider:1.1.0
RUN_NET_TESTS=1 POTOKEN_PROVIDER_URL=http://localhost:4416 \
  pnpm --filter @benkyou/core test youtube-potoken-spike
docker stop pot-spike
```
Expected: PASS — captions yield >0 segments, audio stream returns 200/206.
**If captions FAIL:** the `get_transcript` 400 is not a PoToken problem (likely youtubei.js drift). STOP, report to the user, do not proceed to Task 2.

- [ ] **Step 10: Commit**

```bash
git add docker-compose.yml .env.example packages/core/src/config/env.ts \
  packages/core/src/sources/potoken-client.ts \
  packages/core/test/sources/potoken-client.test.ts \
  packages/core/test/sources/youtube-potoken-spike.int.test.ts
git commit -m "feat(sources): PoToken sidecar + anonymous-token client + §7 spike"
```

---

## Task 2: `platform_credentials` table + store module

**Files:**
- Modify: `packages/core/src/db/schema.ts` (add table after `sources`, before `eventClusters`)
- Generate: `packages/core/src/db/migrations/000N_*.sql` (drizzle-kit)
- Create: `packages/core/src/sources/platform-credentials.ts`
- Create: `packages/core/test/sources/platform-credentials.int.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  type Platform = 'youtube' | 'bilibili';
  interface PlatformCredentialRow { secret: string | null; meta: Record<string, unknown> | null; updatedAt: Date; }
  getPlatformCredential(platform: Platform): Promise<PlatformCredentialRow | null>;
  upsertPlatformCredential(platform: Platform, data: { secret?: string | null; meta?: Record<string, unknown> | null }): Promise<void>;
  getBilibiliSessdata(): Promise<string | null>; // convenience: secret of 'bilibili' row
  ```

- [ ] **Step 1: Add the table to `schema.ts`**

In `packages/core/src/db/schema.ts`, after the `sources` table block (line ~101):

```typescript
/* ─── platform_credentials ─── (per-platform scrape creds; design §1)
   Bili: secret = SESSDATA (user, QR login). YT: secret = cached po_token (machine).
   Adding a platform later = one more row, no schema change. */
export const platformCredentials = pgTable('platform_credentials', {
  platform: text('platform').primaryKey(), // 'youtube' | 'bilibili'
  secret: text('secret'),
  meta: jsonb('meta'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

(`pgTable`, `text`, `jsonb`, `timestamp` are already imported.)

- [ ] **Step 2: Generate the migration**

```bash
EMBED_DIM=1536 DATABASE_URL=postgres://benkyou:benkyou@localhost:5432/benkyou \
  SESSION_SECRET=$(printf 'x%.0s' {1..32}) \
  pnpm --filter @benkyou/core exec drizzle-kit generate
```
(env vars per memory: without `EMBED_DIM`/`DATABASE_URL`/`SESSION_SECRET` the snapshot records `vector(undefined)`.)
Expected: a new `migrations/000N_*.sql` creating `platform_credentials`. **Review it** — confirm it only creates the new table (no spurious `vector` column edits). If the diff touches `item_embeddings`, the env vars were missing; discard and regenerate.

- [ ] **Step 3: Write the failing integration test**

Create `packages/core/test/sources/platform-credentials.int.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';

describe('platform_credentials store', () => {
  let db: TestDatabase;
  let store: typeof import('../../src/sources/platform-credentials.js');
  let closeDbClient: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('sources/platform-credentials.int.test');
    store = await import('../../src/sources/platform-credentials.js');
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { await closeDbClient?.(); await db?.cleanup(); });

  test('missing row → null', async () => {
    expect(await store.getPlatformCredential('youtube')).toBeNull();
    expect(await store.getBilibiliSessdata()).toBeNull();
  });

  test('upsert inserts then updates (idempotent on primary key)', async () => {
    await store.upsertPlatformCredential('bilibili', { secret: 'SD1', meta: { expiresAt: 111 } });
    let row = await store.getPlatformCredential('bilibili');
    expect(row?.secret).toBe('SD1');
    expect(row?.meta).toEqual({ expiresAt: 111 });
    expect(await store.getBilibiliSessdata()).toBe('SD1');

    await store.upsertPlatformCredential('bilibili', { secret: 'SD2', meta: { expiresAt: 222 } });
    row = await store.getPlatformCredential('bilibili');
    expect(row?.secret).toBe('SD2');
    expect(row?.meta).toEqual({ expiresAt: 222 });
  });

  test('partial upsert updates only provided fields (meta preserved when omitted)', async () => {
    await store.upsertPlatformCredential('youtube', { secret: 'POT', meta: { visitorData: 'VD' } });
    await store.upsertPlatformCredential('youtube', { secret: 'POT2' }); // meta omitted
    const row = await store.getPlatformCredential('youtube');
    expect(row?.secret).toBe('POT2');
    expect(row?.meta).toEqual({ visitorData: 'VD' });
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `pnpm --filter @benkyou/core test platform-credentials`
Expected: FAIL — cannot resolve `platform-credentials.js`.

- [ ] **Step 5: Implement `platform-credentials.ts`**

Create `packages/core/src/sources/platform-credentials.ts`:

```typescript
import { eq, sql } from 'drizzle-orm';
import { getDbClient, platformCredentials } from '../db';

export type Platform = 'youtube' | 'bilibili';

export interface PlatformCredentialRow {
  secret: string | null;
  meta: Record<string, unknown> | null;
  updatedAt: Date;
}

export async function getPlatformCredential(platform: Platform): Promise<PlatformCredentialRow | null> {
  const db = getDbClient();
  const rows = await db
    .select({ secret: platformCredentials.secret, meta: platformCredentials.meta, updatedAt: platformCredentials.updatedAt })
    .from(platformCredentials)
    .where(eq(platformCredentials.platform, platform))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { secret: r.secret, meta: (r.meta as Record<string, unknown> | null) ?? null, updatedAt: r.updatedAt };
}

// Upsert. A field absent from `data` is left untouched (COALESCE on conflict) so callers
// can update just the secret without clobbering meta (and vice-versa).
export async function upsertPlatformCredential(
  platform: Platform,
  data: { secret?: string | null; meta?: Record<string, unknown> | null },
): Promise<void> {
  const db = getDbClient();
  const secret = data.secret ?? null;
  const meta = data.meta ?? null;
  await db
    .insert(platformCredentials)
    .values({ platform, secret, meta, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: platformCredentials.platform,
      set: {
        secret: data.secret === undefined ? sql`${platformCredentials.secret}` : secret,
        meta: data.meta === undefined ? sql`${platformCredentials.meta}` : meta,
        updatedAt: sql`now()`,
      },
    });
}

export async function getBilibiliSessdata(): Promise<string | null> {
  return (await getPlatformCredential('bilibili'))?.secret ?? null;
}
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm --filter @benkyou/core test platform-credentials`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/migrations \
  packages/core/src/sources/platform-credentials.ts \
  packages/core/test/sources/platform-credentials.int.test.ts
git commit -m "feat(db): platform_credentials table + store module"
```

---

## Task 3: `youtube-session.ts` — token lifecycle + Innertube wiring

**Files:**
- Create: `packages/core/src/sources/youtube-session.ts`
- Create: `packages/core/test/sources/youtube-session.test.ts`
- Modify: `packages/core/src/sources/youtube.ts` (rewire `fetchYoutubeSubtitle`, split `fetchOnce`)
- Modify: `packages/core/test/sources/youtube.test.ts` (no behavior change to the pure adapter; ensure it still passes)

**Interfaces:**
- Consumes (Task 1): `fetchAnonymousPoToken`, `pingPotokenSidecar`, `env.POTOKEN_PROVIDER_URL`. (Task 2): `getPlatformCredential`, `upsertPlatformCredential`.
- Produces:
  ```typescript
  class YoutubeTokenExpiryError extends Error { constructor(public partial: RawSubtitleTrack); }
  isPotokenEnabled(): boolean;
  isYoutubeTokenExpiryError(err: unknown): boolean;
  interface SessionDeps {
    enabled: boolean;
    loadToken: () => Promise<{ poToken: string; visitorData: string } | null>;
    refreshToken: () => Promise<{ poToken: string; visitorData: string }>;
    buildInnertube: (tok: { poToken: string; visitorData: string } | null) => Promise<Innertube>;
  }
  withYoutubeSession<T>(op: (yt: Innertube) => Promise<T>, deps?: SessionDeps): Promise<T>;
  resolveYoutubeAudioUrl(videoId: string): Promise<string>; // Task 8 consumes; defined here
  ```

**Design notes (read before coding):**
- `withYoutubeSession` runs `op` with the current session. On a token-expiry-shaped throw (`YoutubeTokenExpiryError` or `isYoutubeTokenExpiryError`), it refreshes the token **once** and retries. A second expiry propagates. `TransientFetchError` and all other errors pass straight through (no refresh).
- Capability off (`enabled=false`): build a bare Innertube (`INNERTUBE_OPTIONS` only), run `op` once, never refresh — preserves today's behavior.
- Token cache lives in `platform_credentials('youtube')`: `secret=po_token`, `meta={ visitorData, fetchedAt }`. TTL = 6h; expired cache → treated as miss → refresh.

- [ ] **Step 1: Write the failing unit test for the orchestration**

Create `packages/core/test/sources/youtube-session.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import {
  withYoutubeSession,
  isYoutubeTokenExpiryError,
  YoutubeTokenExpiryError,
  type SessionDeps,
} from '../../src/sources/youtube-session.js';
import { TransientFetchError } from '../../src/sources/types.js';
import type { Innertube } from 'youtubei.js';

const FAKE_YT = {} as Innertube;
function deps(over: Partial<SessionDeps> = {}): SessionDeps {
  return {
    enabled: true,
    loadToken: vi.fn(async () => ({ poToken: 'cached', visitorData: 'VD' })),
    refreshToken: vi.fn(async () => ({ poToken: 'fresh', visitorData: 'VD' })),
    buildInnertube: vi.fn(async () => FAKE_YT),
    ...over,
  };
}

describe('isYoutubeTokenExpiryError', () => {
  test.each([
    [new Error('Request failed with status 400'), true],
    [new Error('No valid URL to decipher'), true],
    [new Error('status 403 Forbidden'), true],
    [new YoutubeTokenExpiryError({ durationSeconds: 10, title: null, cues: [] }), true],
    [new TransientFetchError('502'), false],
    [new Error('totally unrelated'), false],
  ])('%s', (err, expected) => {
    expect(isYoutubeTokenExpiryError(err)).toBe(expected);
  });
});

describe('withYoutubeSession', () => {
  test('happy path: runs op once with cached token, no refresh', async () => {
    const d = deps();
    const r = await withYoutubeSession(async () => 'ok', d);
    expect(r).toBe('ok');
    expect(d.refreshToken).not.toHaveBeenCalled();
  });

  test('no cached token → refreshes before first run', async () => {
    const d = deps({ loadToken: vi.fn(async () => null) });
    await withYoutubeSession(async () => 'ok', d);
    expect(d.refreshToken).toHaveBeenCalledTimes(1);
  });

  test('expiry on first op → refresh once → retry succeeds', async () => {
    const d = deps();
    let calls = 0;
    const r = await withYoutubeSession(async () => {
      calls += 1;
      if (calls === 1) throw new Error('status 400');
      return 'recovered';
    }, d);
    expect(r).toBe('recovered');
    expect(d.refreshToken).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  test('expiry twice → propagates the second error (no infinite refresh)', async () => {
    const d = deps();
    await expect(
      withYoutubeSession(async () => { throw new Error('status 400'); }, d),
    ).rejects.toThrow(/400/);
    expect(d.refreshToken).toHaveBeenCalledTimes(1);
  });

  test('TransientFetchError passes through without refresh', async () => {
    const d = deps();
    await expect(
      withYoutubeSession(async () => { throw new TransientFetchError('502'); }, d),
    ).rejects.toBeInstanceOf(TransientFetchError);
    expect(d.refreshToken).not.toHaveBeenCalled();
  });

  test('disabled: builds bare session, runs once, never refreshes', async () => {
    const d = deps({ enabled: false });
    await withYoutubeSession(async () => 'ok', d);
    expect(d.loadToken).not.toHaveBeenCalled();
    expect(d.refreshToken).not.toHaveBeenCalled();
    expect(d.buildInnertube).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @benkyou/core test youtube-session`
Expected: FAIL — cannot resolve `youtube-session.js`.

- [ ] **Step 3: Implement `youtube-session.ts`**

Create `packages/core/src/sources/youtube-session.ts`:

```typescript
import { Innertube } from 'youtubei.js';
import { env } from '../config/env';
import { INNERTUBE_OPTIONS, type RawSubtitleTrack } from './youtube';
import { TransientFetchError } from './types';
import { fetchAnonymousPoToken } from './potoken-client';
import { getPlatformCredential, upsertPlatformCredential } from './platform-credentials';

const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;

export interface SessionToken { poToken: string; visitorData: string; }

// Carries the partial track (duration/title, empty cues) so that when token refresh is
// exhausted the caller can still degrade WITH a known duration → Layer 2 (§4.2) can fire.
export class YoutubeTokenExpiryError extends Error {
  constructor(public partial: RawSubtitleTrack) {
    super('YouTube token expiry');
    this.name = 'YoutubeTokenExpiryError';
  }
}

export function isPotokenEnabled(): boolean {
  return Boolean(env.POTOKEN_PROVIDER_URL);
}

// Token-expiry "smell" (§0): get_transcript 400, withheld stream ("No valid URL to
// decipher"), or a 403. TransientFetchError is explicitly NOT expiry (network/5xx → retry).
export function isYoutubeTokenExpiryError(err: unknown): boolean {
  if (err instanceof YoutubeTokenExpiryError) return true;
  if (err instanceof TransientFetchError) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b40[03]\b/.test(msg) || /decipher/i.test(msg);
}

export interface SessionDeps {
  enabled: boolean;
  loadToken: () => Promise<SessionToken | null>;
  refreshToken: () => Promise<SessionToken>;
  buildInnertube: (tok: SessionToken | null) => Promise<Innertube>;
}

// ── production deps ────────────────────────────────────────────────────────
async function loadTokenFromCache(): Promise<SessionToken | null> {
  const row = await getPlatformCredential('youtube');
  if (!row?.secret) return null;
  const meta = row.meta as { visitorData?: string; fetchedAt?: number } | null;
  if (!meta?.visitorData || typeof meta.fetchedAt !== 'number') return null;
  if (Date.now() - meta.fetchedAt > TOKEN_TTL_MS) return null;
  return { poToken: row.secret, visitorData: meta.visitorData };
}

async function refreshTokenFromSidecar(): Promise<SessionToken> {
  const providerUrl = env.POTOKEN_PROVIDER_URL;
  if (!providerUrl) throw new TransientFetchError('POTOKEN_PROVIDER_URL unset during refresh');
  // A no-player Innertube yields visitor_data cheaply (design §2 step 1).
  const probe = await Innertube.create({ retrieve_player: false });
  const visitorData = probe.session.context.client.visitorData ?? '';
  const poToken = await fetchAnonymousPoToken(providerUrl, visitorData);
  await upsertPlatformCredential('youtube', { secret: poToken, meta: { visitorData, fetchedAt: Date.now() } });
  return { poToken, visitorData };
}

async function buildInnertubeWithToken(tok: SessionToken | null): Promise<Innertube> {
  if (!tok) return Innertube.create(INNERTUBE_OPTIONS);
  return Innertube.create({ ...INNERTUBE_OPTIONS, po_token: tok.poToken, visitor_data: tok.visitorData });
}

function productionDeps(): SessionDeps {
  return {
    enabled: isPotokenEnabled(),
    loadToken: loadTokenFromCache,
    refreshToken: refreshTokenFromSidecar,
    buildInnertube: buildInnertubeWithToken,
  };
}

export async function withYoutubeSession<T>(
  op: (yt: Innertube) => Promise<T>,
  deps: SessionDeps = productionDeps(),
): Promise<T> {
  if (!deps.enabled) {
    return op(await deps.buildInnertube(null));
  }
  let tok = await deps.loadToken();
  if (!tok) tok = await deps.refreshToken();
  try {
    return await op(await deps.buildInnertube(tok));
  } catch (err) {
    if (!isYoutubeTokenExpiryError(err)) throw err;
    const fresh = await deps.refreshToken();
    return op(await deps.buildInnertube(fresh)); // second expiry propagates
  }
}

// Task 8 consumes this. Resolves a FRESH ephemeral audio-only stream URL at download
// time (URLs expire in hours / are IP-bound → never stored as media_url, §4).
export async function resolveYoutubeAudioUrl(videoId: string): Promise<string> {
  return withYoutubeSession(async (yt) => {
    const info = await yt.getInfo(videoId);
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    const url = format.decipher(yt.session.player);
    if (!url) throw new YoutubeTokenExpiryError({ durationSeconds: null, title: null, cues: [] });
    return url;
  });
}
```

- [ ] **Step 4: Run the orchestration test, verify it passes**

Run: `pnpm --filter @benkyou/core test youtube-session`
Expected: PASS.

- [ ] **Step 5: Rewire `youtube.ts` to use the session, splitting `fetchOnce`**

In `packages/core/src/sources/youtube.ts`, replace the bare singleton (`let innertube`, `getInnertube`) and the `fetchYoutubeSubtitle` body. Keep `INNERTUBE_OPTIONS`, `createYoutubeAdapter`, `parseYoutubeVideoId`, `isDefinitiveYoutubeError`, `cuesToSegments`, `unavailable`, and all exported types unchanged.

Replace lines 122-189 (`let innertube` … `export const youtubeAdapter`) with:

```typescript
// One attempt against a given session. Returns a track (possibly empty cues = degrade).
// Throws TransientFetchError (network/5xx → retry) or YoutubeTokenExpiryError (→ withYoutubeSession
// refreshes once). A definitive content error degrades in place (empty cues + whatever
// duration/title we have) so Layer 2 (§4.2) can still fire on the known duration.
async function fetchOnce(yt: Innertube, videoId: string): Promise<RawSubtitleTrack> {
  let info;
  try {
    info = await yt.getInfo(videoId);
  } catch (err) {
    if (isDefinitiveYoutubeError(err)) return { durationSeconds: null, title: null, cues: [] };
    throw new TransientFetchError(err instanceof Error ? err.message : String(err));
  }

  const durationSeconds = info.basic_info.duration ?? null;
  const title = info.basic_info.title ?? null;

  if (info.playability_status?.status && info.playability_status.status !== 'OK') {
    console.warn(
      `[youtube] ${videoId} degraded: playability=${info.playability_status.status}` +
        ` reason=${JSON.stringify(info.playability_status.reason ?? null)}`,
    );
    return { durationSeconds, title, cues: [] };
  }

  let transcript;
  try {
    transcript = await info.getTranscript();
  } catch (err) {
    // Anti-bot hardening surfaces here (get_transcript 400 without a valid PoToken).
    // Signal expiry so withYoutubeSession can refresh once; carry duration/title so an
    // exhausted refresh still degrades WITH a duration (Layer 2 §4.2). Genuinely
    // caption-less videos throw a non-expiry error → degrade quietly here.
    if (isYoutubeTokenExpiryError(err)) {
      throw new YoutubeTokenExpiryError({ durationSeconds, title, cues: [] });
    }
    console.warn(
      `[youtube] ${videoId} degraded: getTranscript failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { durationSeconds, title, cues: [] };
  }

  const segments = transcript.transcript.content?.body?.initial_segments ?? [];
  const cues: RawCue[] = segments
    .map((seg) => {
      const text = seg.snippet.toString();
      const start = Number(seg.start_ms) / 1000;
      const end = Number(seg.end_ms) / 1000;
      return { start, end, text };
    })
    .filter((c) => c.text.trim().length > 0);

  return { durationSeconds, title, cues };
}

const fetchYoutubeSubtitle: FetchYoutubeSubtitle = async (videoId) => {
  try {
    return await withYoutubeSession((yt) => fetchOnce(yt, videoId));
  } catch (err) {
    if (err instanceof TransientFetchError) throw err; // adapter rethrows → pg-boss retries
    // Refresh exhausted (or unexpected): degrade, keeping any duration we resolved so
    // Layer 2 can still hand off on it (§4.2).
    if (err instanceof YoutubeTokenExpiryError) {
      console.warn(`[youtube] ${videoId} degraded: PoToken refresh exhausted`);
      return err.partial;
    }
    return { durationSeconds: null, title: null, cues: [] };
  }
};

export const youtubeAdapter: SourceAdapter = createYoutubeAdapter(fetchYoutubeSubtitle);
```

Update the imports at the top of `youtube.ts` (line 3 area) to add:

```typescript
import { withYoutubeSession, isYoutubeTokenExpiryError, YoutubeTokenExpiryError } from './youtube-session';
```

**Note the import cycle:** `youtube-session.ts` imports `INNERTUBE_OPTIONS` + `RawSubtitleTrack` from `youtube.ts`, and `youtube.ts` imports functions from `youtube-session.ts`. This is a value+type cycle that resolves fine because the cross-imports are only *referenced inside functions* (not at module top-level eval). Verify `pnpm --filter @benkyou/core build` (Task end) doesn't warn about it; if it does, move `INNERTUBE_OPTIONS` + the `RawSubtitleTrack`/`RawCue` interfaces into a tiny `youtube-types.ts` both import. Prefer the cycle if the build is clean.

- [ ] **Step 6: Run the existing youtube unit tests (regression — pure adapter unchanged)**

Run: `pnpm --filter @benkyou/core test sources/youtube.test`
Expected: PASS — `createYoutubeAdapter` and the pure transform are untouched; all existing cases still hold.

- [ ] **Step 7: Run the full session + youtube suite + typecheck**

Run: `pnpm --filter @benkyou/core test youtube && pnpm --filter @benkyou/core typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/sources/youtube-session.ts \
  packages/core/test/sources/youtube-session.test.ts \
  packages/core/src/sources/youtube.ts
git commit -m "feat(sources): youtube-session — PoToken lifecycle + refresh-once-on-expiry"
```

---

## Task 4: Bilibili SESSDATA injection into caption fetch

**Files:**
- Modify: `packages/core/src/sources/types.ts` (add `credentials` to `ExtractInput`)
- Modify: `packages/core/src/sources/bilibili.ts` (thread + attach cookie)
- Modify: `packages/core/src/pipeline/extract.ts` (read sessdata, pass credentials)
- Create: `packages/core/test/sources/bilibili-sessdata.test.ts`

**Interfaces:**
- Consumes (Task 2): `getBilibiliSessdata`.
- Produces: `ExtractInput.credentials?: { bilibiliSessdata?: string }`. `FetchBilibiliSubtitle` gains an optional second arg `{ sessdata?: string }`.

- [ ] **Step 1: Add `credentials` to `ExtractInput`**

In `packages/core/src/sources/types.ts`, inside `interface ExtractInput` (after `reader?`):

```typescript
  // Per-platform scrape credentials, threaded from platform_credentials by the extract
  // dispatcher (design §3). Bilibili: SESSDATA cookie. YouTube manages its own token
  // cache in youtube-session and needs nothing here.
  credentials?: { bilibiliSessdata?: string };
```

- [ ] **Step 2: Write the failing test for SESSDATA attachment**

Create `packages/core/test/sources/bilibili-sessdata.test.ts`:

```typescript
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createBilibiliAdapter } from '../../src/sources/bilibili.js';

afterEach(() => vi.restoreAllMocks());

describe('bilibili SESSDATA injection', () => {
  test('fetcher receives sessdata from input.credentials', async () => {
    let seen: string | undefined;
    const adapter = createBilibiliAdapter(async (_bvid, opts) => {
      seen = opts?.sessdata;
      return { durationSeconds: 10, title: 't', cues: [{ start: 0, end: 1, text: 'a' }] };
    });
    await adapter.extract({
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      rawContent: null,
      externalId: null,
      credentials: { bilibiliSessdata: 'SD-XYZ' },
    });
    expect(seen).toBe('SD-XYZ');
  });

  test('no credentials → fetcher gets undefined sessdata (anonymous, still degrades cleanly)', async () => {
    let seen: string | undefined = 'unset';
    const adapter = createBilibiliAdapter(async (_bvid, opts) => {
      seen = opts?.sessdata;
      return { durationSeconds: 10, title: 't', cues: [] };
    });
    const r = await adapter.extract({
      url: 'https://www.bilibili.com/video/BV1xx411c7mD', rawContent: null, externalId: null,
    });
    expect(seen).toBeUndefined();
    expect(r.transcriptStatus).toBe('unavailable');
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `pnpm --filter @benkyou/core test bilibili-sessdata`
Expected: FAIL — `createBilibiliAdapter`'s fetcher signature has no `opts`.

- [ ] **Step 4: Thread sessdata through `bilibili.ts`**

In `packages/core/src/sources/bilibili.ts`:

Change the fetcher type (line ~24):

```typescript
export type FetchBilibiliSubtitle = (bvid: string, opts?: { sessdata?: string }) => Promise<RawSubtitleTrack | null>;
```

In `createBilibiliAdapter`'s `extract`, pass the credential through (line ~48):

```typescript
        track = await fetchSubtitle(bvid, { sessdata: input.credentials?.bilibiliSessdata });
```

Make `biliJson` accept an optional cookie and attach SESSDATA. Replace `biliJson` (lines ~90-102) and `getMixinKey` / `fetchBilibiliSubtitle` call sites to thread `sessdata`:

```typescript
async function biliJson<T>(url: string, sessdata?: string): Promise<T> {
  const headers: Record<string, string> = { ...BILI_HEADERS };
  if (sessdata) headers.cookie = `SESSDATA=${sessdata}`;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    throw new TransientFetchError(`bilibili network: ${err instanceof Error ? err.message : String(err)}`);
  }
  const disposition = biliStatusDisposition(res.status);
  if (disposition === 'transient') throw new TransientFetchError(`bilibili ${res.status}`);
  if (disposition === 'miss') throw new Error(`bilibili ${res.status}`);
  return (await res.json()) as T;
}

async function getMixinKey(sessdata?: string): Promise<string> {
  const nav = await biliJson<{ data?: { wbi_img?: { img_url?: string; sub_url?: string } } }>(
    'https://api.bilibili.com/x/web-interface/nav', sessdata,
  );
  const pick = (u?: string): string => (u ? (u.split('/').pop() ?? '').split('.')[0] ?? '' : '');
  const imgKey = pick(nav.data?.wbi_img?.img_url);
  const subKey = pick(nav.data?.wbi_img?.sub_url);
  if (!imgKey || !subKey) throw new TransientFetchError('bilibili nav: wbi keys missing');
  return mixinKey(imgKey + subKey);
}
```

Update `fetchBilibiliSubtitle` to take `opts` and thread `sessdata` into every `biliJson`/`getMixinKey` call (the `view`, `getMixinKey`, `player`, and subtitle-JSON fetches):

```typescript
const fetchBilibiliSubtitle: FetchBilibiliSubtitle = async (bvid, opts) => {
  const sessdata = opts?.sessdata;
  const view = await biliJson<{ data?: { cid?: number; duration?: number; title?: string } }>(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, sessdata,
  );
  const cid = view.data?.cid;
  const durationSeconds = view.data?.duration ?? null;
  const title = view.data?.title ?? null;
  if (!cid) return null;

  const mk = await getMixinKey(sessdata);
  const signed = encodeWbi({ bvid, cid }, mk, Math.floor(Date.now() / 1000));
  const qs = new URLSearchParams(signed).toString();
  const player = await biliJson<{ data?: { subtitle?: { subtitles?: Array<{ subtitle_url?: string }> } } }>(
    `https://api.bilibili.com/x/player/wbi/v2?${qs}`, sessdata,
  );

  const first = player.data?.subtitle?.subtitles?.[0]?.subtitle_url;
  if (!first) {
    // Distinguish logged-out from genuinely caption-less (design §5 lightweight reason).
    console.warn(`[bilibili] ${bvid} no subtitles${sessdata ? '' : ' (anonymous — try SESSDATA)'}`);
    return { durationSeconds, title, cues: [] };
  }
  const url = first.startsWith('//') ? `https:${first}` : first;
  const sub = await biliJson<{ body?: Array<{ from?: number; to?: number; content?: string }> }>(url, sessdata);
  const cues: RawCue[] = (sub.body ?? [])
    .map((c) => ({ start: c.from ?? 0, end: c.to ?? 0, text: c.content ?? '' }))
    .filter((c) => c.text.trim().length > 0);
  return { durationSeconds, title, cues };
};
```

(`RawCue` is already imported from `./youtube` at the top of `bilibili.ts`.)

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @benkyou/core test bilibili-sessdata`
Expected: PASS (2 tests). Also run `pnpm --filter @benkyou/core test bilibili` — existing bili tests still pass (anonymous path is `sessdata=undefined`).

- [ ] **Step 6: Read credentials in `extractItem` and pass them**

In `packages/core/src/pipeline/extract.ts`, add the import:

```typescript
import { getBilibiliSessdata } from '../sources/platform-credentials';
```

In `extractItem`, after building `reader` (line ~117) and before `resolveAdapter`, fetch the sessdata and pass it into `adapter.extract`:

```typescript
  const adapter = resolveAdapter({ type, url: item.url });
  const bilibiliSessdata = (await getBilibiliSessdata()) ?? undefined;
  const result = await adapter.extract({
    url: item.url,
    rawContent: item.rawContent,
    externalId: item.externalId,
    config,
    reader,
    credentials: { bilibiliSessdata },
  });
```

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @benkyou/core typecheck && pnpm --filter @benkyou/core test bilibili`
Expected: PASS.

```bash
git add packages/core/src/sources/types.ts packages/core/src/sources/bilibili.ts \
  packages/core/src/pipeline/extract.ts \
  packages/core/test/sources/bilibili-sessdata.test.ts
git commit -m "feat(sources): inject Bilibili SESSDATA into caption fetch"
```

---

## Task 5: Bilibili QR login state machine (core)

**Files:**
- Create: `packages/core/src/sources/bilibili-qr.ts`
- Create: `packages/core/test/sources/bilibili-qr.test.ts`

**Interfaces:**
- Consumes (Task 2): `upsertPlatformCredential`.
- Produces:
  ```typescript
  interface QrGenerate { qrcodeKey: string; url: string; }
  type QrPollStatus = 'pending' | 'scanned' | 'success' | 'expired';
  interface QrPollResult { status: QrPollStatus; }
  generateBilibiliQr(): Promise<QrGenerate>;
  pollBilibiliQr(qrcodeKey: string): Promise<QrPollResult>; // on success: parses Set-Cookie → persists SESSDATA + expiry meta
  // pure helpers (exported for tests):
  mapQrPollCode(code: number): QrPollStatus;
  parseSessdataFromSetCookie(setCookie: string[]): { sessdata: string | null; expiresAt: number | null };
  ```

**Bilibili QR endpoints (verified):**
- Generate: `GET https://passport.bilibili.com/x/passport-login/web/qrcode/generate` → `{ data: { url, qrcode_key } }`.
- Poll: `GET https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=KEY` → `{ data: { code, ... } }`. Codes: `0`=success (Set-Cookie carries `SESSDATA`), `86101`=not scanned, `86090`=scanned/unconfirmed, `86038`=expired.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/sources/bilibili-qr.test.ts`:

```typescript
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  mapQrPollCode,
  parseSessdataFromSetCookie,
  generateBilibiliQr,
  pollBilibiliQr,
} from '../../src/sources/bilibili-qr.js';

vi.mock('../../src/sources/platform-credentials.js', () => ({
  upsertPlatformCredential: vi.fn(async () => {}),
}));
import { upsertPlatformCredential } from '../../src/sources/platform-credentials.js';

afterEach(() => vi.restoreAllMocks());

describe('mapQrPollCode', () => {
  test.each([
    [0, 'success'],
    [86101, 'pending'],
    [86090, 'scanned'],
    [86038, 'expired'],
    [99999, 'pending'],
  ] as const)('%i → %s', (code, status) => {
    expect(mapQrPollCode(code)).toBe(status);
  });
});

describe('parseSessdataFromSetCookie', () => {
  test('extracts SESSDATA value + Expires epoch', () => {
    const r = parseSessdataFromSetCookie([
      'SESSDATA=abc%2Cdef; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly',
      'bili_jct=xyz; Path=/',
    ]);
    expect(r.sessdata).toBe('abc%2Cdef');
    expect(r.expiresAt).toBe(Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'));
  });
  test('null when SESSDATA absent', () => {
    expect(parseSessdataFromSetCookie(['bili_jct=xyz'])).toEqual({ sessdata: null, expiresAt: null });
  });
});

describe('generateBilibiliQr', () => {
  test('returns qrcodeKey + url from the generate endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { url: 'https://qr', qrcode_key: 'KEY1' } }), { status: 200 }),
    );
    expect(await generateBilibiliQr()).toEqual({ qrcodeKey: 'KEY1', url: 'https://qr' });
  });
});

describe('pollBilibiliQr', () => {
  test('success: persists SESSDATA from Set-Cookie + expiry meta', async () => {
    const headers = new Headers();
    headers.append('set-cookie', 'SESSDATA=SD123; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { code: 0 } }), { status: 200, headers }),
    );
    const r = await pollBilibiliQr('KEY1');
    expect(r.status).toBe('success');
    expect(upsertPlatformCredential).toHaveBeenCalledWith('bilibili', {
      secret: 'SD123',
      meta: { expiresAt: Date.parse('Wed, 21 Oct 2026 07:28:00 GMT') },
    });
  });

  test('pending: does not persist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { code: 86101 } }), { status: 200 }),
    );
    expect((await pollBilibiliQr('KEY1')).status).toBe('pending');
    expect(upsertPlatformCredential).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @benkyou/core test bilibili-qr`
Expected: FAIL — cannot resolve `bilibili-qr.js`.

- [ ] **Step 3: Implement `bilibili-qr.ts`**

Create `packages/core/src/sources/bilibili-qr.ts`:

```typescript
import { upsertPlatformCredential } from './platform-credentials';

const GENERATE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const POLL_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
const HEADERS = { 'user-agent': 'benkyou/0.1 (+https://github.com/benkyou)', referer: 'https://www.bilibili.com/' };

export interface QrGenerate { qrcodeKey: string; url: string; }
export type QrPollStatus = 'pending' | 'scanned' | 'success' | 'expired';
export interface QrPollResult { status: QrPollStatus; }

export function mapQrPollCode(code: number): QrPollStatus {
  switch (code) {
    case 0: return 'success';
    case 86090: return 'scanned';
    case 86038: return 'expired';
    default: return 'pending'; // 86101 not-scanned + any unknown transient code
  }
}

export function parseSessdataFromSetCookie(setCookie: string[]): { sessdata: string | null; expiresAt: number | null } {
  for (const c of setCookie) {
    const m = /(?:^|;\s*)SESSDATA=([^;]+)/.exec(c);
    if (!m) continue;
    const exp = /Expires=([^;]+)/i.exec(c);
    const expiresAt = exp ? Date.parse(exp[1]!) : NaN;
    return { sessdata: m[1] ?? null, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
  }
  return { sessdata: null, expiresAt: null };
}

export async function generateBilibiliQr(): Promise<QrGenerate> {
  const res = await fetch(GENERATE_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`bilibili qr generate failed: ${res.status}`);
  const json = (await res.json()) as { data?: { url?: string; qrcode_key?: string } };
  const url = json.data?.url;
  const qrcodeKey = json.data?.qrcode_key;
  if (!url || !qrcodeKey) throw new Error('bilibili qr generate: missing url/qrcode_key');
  return { qrcodeKey, url };
}

export async function pollBilibiliQr(qrcodeKey: string): Promise<QrPollResult> {
  const res = await fetch(`${POLL_URL}?qrcode_key=${encodeURIComponent(qrcodeKey)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`bilibili qr poll failed: ${res.status}`);
  const json = (await res.json()) as { data?: { code?: number } };
  const status = mapQrPollCode(json.data?.code ?? -1);
  if (status === 'success') {
    // undici exposes split cookies via getSetCookie(); fall back to a single header.
    const setCookie = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
    const { sessdata, expiresAt } = parseSessdataFromSetCookie(setCookie);
    if (!sessdata) throw new Error('bilibili qr success but no SESSDATA in Set-Cookie');
    await upsertPlatformCredential('bilibili', { secret: sessdata, meta: { expiresAt } });
  }
  return { status };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @benkyou/core test bilibili-qr`
Expected: PASS.

- [ ] **Step 5: Export from the sources barrel**

In `packages/core/src/sources/index.ts`, add re-exports so the web app imports from `@benkyou/core/sources`:

```typescript
export { generateBilibiliQr, pollBilibiliQr } from './bilibili-qr';
export type { QrGenerate, QrPollStatus, QrPollResult } from './bilibili-qr';
export { getPlatformCredential, getBilibiliSessdata } from './platform-credentials';
export type { Platform, PlatformCredentialRow } from './platform-credentials';
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sources/bilibili-qr.ts \
  packages/core/test/sources/bilibili-qr.test.ts \
  packages/core/src/sources/index.ts
git commit -m "feat(sources): Bilibili QR login state machine"
```

---

## Task 6: Bilibili QR web API routes + credentials settings UI

**Files:**
- Add dep: `qrcode` + `@types/qrcode` to `apps/web/package.json`
- Create: `apps/web/app/api/credentials/bilibili/qr/generate/route.ts`
- Create: `apps/web/app/api/credentials/bilibili/qr/poll/route.ts`
- Create: `apps/web/app/(authed)/settings/sections/CredentialsSection.tsx`
- Create: `packages/core/src/sources/credential-status.ts` + test (status derivation, pure)
- Modify: `apps/web/app/(authed)/settings/page.tsx` (render the section)
- Modify: `apps/web/messages/{zh,en}.json`
- Export `getCredentialStatus` from `packages/core/src/sources/index.ts`

**Interfaces:**
- Consumes (Task 5): `generateBilibiliQr`, `pollBilibiliQr`. (Task 2): `getPlatformCredential`. (Task 1): `pingPotokenSidecar`, `env.POTOKEN_PROVIDER_URL`.
- Produces:
  ```typescript
  interface CredentialStatus {
    bilibili: 'valid' | 'expired' | 'unset';
    youtube: 'off' | 'auto';
  }
  deriveBilibiliStatus(row: { secret: string | null; meta: Record<string, unknown> | null } | null, now: number): 'valid' | 'expired' | 'unset';
  getCredentialStatus(): Promise<CredentialStatus>;
  ```

- [ ] **Step 1: Add `qrcode` dependency**

Add to `apps/web/package.json` `dependencies`: `"qrcode": "^1.5.4"` and `devDependencies`: `"@types/qrcode": "^1.5.5"`. Then:

```bash
pnpm install
```
Expected: lockfile updates, install succeeds. (Library, not a service — self-host-friendly, renders the Bili QR `url` to a data-URL server-side so the client ships no QR code.)

- [ ] **Step 2: Write the failing test for status derivation**

Create `packages/core/test/sources/credential-status.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { deriveBilibiliStatus } from '../../src/sources/credential-status.js';

const NOW = Date.parse('2026-06-22T00:00:00Z');

describe('deriveBilibiliStatus', () => {
  test('no row → unset', () => {
    expect(deriveBilibiliStatus(null, NOW)).toBe('unset');
  });
  test('secret present, no expiry → valid', () => {
    expect(deriveBilibiliStatus({ secret: 'SD', meta: null }, NOW)).toBe('valid');
  });
  test('secret present, expiry in future → valid', () => {
    expect(deriveBilibiliStatus({ secret: 'SD', meta: { expiresAt: NOW + 1000 } }, NOW)).toBe('valid');
  });
  test('secret present, expiry in past → expired', () => {
    expect(deriveBilibiliStatus({ secret: 'SD', meta: { expiresAt: NOW - 1000 } }, NOW)).toBe('expired');
  });
  test('null secret → unset', () => {
    expect(deriveBilibiliStatus({ secret: null, meta: { expiresAt: NOW + 1000 } }, NOW)).toBe('unset');
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `pnpm --filter @benkyou/core test credential-status`
Expected: FAIL — cannot resolve `credential-status.js`.

- [ ] **Step 4: Implement `credential-status.ts`**

Create `packages/core/src/sources/credential-status.ts`:

```typescript
import { env } from '../config/env';
import { getPlatformCredential, type PlatformCredentialRow } from './platform-credentials';

export interface CredentialStatus {
  bilibili: 'valid' | 'expired' | 'unset';
  youtube: 'off' | 'auto';
}

export function deriveBilibiliStatus(
  row: Pick<PlatformCredentialRow, 'secret' | 'meta'> | null,
  now: number,
): 'valid' | 'expired' | 'unset' {
  if (!row?.secret) return 'unset';
  const expiresAt = (row.meta as { expiresAt?: number } | null)?.expiresAt;
  if (typeof expiresAt === 'number' && expiresAt <= now) return 'expired';
  return 'valid';
}

export async function getCredentialStatus(): Promise<CredentialStatus> {
  const bili = await getPlatformCredential('bilibili');
  return {
    bilibili: deriveBilibiliStatus(bili, Date.now()),
    // YouTube auto-refreshes; "off" only when the capability is disabled. Persistent
    // sidecar failure is surfaced separately in the health panel (Task 9), not here.
    youtube: env.POTOKEN_PROVIDER_URL ? 'auto' : 'off',
  };
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @benkyou/core test credential-status`
Expected: PASS. Add `export { getCredentialStatus, deriveBilibiliStatus } from './credential-status';` and `export type { CredentialStatus } from './credential-status';` to `packages/core/src/sources/index.ts`.

- [ ] **Step 6: Implement the QR generate route**

Create `apps/web/app/api/credentials/bilibili/qr/generate/route.ts`:

```typescript
import QRCode from 'qrcode';
import { generateBilibiliQr } from '@benkyou/core/sources';
import { requireApiAuth } from '@/lib/auth';

export async function POST(): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { qrcodeKey, url } = await generateBilibiliQr();
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  return Response.json({ qrcodeKey, qrDataUrl });
}
```

- [ ] **Step 7: Implement the QR poll route**

Create `apps/web/app/api/credentials/bilibili/qr/poll/route.ts`:

```typescript
import { z } from 'zod';
import { pollBilibiliQr } from '@benkyou/core/sources';
import { requireApiAuth } from '@/lib/auth';

const schema = z.object({ key: z.string().min(1) });

export async function GET(req: Request): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const parsed = schema.safeParse({ key: new URL(req.url).searchParams.get('key') });
  if (!parsed.success) return Response.json({ error: 'missing key' }, { status: 400 });
  const result = await pollBilibiliQr(parsed.data.key); // persists SESSDATA on success
  return Response.json(result);
}
```

- [ ] **Step 8: Build the `CredentialsSection` client component**

Create `apps/web/app/(authed)/settings/sections/CredentialsSection.tsx`. Logic-layer hook + dumb view per the CR boundary (CLAUDE.md). Uses only existing token classes (`field`, `text-*`, `bg-accent-vivid`) — no invented values.

```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CredentialStatus } from '@benkyou/core/sources';

type QrState =
  | { phase: 'idle' }
  | { phase: 'active'; qrDataUrl: string; status: 'pending' | 'scanned' }
  | { phase: 'success' }
  | { phase: 'expired' }
  | { phase: 'error'; message: string };

function useBilibiliQr() {
  const [state, setState] = useState<QrState>({ phase: 'idle' });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = useCallback(() => { if (timer.current) clearInterval(timer.current); timer.current = null; }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    stop();
    try {
      const res = await fetch('/api/credentials/bilibili/qr/generate', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const { qrcodeKey, qrDataUrl } = (await res.json()) as { qrcodeKey: string; qrDataUrl: string };
      setState({ phase: 'active', qrDataUrl, status: 'pending' });
      timer.current = setInterval(async () => {
        const p = await fetch(`/api/credentials/bilibili/qr/poll?key=${encodeURIComponent(qrcodeKey)}`);
        const { status } = (await p.json()) as { status: 'pending' | 'scanned' | 'success' | 'expired' };
        if (status === 'success') { stop(); setState({ phase: 'success' }); }
        else if (status === 'expired') { stop(); setState({ phase: 'expired' }); }
        else setState((s) => (s.phase === 'active' ? { ...s, status } : s));
      }, 2000);
    } catch (e) {
      stop();
      setState({ phase: 'error', message: e instanceof Error ? e.message : 'error' });
    }
  }, [stop]);

  return { state, start };
}

const STATUS_CLASS: Record<string, string> = {
  valid: 'text-accent', expired: 'text-err', unset: 'text-muted', auto: 'text-accent', off: 'text-muted',
};

export function CredentialsSection({ status }: { status: CredentialStatus }) {
  const t = useTranslations('credentials');
  const { state, start } = useBilibiliQr();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink">{t('youtubeLabel')}</span>
        <span className={STATUS_CLASS[status.youtube]}>{t(`youtube.${status.youtube}` as 'youtube.auto')}</span>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-ink">{t('bilibiliLabel')}</span>
          <span className={STATUS_CLASS[status.bilibili]}>{t(`bilibili.${status.bilibili}` as 'bilibili.valid')}</span>
          <button type="button" onClick={start} className="rounded-md bg-accent-vivid px-3 py-1 text-bg">
            {t('scanButton')}
          </button>
        </div>
        {state.phase === 'active' ? (
          <div className="flex flex-col gap-1">
            {/* qrDataUrl is a self-generated data: URI (server-side qrcode), not remote */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.qrDataUrl} alt={t('qrAlt')} width={220} height={220} />
            <span className="text-muted">{t(`qr.${state.status}` as 'qr.pending')}</span>
          </div>
        ) : null}
        {state.phase === 'success' ? <span className="text-accent">{t('qr.success')}</span> : null}
        {state.phase === 'expired' ? <span className="text-err">{t('qr.expired')}</span> : null}
        {state.phase === 'error' ? <span className="text-err">{t('qr.error', { message: state.message })}</span> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Render the section on the settings page**

In `apps/web/app/(authed)/settings/page.tsx`, import `getCredentialStatus` and the section, fetch status, and add a `Section`:

```typescript
import { getCredentialStatus } from '@benkyou/core/sources';
import { CredentialsSection } from './sections/CredentialsSection';
```

In `SettingsPage`, after `const settings = await getUserSettings();`:

```typescript
  const credentialStatus = await getCredentialStatus();
```

Add a section (after the AI section):

```tsx
      <Section title={t('credentialsSection')}>
        <CredentialsSection status={credentialStatus} />
      </Section>
```

- [ ] **Step 10: Add i18n keys (zh + en)**

In `apps/web/messages/en.json`, add `settings.credentialsSection: "Scrape credentials"` and a `credentials` block:

```json
"credentials": {
  "youtubeLabel": "YouTube PoToken",
  "youtube": { "auto": "Auto (sidecar)", "off": "Off (no provider configured)" },
  "bilibiliLabel": "Bilibili SESSDATA",
  "bilibili": { "valid": "Valid", "expired": "Expired — re-scan", "unset": "Not set" },
  "scanButton": "Scan QR to log in",
  "qrAlt": "Bilibili login QR code",
  "qr": { "pending": "Waiting for scan…", "scanned": "Scanned — confirm in the app", "success": "Logged in", "expired": "QR expired — try again", "error": "Failed: {message}" }
}
```

Mirror into `apps/web/messages/zh.json` with translations:

```json
"credentials": {
  "youtubeLabel": "YouTube PoToken",
  "youtube": { "auto": "自动(sidecar)", "off": "未启用(未配置 provider)" },
  "bilibiliLabel": "Bilibili SESSDATA",
  "bilibili": { "valid": "有效", "expired": "已过期 — 请重新扫码", "unset": "未设置" },
  "scanButton": "扫码登录",
  "qrAlt": "Bilibili 登录二维码",
  "qr": { "pending": "等待扫码…", "scanned": "已扫码 — 请在 App 中确认", "success": "已登录", "expired": "二维码已过期 — 请重试", "error": "失败:{message}" }
}
```

Also add `"credentialsSection": "抓取凭据"` under `settings` in `zh.json`.

- [ ] **Step 11: Verify i18n + build**

Run: `pnpm check:i18n && pnpm --filter @benkyou/web build`
Expected: PASS — no missing keys; build succeeds (catches any client/server boundary issue with the new section).

- [ ] **Step 12: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml \
  apps/web/app/api/credentials packages/core/src/sources/credential-status.ts \
  packages/core/test/sources/credential-status.test.ts packages/core/src/sources/index.ts \
  apps/web/app/\(authed\)/settings \
  apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "feat(web): Bilibili QR login UI + credential status on settings"
```

---

## Task 7: YouTube → Whisper Layer-2 handoff (post-adapter branch)

**Files:**
- Modify: `packages/core/src/pipeline/extract.ts` (extract `applyTranscribePolicy`, add `isYoutubeWhisperHandoff`, post-adapter branch)
- Create: `packages/core/test/pipeline/youtube-whisper-handoff.test.ts` (pure predicate)
- Create: `packages/core/test/pipeline/extract-youtube-handoff.int.test.ts` (routing)

**Interfaces:**
- Consumes (Task 3): `isPotokenEnabled`. Existing: `transcribePolicy`, `enqueueTranscribe`, `setTranscriptStatus`, `parseYoutubeVideoId`.
- Produces:
  ```typescript
  isYoutubeWhisperHandoff(item: { contentType: string; transcriptStatus: string; url: string; videoDuration: number | null }, potokenEnabled: boolean): boolean;
  applyTranscribePolicy(item: { id: string; sourceId: string | null }, durationSec: number): Promise<StageOutcome>;
  ```

- [ ] **Step 1: Write the failing predicate test**

Create `packages/core/test/pipeline/youtube-whisper-handoff.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { isYoutubeWhisperHandoff } from '../../src/pipeline/extract.js';

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const base = { contentType: 'video', transcriptStatus: 'unavailable', url: YT, videoDuration: 600 };

describe('isYoutubeWhisperHandoff', () => {
  test('video + unavailable + youtube + potoken-on + duration → true', () => {
    expect(isYoutubeWhisperHandoff(base, true)).toBe(true);
  });
  test('potoken off → false', () => {
    expect(isYoutubeWhisperHandoff(base, false)).toBe(false);
  });
  test('null duration → false (the ffprobe-watch-URL footgun guard, §4.2)', () => {
    expect(isYoutubeWhisperHandoff({ ...base, videoDuration: null }, true)).toBe(false);
  });
  test('transcript present → false', () => {
    expect(isYoutubeWhisperHandoff({ ...base, transcriptStatus: 'present' }, true)).toBe(false);
  });
  test('non-youtube url → false (Bilibili excluded from Layer 2)', () => {
    expect(isYoutubeWhisperHandoff({ ...base, url: 'https://www.bilibili.com/video/BV1xx411c7mD' }, true)).toBe(false);
  });
  test('non-video content type → false', () => {
    expect(isYoutubeWhisperHandoff({ ...base, contentType: 'article' }, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @benkyou/core test youtube-whisper-handoff`
Expected: FAIL — `isYoutubeWhisperHandoff` not exported.

- [ ] **Step 3: Refactor `runMediaHandoff` + add predicate & branch in `extract.ts`**

In `packages/core/src/pipeline/extract.ts`:

Add imports:

```typescript
import { parseYoutubeVideoId } from '../sources/youtube';
import { isPotokenEnabled } from '../sources/youtube-session';
```

Extract the policy-application tail of `runMediaHandoff` into a reusable function (so the YouTube handoff reuses it with the duration pre-resolved, per §4.2). Replace lines ~23-60 (`runMediaHandoff`) with:

```typescript
// Decision tail shared by the pre-adapter media handoff (duration probed) and the
// post-adapter YouTube→Whisper handoff (duration already known from getInfo, §4.2).
export async function applyTranscribePolicy(
  item: { id: string; sourceId: string | null },
  durationSec: number,
): Promise<StageOutcome> {
  const settings = await getUserSettings();
  const decision = transcribePolicy({
    durationSec, isAdhoc: item.sourceId == null,
    deployMode: env.DEPLOY_MODE === 'serverless' ? 'serverless' : 'docker',
    autoLimit: settings?.videoAutoLimit ?? 1800,
    manualLimit: settings?.videoManualLimit ?? 10800,
  });
  if (decision.kind === 'skip') {
    await setTranscriptStatus(item.id, decision.status);
    return { advance: true };
  }
  if (decision.kind === 'confirm') {
    await setTranscriptStatus(item.id, 'needs_confirmation'); // parks; orphan check excludes it
    return { advance: false };
  }
  await setTranscriptStatus(item.id, 'pending');
  const boss = await getBoss();
  await enqueueTranscribe(boss, item.id, { durationSec });
  return { advance: false }; // transcribe owns the next advance
}

async function runMediaHandoff(item: {
  id: string; url: string; mediaUrl: string | null; videoDuration: number | null; sourceId: string | null;
}): Promise<StageOutcome> {
  const source = item.mediaUrl ?? item.url;
  let durationSec = item.videoDuration;
  if (durationSec == null) {
    const probed = await probeRemoteDurationSec(source); // throws transient → extract retry consumes attempts
    if (probed == null) {                                // resolved but not media → degrade + continue
      await setTranscriptStatus(item.id, 'unavailable');
      return { advance: true };
    }
    durationSec = probed;
    await getDbClient().update(items).set({ videoDuration: durationSec }).where(eq(items.id, item.id));
  }
  return applyTranscribePolicy(item, durationSec);
}

// Post-adapter Layer-2 seam (§4.2). The video_duration != null guard is LOAD-BEARING:
// it keeps a no-duration result degrading to 'unavailable' (never ffprobing the watch
// page HTML). Bilibili is excluded — parseYoutubeVideoId returns null for it.
export function isYoutubeWhisperHandoff(
  item: { contentType: string; transcriptStatus: string; url: string; videoDuration: number | null },
  potokenEnabled: boolean,
): boolean {
  return item.contentType === 'video'
    && item.transcriptStatus === 'unavailable'
    && potokenEnabled
    && item.videoDuration != null
    && parseYoutubeVideoId(item.url) != null;
}
```

Now wire the post-adapter branch into `extractItem`. After the `db.update(items).set(extractColumns(...))` call (currently the last statement, lines ~128-131), append:

```typescript
  if (isYoutubeWhisperHandoff(
    {
      contentType: result.contentType,
      transcriptStatus: result.transcriptStatus ?? 'na',
      url: item.url,
      videoDuration: result.videoDuration ?? null,
    },
    isPotokenEnabled(),
  )) {
    // Overwrite the just-written 'unavailable' with pending/needs_confirmation/skipped_*.
    return applyTranscribePolicy({ id: itemId, sourceId: item.sourceId }, result.videoDuration!);
  }
```

(`extractItem`'s return type is already `Promise<StageOutcome | void>`.)

- [ ] **Step 4: Run the predicate test, verify it passes**

Run: `pnpm --filter @benkyou/core test youtube-whisper-handoff`
Expected: PASS (6 tests). Also rerun `pnpm --filter @benkyou/core test extract-media` — the pre-adapter handoff still routes correctly after the refactor.

- [ ] **Step 5: Write the routing integration test**

Create `packages/core/test/pipeline/extract-youtube-handoff.int.test.ts`. Mocks the youtube adapter's fetcher (so no network) and asserts the post-adapter branch enqueues `transcribe` for a known-duration `unavailable` YouTube item, and does NOT for a `null`-duration one.

```typescript
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { createMigratedTestDatabase, type TestDatabase } from '../db-harness/helpers';
import postgres from 'postgres';

// PoToken capability ON for these tests.
vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://sidecar:4416');

// Replace the youtube adapter with a fetcher we control (no network, no real session).
vi.mock('../../src/sources/youtube-session.js', async (orig) => ({
  ...(await orig<typeof import('../../src/sources/youtube-session.js')>()),
  // isPotokenEnabled reads env at call time; keep the real impl (stubbed env → true).
}));

describe('extract → YouTube Whisper handoff', () => {
  let db: TestDatabase; let sql: postgres.Sql;
  let extractItem: (id: string) => Promise<unknown>;
  let closeDbClient: () => Promise<void>; let closeBoss: () => Promise<void>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase('pipeline/extract-youtube-handoff.int.test'); sql = db.sql;
    await sql`INSERT INTO user_settings (id,password_hash,embed_dim,video_auto_limit,video_manual_limit)
      VALUES (1,'x',1536,1800,10800)`;
    const q = await import('../../src/queue/index.js');
    closeBoss = q.closeBoss;
    await q.registerQueues(await q.getBoss());
    // Stub the registered youtube adapter's extract to return a blocked-but-known-duration result.
    const reg = await import('../../src/sources/registry.js');
    const adapter = reg.getAdapter('youtube');
    vi.spyOn(adapter, 'extract').mockImplementation(async () => ({
      rawContent: null, title: 'Blocked', contentType: 'video',
      transcriptStatus: 'unavailable', transcriptSegments: null, videoDuration: 600,
    }));
    ({ extractItem } = await import('../../src/pipeline/extract.js'));
    ({ closeDbClient } = await import('../../src/db/client.js'));
  }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await closeBoss?.(); await closeDbClient?.(); await db?.cleanup(); });

  async function seedYoutube(): Promise<string> {
    const url = `https://www.youtube.com/watch?v=dQw4w9WgXcQ`;
    const r = await sql<{ id: string }[]>`
      INSERT INTO items (url,url_hash,title,content_type,state,current_stage,transcript_status)
      VALUES (${url}, gen_random_uuid()::text, ${url}, 'video','pending','extract','na')
      RETURNING id`;
    return r[0]!.id;
  }

  test('known-duration unavailable YouTube → transcript_status pending + transcribe enqueued', async () => {
    const id = await seedYoutube();
    const outcome = await extractItem(id);
    expect(outcome).toEqual({ advance: false }); // handed off
    const r = await sql<{ transcript_status: string }[]>`SELECT transcript_status FROM items WHERE id=${id}`;
    expect(r[0]!.transcript_status).toBe('pending'); // 600s < autoLimit 1800 → transcribe
    const jobs = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pgboss.job WHERE name='transcribe' AND data->>'itemId'=${id}`;
    expect(jobs[0]!.n).toBe(1);
  });
});
```

Then add a second test in the same file for the `null`-duration guard (override the spy to return `videoDuration: null` for one item and assert `transcript_status='unavailable'` + no `transcribe` job). Reuse the spy via `mockImplementationOnce`.

- [ ] **Step 6: Run the integration test, verify it passes**

Run: `pnpm --filter @benkyou/core test extract-youtube-handoff`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pipeline/extract.ts \
  packages/core/test/pipeline/youtube-whisper-handoff.test.ts \
  packages/core/test/pipeline/extract-youtube-handoff.int.test.ts
git commit -m "feat(pipeline): post-adapter YouTube→Whisper Layer-2 handoff"
```

---

## Task 8: Download-stage YouTube audio resolver + SSRF verification

**Files:**
- Modify: `packages/core/src/pipeline/transcribe.ts` (resolve fresh YouTube audio URL before download)
- Create: `packages/core/test/pipeline/transcribe-youtube-resolve.test.ts`
- Modify: `packages/core/test/pipeline/media-probe.test.ts` (add googlevideo-host SSRF pass assertion)

**Interfaces:**
- Consumes (Task 3): `resolveYoutubeAudioUrl`. Existing: `parseYoutubeVideoId`, `downloadToTmp`, `assertSafeHttpUrl`.

- [ ] **Step 1: Write the failing test for source resolution**

Create `packages/core/test/pipeline/transcribe-youtube-resolve.test.ts`. Extract the resolution decision into a pure helper so it's unit-testable without ffmpeg/network.

```typescript
import { describe, expect, test, vi } from 'vitest';
import { resolveDownloadSource } from '../../src/pipeline/transcribe.js';

describe('resolveDownloadSource', () => {
  test('mediaUrl present → use it verbatim (podcast/direct paste), no YouTube resolve', async () => {
    const resolver = vi.fn();
    const r = await resolveDownloadSource({ mediaUrl: 'https://cdn/a.mp3', url: 'https://cdn/a.mp3' }, resolver);
    expect(r).toBe('https://cdn/a.mp3');
    expect(resolver).not.toHaveBeenCalled();
  });

  test('YouTube watch url, no mediaUrl → resolve a fresh audio stream', async () => {
    const resolver = vi.fn(async () => 'https://rr3---googlevideo.com/videoplayback?x=1');
    const r = await resolveDownloadSource(
      { mediaUrl: null, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, resolver,
    );
    expect(resolver).toHaveBeenCalledWith('dQw4w9WgXcQ');
    expect(r).toMatch(/googlevideo\.com/);
  });

  test('non-YouTube url, no mediaUrl → use url verbatim', async () => {
    const resolver = vi.fn();
    const r = await resolveDownloadSource({ mediaUrl: null, url: 'https://example.com/a.mp3' }, resolver);
    expect(r).toBe('https://example.com/a.mp3');
    expect(resolver).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @benkyou/core test transcribe-youtube-resolve`
Expected: FAIL — `resolveDownloadSource` not exported.

- [ ] **Step 3: Implement `resolveDownloadSource` and use it in `transcribeItem`**

In `packages/core/src/pipeline/transcribe.ts`, add imports:

```typescript
import { parseYoutubeVideoId } from '../sources/youtube';
import { resolveYoutubeAudioUrl } from '../sources/youtube-session';
```

Add the pure helper (resolver injected for tests; defaults to the real one):

```typescript
// YouTube audio-stream URLs are ephemeral (§4) — never stored as media_url; resolved
// fresh here at download time. Everything else uses media_url ?? url verbatim.
export async function resolveDownloadSource(
  item: { mediaUrl: string | null; url: string },
  resolver: (videoId: string) => Promise<string> = resolveYoutubeAudioUrl,
): Promise<string> {
  if (item.mediaUrl) return item.mediaUrl;
  const videoId = parseYoutubeVideoId(item.url);
  if (videoId) return resolver(videoId);
  return item.url;
}
```

In `transcribeItem`, replace `const source = item.mediaUrl ?? item.url;` (line ~78) with:

```typescript
  const source = await resolveDownloadSource(item);
```

The `durationSec` line below it stays — for YouTube, `item.durationSec` is already populated (from the adapter via the Layer-2 handoff), so `probeRemoteDurationSec` is never reached. `downloadToTmp(source)` already runs the SSRF guard + manual redirect re-validation; googlevideo is public and passes.

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @benkyou/core test transcribe-youtube-resolve`
Expected: PASS.

- [ ] **Step 5: Add the googlevideo SSRF-pass assertion (§4.4 verification)**

In `packages/core/test/pipeline/media-probe.test.ts`, add a test confirming the guard does NOT block a public googlevideo-shaped address. (This is the codified half of §4.4; the live half is the Task 1 spike's audio fetch.)

```typescript
import { isBlockedAddress } from '../../src/pipeline/media-probe.js';

describe('SSRF guard allows public googlevideo addresses (§4.4)', () => {
  test('a public IPv4 (googlevideo edge) is not blocked', () => {
    expect(isBlockedAddress('142.250.72.206')).toBe(false); // public Google range
  });
  test('private ranges still blocked (regression)', () => {
    expect(isBlockedAddress('10.0.0.5')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true); // cloud metadata
  });
});
```

- [ ] **Step 6: Run media-probe tests + typecheck**

Run: `pnpm --filter @benkyou/core test media-probe && pnpm --filter @benkyou/core typecheck`
Expected: PASS.

- [ ] **Step 7: Manually verify the end-to-end audio path (§4.4 live half)**

With the sidecar up and Whisper configured, paste the §0 video and confirm it transcribes (not just degrades). Document the result. If `downloadToTmp` is killed by an SSRF/redirect guard on a googlevideo 302, capture the URL and adjust `assertSafeHttpUrl`'s redirect handling — but per §4.4 the public host should pass. Note the ephemeral-URL caveat: the full download must finish within the URL's validity window.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/pipeline/transcribe.ts \
  packages/core/test/pipeline/transcribe-youtube-resolve.test.ts \
  packages/core/test/pipeline/media-probe.test.ts
git commit -m "feat(pipeline): resolve fresh YouTube audio URL at download time"
```

---

## Task 9: Observability — sidecar health + credential status in panels

**Files:**
- Modify: `packages/core/src/pipeline/status.ts` (add `getPotokenHealth` + fold into `PipelineStatus`)
- Create: `packages/core/test/pipeline/potoken-health.test.ts`
- Modify: `apps/web/app/(authed)/admin/jobs/page.tsx` (render sidecar health)
- Modify: `apps/web/messages/{zh,en}.json` (jobs keys)

**Interfaces:**
- Consumes (Task 1): `pingPotokenSidecar`, `env.POTOKEN_PROVIDER_URL`.
- Produces:
  ```typescript
  interface PotokenHealth { configured: boolean; reachable: boolean | null; } // reachable null when not configured
  getPotokenHealth(): Promise<PotokenHealth>;
  // PipelineStatus gains: potoken: PotokenHealth
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/pipeline/potoken-health.test.ts`:

```typescript
import { afterEach, describe, expect, test, vi } from 'vitest';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('getPotokenHealth', () => {
  test('unset env → configured false, reachable null (no ping)', async () => {
    vi.stubEnv('POTOKEN_PROVIDER_URL', '');
    const { getPotokenHealth } = await import('../../src/pipeline/status.js');
    expect(await getPotokenHealth()).toEqual({ configured: false, reachable: null });
  });

  test('configured + reachable → reachable true', async () => {
    vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://sidecar:4416');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { getPotokenHealth } = await import('../../src/pipeline/status.js');
    expect(await getPotokenHealth()).toEqual({ configured: true, reachable: true });
  });

  test('configured + dead → reachable false (clustered YT degradation surfaces; the extract-cloudflare trap)', async () => {
    vi.stubEnv('POTOKEN_PROVIDER_URL', 'http://sidecar:4416');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const { getPotokenHealth } = await import('../../src/pipeline/status.js');
    expect(await getPotokenHealth()).toEqual({ configured: true, reachable: false });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @benkyou/core test potoken-health`
Expected: FAIL — `getPotokenHealth` not exported.

- [ ] **Step 3: Implement `getPotokenHealth` + fold into `PipelineStatus`**

In `packages/core/src/pipeline/status.ts`:

Add import:

```typescript
import { pingPotokenSidecar } from '../sources/potoken-client';
```

Add the function + interface:

```typescript
export interface PotokenHealth { configured: boolean; reachable: boolean | null; }

// A dead sidecar causes clustered YouTube degradation — surface it (cf. source
// consecutive_failures) so it isn't a silent failure (the extract-cloudflare trap, §5).
export async function getPotokenHealth(): Promise<PotokenHealth> {
  const url = env.POTOKEN_PROVIDER_URL;
  if (!url) return { configured: false, reachable: null };
  return { configured: true, reachable: await pingPotokenSidecar(url) };
}
```

Add `potoken: PotokenHealth` to the `PipelineStatus` interface, and include it in `getPipelineStatus`'s `Promise.all` + return object:

```typescript
  // in Promise.all add: getPotokenHealth()
  // in the destructure add: potoken
  // in the returned object add: potoken,
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @benkyou/core test potoken-health`
Expected: PASS (3 tests).

- [ ] **Step 5: Render sidecar health on the jobs page**

In `apps/web/app/(authed)/admin/jobs/page.tsx`, add a section (after section 7, transcription cost):

```tsx
      {/* 8. PoToken sidecar health (clustered YouTube degradation; design §5) */}
      <section>
        <h2 className="mb-2 font-semibold">{t('potokenHealth')}</h2>
        {!s.potoken.configured ? (
          <p className="text-sm text-slate-500">{t('potokenOff')}</p>
        ) : s.potoken.reachable ? (
          <p className="text-sm text-green-600">{t('potokenUp')}</p>
        ) : (
          <p className="text-sm text-red-600">{t('potokenDown')}</p>
        )}
      </section>
```

- [ ] **Step 6: Add jobs i18n keys (zh + en)**

In `apps/web/messages/en.json` under `jobs`:

```json
"potokenHealth": "PoToken sidecar",
"potokenOff": "Not configured (YouTube credential capability off)",
"potokenUp": "Reachable",
"potokenDown": "Unreachable — YouTube items will degrade until the sidecar recovers"
```

In `apps/web/messages/zh.json` under `jobs`:

```json
"potokenHealth": "PoToken sidecar",
"potokenOff": "未配置(YouTube 凭据能力已关闭)",
"potokenUp": "可访问",
"potokenDown": "不可访问 — sidecar 恢复前 YouTube 条目将降级"
```

- [ ] **Step 7: Verify i18n + build + commit**

Run: `pnpm check:i18n && pnpm --filter @benkyou/web build`
Expected: PASS.

```bash
git add packages/core/src/pipeline/status.ts \
  packages/core/test/pipeline/potoken-health.test.ts \
  apps/web/app/\(authed\)/admin/jobs/page.tsx \
  apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "feat(observability): PoToken sidecar health in pipeline panel"
```

---

## Task 10: Main-spec ordering correction (§8, task b)

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-benkyou-design.md` (§6.2 ~`:458`, milestone table ~`:948`)

Docs-only, separate small commit (per §8 "separate small commit"). No code, no tests.

- [ ] **Step 1: Annotate §6.2 (no-subtitle video flow)**

Locate §6.2 around line 458 ("视频无字幕 … 转写决策"). Add a note that scrape-source (YouTube/Bilibili) transcription — captions *and* Whisper — is gated on the credential/PoToken work, and is NOT a workaround for the anti-bot wall. Quote the new spec: `docs/superpowers/specs/2026-06-22-scrape-source-credentials-design.md`.

Suggested insertion (match surrounding bilingual style):

> **注(2026-06-22 修订):** scrape 源(YouTube/Bilibili)的转写——**字幕与 Whisper 皆然**——以 PoToken/凭据工作为共享前提(见 `2026-06-22-scrape-source-credentials-design.md`)。反爬墙下字幕屏蔽与音频屏蔽是同一失败域;Whisper 不是绕过反爬的手段。

- [ ] **Step 2: Annotate the milestone table**

Locate the milestone table around line 948 ("无字幕视频 M2a 暂以 unavailable 继续(M2b 转正,不回填)"). Append a note that M2b's Whisper covered only `media_url`-bearing items (direct-media paste, podcast enclosure), and scrape-source transcription lands with the 2026-06-22 credentials work.

Suggested addition to that row/cell:

> M2b 的 Whisper 仅覆盖带 `media_url` 的条目(直链粘贴、播客 enclosure);scrape 源(YouTube/Bilibili)的字幕与转写随 `2026-06-22-scrape-source-credentials` 落地。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-27-benkyou-design.md
git commit -m "docs(spec): correct scrape-source transcription ordering (§6.2 + milestone table)"
```

---

## Final verification (before requesting code review)

Run the full CI gate from `CLAUDE.md`:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm build
pnpm test
```

All must pass. Then re-run the §7 spike once more (sidecar up) to confirm nothing regressed the live path, and manually paste the §0 video to confirm captions-or-Whisper produces a transcript.

---

## Self-Review (plan author)

**Spec coverage:**
- §1 unified model & `platform_credentials` table → Task 2. ✔
- §2 sidecar architecture & lifecycle → Tasks 1 (sidecar/client) + 3 (lifecycle/refresh). ✔
- §3 caption path credential wiring (YT session + Bili SESSDATA + injection pattern + degrade contract) → Tasks 3 + 4. ✔
- §4 YouTube→Whisper Layer 2 (unchanged `isTranscribeEligible`, post-adapter branch, download resolver, SSRF caveat) → Tasks 7 + 8. ✔
- §5 failure/degrade & observability (credential status + sidecar health + console.warn reasons, no new enum) → Tasks 4/6/9. ✔
- §6 testing strategy (pure-function TDD, youtube-session mocks, Bili QR state machine, Layer-2 routing, spike-as-gate) → covered per task. ✔
- §7 Step-0 spike first → Task 1 (gate). ✔
- §8 main-spec ordering correction → Task 10. ✔
- Non-goals (logged-in YT, Bili password login, iframe, extension, serverless transcription) → not implemented; serverless `skipped_serverless` preserved via `transcribePolicy` unchanged. ✔

**Open-risk handling:** §7 spike is the explicit gate (Task 1 stop condition). Sidecar longevity = pinned tag (Task 1). SSRF vs googlevideo verified in Task 8 (unit) + Task 1/Task 8 live. Ephemeral-URL race noted in Task 8 Step 7 (full download must beat the URL window).

**Type consistency:** `SessionToken`/`SessionDeps`/`withYoutubeSession`/`YoutubeTokenExpiryError` (Task 3) consumed unchanged in Tasks 7/8. `applyTranscribePolicy(item, durationSec)` and `isYoutubeWhisperHandoff(item, potokenEnabled)` signatures match between definition (Task 7) and tests. `getPlatformCredential`/`upsertPlatformCredential`/`getBilibiliSessdata` (Task 2) used consistently in Tasks 3/4/5/6. `CredentialStatus` shape matches between core (Task 6) and the UI prop.

**Decision flagged for the user:** Task 6 adds the `qrcode` library (server-side QR rendering). It is a library, not a SaaS dependency, and keeps the QR `url`→image conversion server-side (client ships no QR lib). If you'd rather not add it, the alternative is returning the raw `url` and rendering the QR client-side — still a dep, just on the client.
