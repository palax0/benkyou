# Article Extraction & Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make article body extraction observable and readable — dual-store body text (`raw_content` for machines, `content_md` markdown for humans), add a `extract_status` signal column, add a Jina-style reader fallback, and render markdown in the reading view with honest "not fetched / incomplete" notices.

**Architecture:** Extraction converges on a single intermediate format (markdown). `resolveContent` runs a three-stage best-of chain (feed → direct fetch → reader), tracking the longest valid markdown and the most meaningful failure reason. `fetchReadable` and the new `fetchViaReader` return a typed `FetchOutcome` instead of swallowing failures as `null`. The pipeline dispatcher persists `content_md` + `extract_status` alongside the unchanged `raw_content` (which keeps feeding `search_vec`, embeddings, summary — zero blast radius). The reading view renders `content_md` as sanitized markdown, falling back to flat `raw_content` for old items.

**Tech Stack:** TypeScript strict, Drizzle ORM (Postgres), Vitest + MSW, `turndown` (HTML→markdown, node-safe via bundled domino), lightweight regex `stripMarkdown`, `react-markdown` + `rehype-sanitize` + `remark-gfm` (web), next-intl.

---

## Spec reference

Authoritative: [`docs/superpowers/specs/2026-06-15-article-extraction-and-rendering-design.md`](../specs/2026-06-15-article-extraction-and-rendering-design.md). Mother spec: [`docs/superpowers/specs/2026-05-27-benkyou-design.md`](../specs/2026-05-27-benkyou-design.md) §6.2.

### ⚠️ One deliberate refinement to flag (spec §5.2 / §5.4)

Spec §5.2 says the `FULLTEXT_MIN_CHARS` threshold now runs on **markdown length** ("可接受"). This plan instead measures the threshold against the **plain-text length** of the markdown (`stripMarkdown(best).length`), not the raw markdown string length.

**Why:** turndown preserves link URLs inline (`[Read more](https://…260-char-utm-url…)`). A feed blurb with one long tracking URL would inflate the markdown past 600 chars and **falsely clear the threshold**, skipping the real fetch — the exact silent-degrade failure this whole design exists to kill. The repo's pre-existing test (`extract-article.test.ts`, BLURB_HTML with a 260-char URL) depends on the threshold judging *text*, not markup. Measuring on stripped text preserves the original `htmlToText` semantics while still storing markdown as `content_md`.

This is a refinement, not a contradiction — markdown is still the canonical stored product. **Surface this to the user at plan handoff** and fold the wording into the §9 doc-sync task. If the user prefers literal markdown-length, change the one helper in Task 8.

---

## File Structure

**Create:**
- `packages/core/src/sources/reader.ts` — Jina-convention reader client (`fetchViaReader`, returns `FetchOutcome`).
- `packages/core/src/util/markdown.ts` — `htmlToMarkdown` (turndown) + `stripMarkdown` (regex).
- `apps/web/lib/extract.ts` — pure presentation-decision helper (`extractNoticeState`).
- `apps/web/components/ArticleBody.tsx` — dumb markdown view + raw_content fallback.
- `apps/web/components/ExtractNotice.tsx` — dumb "not fetched / incomplete" notice + summary-basis badge.
- Test files alongside each.

**Modify:**
- `packages/core/src/sources/types.ts` — `ExtractStatus`, `FetchFailReason`, `FetchOutcome`, `ExtractInput.reader`, `ExtractResult.{contentMd,extractStatus}`.
- `packages/core/src/sources/extract-article.ts` — `fetchReadable`→`FetchOutcome`; `resolveContent`→three-stage returning `ResolvedContent`; `extractArticle` wiring.
- `packages/core/src/pipeline/extract.ts` — read reader cfg from settings; persist `content_md` + `extract_status`.
- `packages/core/src/db/schema.ts` — `items.{content_md,extract_status}`, `user_settings.{reader_base_url,reader_api_key}` + generated migration.
- `packages/core/src/settings/index.ts` — `SettingsPatch` reader fields.
- `packages/core/src/items/queries.ts` — `ItemDetail.{contentMd,extractStatus}`.
- `apps/web/app/(authed)/settings/{actions.ts,SettingsForm.tsx,page.tsx}` — reader form section.
- `apps/web/app/(authed)/items/[id]/page.tsx` — markdown view + notices.
- `apps/web/messages/{zh,en}.json` — new keys.

**Untouched (the core dual-storage payoff — do NOT modify):** `items.raw_content`, the `search_vec` generated column (`schema.ts:151`), embeddings, `summary.ts` logic.

---

## Routing tags (CLAUDE.md UI workflow)

- 🔧 **Logic/derivative (pure superpowers):** Tasks 1–13, 15-logic, 16, 17. Reader client, markdown utils, three-stage resolve, observability column, settings form, notice decision helper.
- 🎨 **Net-new visual (spike-first, impeccable):** the markdown **prose** rendering in `ArticleBody` (Task 14). `DESIGN.md` has body typography/line-length but **no prose primitives** for headings/code-block/blockquote/list. Per CLAUDE.md: build a **structurally-neutral shell** marked `{/* DESIGN-GAP: markdown prose tokens */}` now; impeccable `craft`→`document` fills the prose tokens in the polish pass **before** code review. Do not improvise prose styling in this functional pass.

---

## Task 1: Add dependencies

**Files:**
- Modify: `packages/core/package.json`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add core dep (turndown) — node-safe HTML→markdown (v7 bundles domino, no jsdom needed)**

Run from repo root:
```bash
pnpm --filter @benkyou/core add turndown@7.2.4
pnpm --filter @benkyou/core add -D @types/turndown@5.0.6
```

- [ ] **Step 2: Add web deps (markdown rendering + sanitize + gfm)**

```bash
pnpm --filter @benkyou/web add react-markdown@10.1.0 rehype-sanitize@6.0.0 remark-gfm@4.0.1
```

- [ ] **Step 3: Verify install integrity**

Run: `pnpm install --frozen-lockfile`
Expected: completes with no lockfile drift error.

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add turndown + react-markdown/rehype-sanitize/remark-gfm deps"
```

---

## Task 2: Schema columns + migration

**Files:**
- Modify: `packages/core/src/db/schema.ts:130` (items), `:59` (user_settings region)
- Create: `packages/core/src/db/migrations/0006_*.sql` (drizzle-kit generated)

- [ ] **Step 1: Add `content_md` + `extract_status` to the `items` table**

In `schema.ts`, inside the `items` `pgTable` column object, immediately after the `rawContent` line (`rawContent: text('raw_content'),`):

```ts
    rawContent: text('raw_content'),
    contentMd: text('content_md'), // markdown body for display only; NULL → UI falls back to raw_content
    extractStatus: text('extract_status').notNull().default('ok'), // 'ok'|'blocked'|'fetch_failed'|'empty_parse' (article only)
```

- [ ] **Step 2: Add `reader_base_url` + `reader_api_key` to `user_settings`**

In `schema.ts`, after the `whisperModel` line (`whisperModel: text('whisper_model'),`):

```ts
  whisperModel: text('whisper_model'),

  readerBaseUrl: text('reader_base_url'), // Jina-style reader endpoint base; NULL = reader fallback disabled
  readerApiKey: text('reader_api_key'), // optional Bearer
```

- [ ] **Step 3: Generate the migration WITH required env (per memory: missing EMBED_DIM records vector(undefined))**

Run from repo root:
```bash
EMBED_DIM=1536 DATABASE_URL=postgres://benkyou:benkyou@localhost:5432/benkyou SESSION_SECRET=dev-secret \
  pnpm --filter @benkyou/core exec drizzle-kit generate
```
Expected: creates `packages/core/src/db/migrations/0006_<name>.sql` and updates `meta/_journal.json`.

- [ ] **Step 4: Hand-review the generated SQL**

Run: `cat packages/core/src/db/migrations/0006_*.sql`
Expected — exactly these four `ALTER`s and **no** `vector(undefined)` anywhere:
```sql
ALTER TABLE "items" ADD COLUMN "content_md" text;
ALTER TABLE "items" ADD COLUMN "extract_status" text DEFAULT 'ok' NOT NULL;
ALTER TABLE "user_settings" ADD COLUMN "reader_base_url" text;
ALTER TABLE "user_settings" ADD COLUMN "reader_api_key" text;
```
If `vector(undefined)` appears anywhere, delete the file + journal entry, re-run Step 3 with the env vars, do not hand-edit.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @benkyou/core typecheck`
Expected: PASS (new columns are valid Drizzle).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/schema.ts packages/core/src/db/migrations/
git commit -m "feat(db): add items.content_md/extract_status + user_settings.reader_*"
```

---

## Task 3: Extraction type contracts

**Files:**
- Modify: `packages/core/src/sources/types.ts`

- [ ] **Step 1: Add the status/outcome types and extend `ExtractInput` + `ExtractResult`**

In `types.ts`, after the `TranscriptStatus` type (around line 16), add:

```ts
// Article extraction observability (design §4.1). 'ok' = no needed enhancement
// step failed (adequate feed OR a successful direct/reader fetch — a legit short
// article is still 'ok'). Failure values mean an enhancement attempt failed.
export type FetchFailReason = 'blocked' | 'fetch_failed' | 'empty_parse';
export type ExtractStatus = 'ok' | FetchFailReason;

// fetchReadable / fetchViaReader return this instead of swallowing failures as null —
// the observability core of design §5.2. 'blocked' = 403 / Cloudflare challenge;
// 'fetch_failed' = network / 5xx / threw; 'empty_parse' = 200 but Readability empty (SPA).
export type FetchOutcome =
  | { ok: true; markdown: string }
  | { ok: false; reason: FetchFailReason };
```

Then extend `ExtractInput` (add the `reader` field):

```ts
export interface ExtractInput {
  url: string;
  rawContent: string | null;
  externalId: string | null;
  config?: Record<string, unknown>;
  // Reader fallback config, threaded from user_settings by the extract dispatcher.
  // Absent → reader stage disabled (design §5: enabled only when reader_base_url set).
  reader?: { baseUrl: string; apiKey?: string };
}
```

Then extend `ExtractResult` (add the two fields, after `rawContent`):

```ts
export interface ExtractResult {
  rawContent: string | null;
  contentMd?: string | null; // markdown body for display; dispatcher writes null if absent
  extractStatus?: ExtractStatus; // dispatcher defaults to 'ok' (parallels transcriptStatus)
  contentType: 'article' | 'video' | 'discussion' | 'paper';
  transcriptStatus?: TranscriptStatus;
  transcriptSegments?: TranscriptSegment[] | null;
  videoDuration?: number | null;
  videoKind?: string | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @benkyou/core typecheck`
Expected: PASS (purely additive; `extract-article.ts` still compiles against old `resolveContent` until Task 8).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/sources/types.ts
git commit -m "feat(sources): FetchOutcome/ExtractStatus types + reader input + ExtractResult fields"
```

---

## Task 4: `htmlToMarkdown` util

**Files:**
- Create: `packages/core/src/util/markdown.ts`
- Test: `packages/core/test/util/markdown.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/util/markdown.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { htmlToMarkdown } from '../../src/util/markdown.js';

describe('htmlToMarkdown', () => {
  test('converts headings, paragraphs, and code blocks to markdown', () => {
    const html = '<h2>Title</h2><p>Body text here.</p><pre><code>const x = 1;</code></pre>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('## Title');
    expect(md).toContain('Body text here.');
    expect(md).toContain('```');
    expect(md).toContain('const x = 1;');
  });

  test('converts links to markdown link syntax', () => {
    expect(htmlToMarkdown('<p><a href="https://e.test">link</a></p>')).toContain('[link](https://e.test)');
  });

  test('empty / whitespace input yields empty string', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('   ')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/util/markdown.test.ts`
Expected: FAIL — cannot resolve `../../src/util/markdown.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/util/markdown.ts`:
```ts
import TurndownService from 'turndown';

// turndown v7 bundles a DOM (domino), so this runs server-side without jsdom.
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  return turndown.turndown(html).trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/util/markdown.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/util/markdown.ts packages/core/test/util/markdown.test.ts
git commit -m "feat(util): htmlToMarkdown via turndown"
```

---

## Task 5: `stripMarkdown` util

**Files:**
- Modify: `packages/core/src/util/markdown.ts`
- Modify: `packages/core/test/util/markdown.test.ts`

- [ ] **Step 1: Write the failing test (append to markdown.test.ts)**

Add to `packages/core/test/util/markdown.test.ts`:
```ts
import { htmlToMarkdown, stripMarkdown } from '../../src/util/markdown.js';

describe('stripMarkdown', () => {
  test('drops heading markers, keeps heading text', () => {
    expect(stripMarkdown('## Real Title\n\nbody')).toBe('Real Title\n\nbody');
  });

  test('drops code fences but keeps the code content', () => {
    const md = '```ts\nconst x = 1;\n```';
    const out = stripMarkdown(md);
    expect(out).toContain('const x = 1;');
    expect(out).not.toContain('```');
  });

  test('reduces links to their text', () => {
    expect(stripMarkdown('see [the docs](https://e.test/very/long/url)')).toBe('see the docs');
  });

  test('strips emphasis, list markers, blockquotes, inline code', () => {
    expect(stripMarkdown('- **bold** and `code`')).toBe('bold and code');
    expect(stripMarkdown('> quoted line')).toBe('quoted line');
  });
});
```
(Update the top `import` line to include `stripMarkdown`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/util/markdown.test.ts`
Expected: FAIL — `stripMarkdown is not a function`.

- [ ] **Step 3: Implement `stripMarkdown` (append to markdown.ts)**

Add to `packages/core/src/util/markdown.ts`:
```ts
// markdown → readable plain text for raw_content / threshold judgement (design §5.3).
// Lightweight regex to keep the dependency surface small. Keeps code content, drops syntax.
export function stripMarkdown(md: string): string {
  if (!md) return '';
  let out = md;
  out = out.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1'); // fenced code: keep inner, drop fences+lang
  out = out.replace(/^```[^\n]*$/gm, ''); // any stray fence line
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images → alt
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // links → text
  out = out.replace(/`([^`]+)`/g, '$1'); // inline code
  out = out.replace(/^#{1,6}\s+/gm, ''); // heading markers
  out = out.replace(/^>\s?/gm, ''); // blockquote markers
  out = out.replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, ''); // list markers
  out = out.replace(/(\*\*|__)(.*?)\1/g, '$2'); // bold
  out = out.replace(/(\*|_)(.*?)\1/g, '$2'); // italic
  out = out.replace(/^\s*([-*_])\1{2,}\s*$/gm, ''); // horizontal rules
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/util/markdown.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/util/markdown.ts packages/core/test/util/markdown.test.ts
git commit -m "feat(util): stripMarkdown (markdown → plain text)"
```

---

## Task 6: Reader client `fetchViaReader`

**Files:**
- Create: `packages/core/src/sources/reader.ts`
- Test: `packages/core/test/sources/reader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/sources/reader.test.ts`:
```ts
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { fetchViaReader } from '../../src/sources/reader.js';

const BASE = 'https://reader.test';
const TARGET = 'https://site.test/article?id=42';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('fetchViaReader', () => {
  test('200 markdown → { ok: true }, and URL is base + full target (query kept)', async () => {
    let seenUrl = '';
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/${TARGET}`, ({ request }) => {
        seenUrl = request.url;
        seenAuth = request.headers.get('authorization');
        return new HttpResponse('# Heading\n\nReal body.', { headers: { 'content-type': 'text/markdown' } });
      }),
    );
    const r = await fetchViaReader(TARGET, { baseUrl: `${BASE}/`, apiKey: 'k' });
    expect(r).toEqual({ ok: true, markdown: '# Heading\n\nReal body.' });
    expect(seenUrl).toContain('id=42'); // query string preserved
    expect(seenAuth).toBe('Bearer k');
  });

  test('omits Authorization header when no apiKey', async () => {
    let seenAuth: string | null = 'unset';
    server.use(
      http.get(`${BASE}/${TARGET}`, ({ request }) => {
        seenAuth = request.headers.get('authorization');
        return new HttpResponse('# x\n\nbody', {});
      }),
    );
    await fetchViaReader(TARGET, { baseUrl: BASE });
    expect(seenAuth).toBeNull();
  });

  test('403 → blocked', async () => {
    server.use(http.get(`${BASE}/${TARGET}`, () => new HttpResponse(null, { status: 403 })));
    expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'blocked' });
  });

  test('cf-mitigated challenge header → blocked', async () => {
    server.use(
      http.get(`${BASE}/${TARGET}`, () => new HttpResponse(null, { status: 503, headers: { 'cf-mitigated': 'challenge' } })),
    );
    expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'blocked' });
  });

  test('5xx → fetch_failed', async () => {
    server.use(http.get(`${BASE}/${TARGET}`, () => new HttpResponse(null, { status: 502 })));
    expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'fetch_failed' });
  });

  test('network throw → fetch_failed', async () => {
    server.use(http.get(`${BASE}/${TARGET}`, () => { throw new Error('boom'); }));
    expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'fetch_failed' });
  });

  test('200 but empty body → empty_parse', async () => {
    server.use(http.get(`${BASE}/${TARGET}`, () => new HttpResponse('   ', {})));
    expect(await fetchViaReader(TARGET, { baseUrl: BASE })).toEqual({ ok: false, reason: 'empty_parse' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/sources/reader.test.ts`
Expected: FAIL — cannot resolve `../../src/sources/reader.js`.

- [ ] **Step 3: Write implementation**

Create `packages/core/src/sources/reader.ts`:
```ts
import type { FetchOutcome } from './types';

// Jina convention: GET {base}/{targetUrl}, optional Bearer. Returns markdown.
// Never throws — maps every failure to a FetchOutcome reason (design §5.1).
export async function fetchViaReader(
  url: string,
  cfg: { baseUrl: string; apiKey?: string },
): Promise<FetchOutcome> {
  const base = cfg.baseUrl.replace(/\/+$/, ''); // drop trailing slash(es)
  const target = `${base}/${url}`; // Jina accepts a bare URL appended; query string kept as-is
  const headers: Record<string, string> = { accept: 'text/markdown, text/plain, */*' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`; // empty Bearer is rejected by some gateways

  let res: Response;
  try {
    res = await fetch(target, { headers });
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  }
  if (res.status === 403 || res.headers.has('cf-mitigated')) return { ok: false, reason: 'blocked' };
  if (!res.ok) return { ok: false, reason: 'fetch_failed' };
  const markdown = (await res.text()).trim();
  if (markdown.length === 0) return { ok: false, reason: 'empty_parse' };
  return { ok: true, markdown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/sources/reader.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources/reader.ts packages/core/test/sources/reader.test.ts
git commit -m "feat(sources): Jina-convention reader client returning FetchOutcome"
```

---

## Task 7: `fetchReadable` → `FetchOutcome` (HTML→markdown)

**Files:**
- Modify: `packages/core/src/sources/extract-article.ts`
- Modify: `packages/core/test/sources/extract-article.test.ts`

- [ ] **Step 1: Rewrite the `fetchReadable` tests**

Replace the existing `describe('fetchReadable', …)` block in `packages/core/test/sources/extract-article.test.ts` with:
```ts
describe('fetchReadable', () => {
  test('returns ok markdown, dropping nav/footer', async () => {
    const r = await fetchReadable('https://site.test/article');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.markdown).toContain('first substantive paragraph');
      expect(r.markdown).not.toContain('menu junk');
      expect(r.markdown).not.toContain('footer junk');
    }
  });

  test('403 → blocked (degrade, do not throw)', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })));
    expect(await fetchReadable('https://site.test/article')).toEqual({ ok: false, reason: 'blocked' });
  });

  test('cf-mitigated header → blocked', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 503, headers: { 'cf-mitigated': 'challenge' } })));
    expect(await fetchReadable('https://site.test/article')).toEqual({ ok: false, reason: 'blocked' });
  });

  test('5xx → fetch_failed', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 500 })));
    expect(await fetchReadable('https://site.test/article')).toEqual({ ok: false, reason: 'fetch_failed' });
  });

  test('200 but Readability finds nothing → empty_parse', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse('<html><body><div></div></body></html>', { headers: { 'content-type': 'text/html' } })));
    expect(await fetchReadable('https://site.test/article')).toEqual({ ok: false, reason: 'empty_parse' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/sources/extract-article.test.ts -t fetchReadable`
Expected: FAIL — `fetchReadable` still returns string/null, `.ok` undefined.

- [ ] **Step 3: Rewrite `fetchReadable` in extract-article.ts**

Replace the current `fetchReadable` (extract-article.ts:12-24) with:
```ts
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { htmlToMarkdown, stripMarkdown } from '../util/markdown';
import type { ExtractInput, ExtractResult, ExtractStatus, FetchFailReason, FetchOutcome } from './types';
import { fetchViaReader } from './reader';

// Direct fetch + Readability → markdown. Returns a typed FetchOutcome instead of
// swallowing failures as null — observability core of design §5.2.
export async function fetchReadable(url: string): Promise<FetchOutcome> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': 'benkyou/0.1 (+readability)' } });
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  }
  if (res.status === 403 || res.headers.has('cf-mitigated')) return { ok: false, reason: 'blocked' };
  if (!res.ok) return { ok: false, reason: 'fetch_failed' };
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const contentHtml = article?.content?.trim(); // .content (HTML) not .textContent — design §5.2 step 2
  if (!contentHtml) return { ok: false, reason: 'empty_parse' };
  const markdown = htmlToMarkdown(contentHtml);
  if (markdown.length === 0) return { ok: false, reason: 'empty_parse' };
  return { ok: true, markdown };
}
```
(Note: this changes the top-of-file imports. The old `import { htmlToText } from '../util/text';` is removed — `resolveContent` no longer uses it after Task 8. `resolveContent`/`extractArticle` below will be replaced in Task 8; leave them temporarily broken — Step 4 only runs the fetchReadable subset.)

- [ ] **Step 4: Run the fetchReadable tests**

Run: `pnpm --filter @benkyou/core exec vitest run test/sources/extract-article.test.ts -t fetchReadable`
Expected: PASS (5 fetchReadable tests). Other tests in the file may fail — fixed in Task 8.

- [ ] **Step 5: Commit (WIP — file completed in Task 8)**

```bash
git add packages/core/src/sources/extract-article.ts packages/core/test/sources/extract-article.test.ts
git commit -m "feat(sources): fetchReadable returns FetchOutcome with markdown body"
```

---

## Task 8: `resolveContent` three-stage best-of chain

**Files:**
- Modify: `packages/core/src/sources/extract-article.ts`
- Modify: `packages/core/test/sources/extract-article.test.ts`

- [ ] **Step 1: Rewrite the `resolveContent` tests**

Replace the existing `describe('resolveContent', …)` block in the test file with:
```ts
describe('resolveContent', () => {
  // ~190 chars of text padded with markup + a long tracking URL well past 600 raw chars:
  // the threshold must judge PLAIN-TEXT length, not markdown length (long link URL must not inflate it).
  const BLURB_HTML =
    '<p>' + 'A short feed excerpt that teases the article without giving the body. '.repeat(2) + '</p>' +
    `<p><a href="https://site.test/article?utm_campaign=${'x'.repeat(260)}">Read more</a></p>`;

  test('adequate feed → no fetch, ok, dual-write', async () => {
    const full = `<p>${'Substantive feed body sentence. '.repeat(20)}</p>`;
    const r = await resolveContent(full, 'https://site.test/never-fetched');
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('Substantive feed body');
    expect(r.rawContent).toContain('Substantive feed body');
    expect(r.rawContent).not.toContain('<p>');
  });

  test('blurb (HTML-inflated, long link) still triggers direct fetch; direct wins → ok', async () => {
    const r = await resolveContent(BLURB_HTML, 'https://site.test/article');
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('first substantive paragraph');
    expect(r.rawContent).toContain('first substantive paragraph');
  });

  test('legit short article (direct ok but < threshold, no reader) → ok, not misjudged as failure', async () => {
    server.use(http.get('https://site.test/short', () => new HttpResponse(
      '<article><p>Short but real and complete.</p></article>', { headers: { 'content-type': 'text/html' } })));
    const r = await resolveContent(null, 'https://site.test/short');
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('Short but real and complete');
  });

  test('direct 403, no reader, empty feed → content null, status blocked', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })));
    const r = await resolveContent(null, 'https://site.test/article');
    expect(r.contentMd).toBeNull();
    expect(r.rawContent).toBeNull();
    expect(r.extractStatus).toBe('blocked');
  });

  test('PARTIAL: blurb feed + direct 403, no reader → content_md non-empty (blurb), status blocked', async () => {
    server.use(http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })));
    const r = await resolveContent(BLURB_HTML, 'https://site.test/article');
    expect(r.contentMd).toContain('A short feed excerpt');
    expect(r.extractStatus).toBe('blocked');
  });

  test('reader configured + direct insufficient → reader markdown wins → ok', async () => {
    server.use(
      http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })),
      http.get('https://reader.test/https://site.test/article', () =>
        new HttpResponse(`# Full\n\n${'Reader-provided real body sentence. '.repeat(20)}`, {})),
    );
    const r = await resolveContent(null, 'https://site.test/article', { baseUrl: 'https://reader.test' });
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('Reader-provided real body');
  });

  test('FAILURE PRIORITY: direct blocked + reader fetch_failed → final blocked (not overwritten)', async () => {
    server.use(
      http.get('https://site.test/article', () => new HttpResponse(null, { status: 403 })),
      http.get('https://reader.test/https://site.test/article', () => new HttpResponse(null, { status: 500 })),
    );
    const r = await resolveContent(null, 'https://site.test/article', { baseUrl: 'https://reader.test' });
    expect(r.contentMd).toBeNull();
    expect(r.extractStatus).toBe('blocked');
  });

  test('no content + no url → empty result', async () => {
    const r = await resolveContent(null, null);
    expect(r).toEqual({ contentMd: null, rawContent: null, extractStatus: 'ok' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/sources/extract-article.test.ts -t resolveContent`
Expected: FAIL — `resolveContent` returns a string, not `{ contentMd, rawContent, extractStatus }`.

- [ ] **Step 3: Implement the three-stage `resolveContent`**

Replace the current `resolveContent` (extract-article.ts:26-36) with:
```ts
// Below this many chars of PLAIN TEXT (stripMarkdown of the candidate, so link URLs /
// markup don't inflate the count) we assume only a blurb and try the next stage.
const FULLTEXT_MIN_CHARS = 600;

// Pick the most user-meaningful failure when several stages fail (design §5.2 step 4).
const FAIL_PRIORITY: Record<FetchFailReason, number> = { blocked: 3, empty_parse: 2, fetch_failed: 1 };

export interface ResolvedContent {
  contentMd: string | null;
  rawContent: string | null;
  extractStatus: ExtractStatus;
}

function plainLen(md: string): number {
  return stripMarkdown(md).length;
}

export async function resolveContent(
  feedHtml: string | null,
  url: string | null,
  reader?: { baseUrl: string; apiKey?: string },
): Promise<ResolvedContent> {
  let best = feedHtml ? htmlToMarkdown(feedHtml) : ''; // markdown is the canonical form
  let succeeded = plainLen(best) >= FULLTEXT_MIN_CHARS; // adequate feed alone counts as ok
  let lastFail: FetchFailReason | null = null;
  const mergeFail = (r: FetchFailReason) => {
    if (!lastFail || FAIL_PRIORITY[r] > FAIL_PRIORITY[lastFail]) lastFail = r;
  };
  const consider = (md: string) => {
    if (md.length > best.length) best = md;
    succeeded = true;
  };

  // Stage 2: direct fetch. Trigger when best is below threshold (NOT "best empty") — a
  // 200-char feed blurb must still escalate (design §5.2 step 3 note).
  if (plainLen(best) < FULLTEXT_MIN_CHARS && url) {
    const outcome = await fetchReadable(url);
    if (outcome.ok) consider(outcome.markdown);
    else mergeFail(outcome.reason);
  }

  // Stage 3: reader fallback — only if still below threshold (or prior stage failed) AND configured.
  if (plainLen(best) < FULLTEXT_MIN_CHARS && reader?.baseUrl && url) {
    const outcome = await fetchViaReader(url, reader);
    if (outcome.ok) consider(outcome.markdown);
    else mergeFail(outcome.reason);
  }

  const extractStatus: ExtractStatus = succeeded ? 'ok' : (lastFail ?? 'ok');
  const md = best.length > 0 ? best : null;
  return { contentMd: md, rawContent: md ? stripMarkdown(md) : null, extractStatus };
}
```

- [ ] **Step 4: Update `extractArticle` to use the new shape**

Replace the current `extractArticle` (extract-article.ts:38-45) with:
```ts
export async function extractArticle(input: ExtractInput): Promise<ExtractResult> {
  const { contentMd, rawContent, extractStatus } = await resolveContent(
    input.rawContent,
    input.url || null,
    input.reader,
  );
  return {
    rawContent,
    contentMd,
    extractStatus,
    contentType: 'article',
    transcriptStatus: 'na',
  };
}
```

- [ ] **Step 5: Update the `extractArticle` describe block in the test**

Replace the existing `describe('extractArticle', …)` block with:
```ts
describe('extractArticle', () => {
  test('adequate feed → article, na transcript, ok status, dual content', async () => {
    const full = `<p>${'Substantive feed body sentence. '.repeat(20)}</p>`;
    const r = await extractArticle({ url: 'https://site.test/never-fetched', rawContent: full, externalId: null });
    expect(r.contentType).toBe('article');
    expect(r.transcriptStatus).toBe('na');
    expect(r.extractStatus).toBe('ok');
    expect(r.contentMd).toContain('Substantive feed body');
    expect(r.rawContent).toContain('Substantive feed body');
  });

  test('null content + empty url + 403-only → null content, blocked', async () => {
    const r = await extractArticle({ url: '', rawContent: null, externalId: null });
    expect(r.rawContent).toBeNull();
    expect(r.contentMd).toBeNull();
    expect(r.extractStatus).toBe('ok'); // no url to fetch, no feed → no enhancement attempted → ok
  });
});
```

- [ ] **Step 6: Run the full file**

Run: `pnpm --filter @benkyou/core exec vitest run test/sources/extract-article.test.ts`
Expected: PASS (all fetchReadable + resolveContent + extractArticle tests).

- [ ] **Step 7: Typecheck (catches the removed htmlToText import etc.)**

Run: `pnpm --filter @benkyou/core typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/sources/extract-article.ts packages/core/test/sources/extract-article.test.ts
git commit -m "feat(sources): three-stage resolveContent (feed→direct→reader) with extract_status"
```

---

## Task 9: Pipeline dispatcher — thread reader config + persist new columns

**Files:**
- Modify: `packages/core/src/pipeline/extract.ts`
- Test: `packages/core/test/pipeline/extract-persist.test.ts`

- [ ] **Step 1: Write the failing test (unit — verifies dispatcher maps result → db columns and defaults)**

Create `packages/core/test/pipeline/extract-persist.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import type { ExtractResult } from '../../src/sources/types.js';
import { extractColumns } from '../../src/pipeline/extract.js';

describe('extractColumns (result → db column mapping)', () => {
  const base: ExtractResult = { rawContent: 'x', contentType: 'article' };

  test('defaults contentMd null and extractStatus ok when adapter omits them', () => {
    const cols = extractColumns(base, { videoKind: null });
    expect(cols.contentMd).toBeNull();
    expect(cols.extractStatus).toBe('ok');
  });

  test('passes through adapter-provided contentMd and extractStatus', () => {
    const cols = extractColumns(
      { ...base, contentMd: '# md', extractStatus: 'blocked' },
      { videoKind: null },
    );
    expect(cols.contentMd).toBe('# md');
    expect(cols.extractStatus).toBe('blocked');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/pipeline/extract-persist.test.ts`
Expected: FAIL — `extractColumns` not exported.

- [ ] **Step 3: Refactor `extract.ts` — extract a pure `extractColumns`, read reader cfg, persist new columns**

Replace the full contents of `packages/core/src/pipeline/extract.ts` with:
```ts
import { eq } from 'drizzle-orm';
import { getDbClient, items, sources } from '../db';
import { resolveAdapter } from '../sources';
import { getUserSettings } from '../settings';
import type { ExtractResult } from '../sources/types';

// Pure mapping from adapter result → items column patch. Dispatcher defaults
// contentMd=null and extractStatus='ok' (parallels transcriptStatus default).
export function extractColumns(result: ExtractResult, existing: { videoKind: string | null }) {
  return {
    rawContent: result.rawContent,
    contentMd: result.contentMd ?? null,
    extractStatus: result.extractStatus ?? 'ok',
    contentType: result.contentType,
    transcriptStatus: result.transcriptStatus ?? 'na',
    transcriptSegments: result.transcriptSegments ?? null,
    videoDuration: result.videoDuration ?? null,
    // M2a does not classify videoKind; preserve any existing value.
    videoKind: result.videoKind ?? existing.videoKind ?? null,
  };
}

export async function extractItem(itemId: string): Promise<void> {
  const db = getDbClient();
  const rows = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new Error(`Item not found: ${itemId}`);

  let type: string | null = null;
  let config: Record<string, unknown> | undefined;
  if (item.sourceId) {
    const srcRows = await db
      .select({ type: sources.type, config: sources.config })
      .from(sources)
      .where(eq(sources.id, item.sourceId))
      .limit(1);
    type = srcRows[0]?.type ?? null;
    config = srcRows[0]?.config as Record<string, unknown> | undefined;
  }

  // Reader fallback is enabled only when reader_base_url is set (design §5).
  const settings = await getUserSettings();
  const reader = settings?.readerBaseUrl
    ? { baseUrl: settings.readerBaseUrl, apiKey: settings.readerApiKey ?? undefined }
    : undefined;

  const adapter = resolveAdapter({ type, url: item.url });
  const result = await adapter.extract({
    url: item.url,
    rawContent: item.rawContent,
    externalId: item.externalId,
    config,
    reader,
  });

  await db.update(items).set(extractColumns(result, { videoKind: item.videoKind })).where(eq(items.id, itemId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/pipeline/extract-persist.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing pipeline integration tests (regression — confirm dispatcher still works end-to-end)**

Run: `pnpm --filter @benkyou/core exec vitest run test/pipeline/pipeline.int.test.ts`
Expected: PASS (Testcontainers spins up PG; new columns default correctly).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @benkyou/core typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pipeline/extract.ts packages/core/test/pipeline/extract-persist.test.ts
git commit -m "feat(pipeline): persist content_md/extract_status + thread reader config from settings"
```

---

## Task 10: Settings core — `SettingsPatch` reader fields

**Files:**
- Modify: `packages/core/src/settings/index.ts`
- Test: `packages/core/test/settings/reader-patch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/settings/reader-patch.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import type { SettingsPatch } from '../../src/settings/index.js';

// Type-level guard: SettingsPatch must accept reader fields (compile-time contract).
describe('SettingsPatch reader fields', () => {
  test('accepts readerBaseUrl / readerApiKey (incl. null to clear)', () => {
    const patch: SettingsPatch = { readerBaseUrl: 'https://r.test', readerApiKey: null };
    expect(patch.readerBaseUrl).toBe('https://r.test');
    expect(patch.readerApiKey).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/settings/reader-patch.test.ts`
Expected: FAIL — `readerBaseUrl` not a known property of `SettingsPatch` (type error at build).

- [ ] **Step 3: Add the fields to `SettingsPatch`**

In `packages/core/src/settings/index.ts`, add to the `SettingsPatch` interface (after `embedRequestDimensions`):
```ts
  embedRequestDimensions?: boolean;
  readerBaseUrl?: string | null;
  readerApiKey?: string | null;
  interestTags?: string[];
```
(`updateSettings` already spreads `patch` into `.set(...)`, so no further change is needed there.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/settings/reader-patch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/settings/index.ts packages/core/test/settings/reader-patch.test.ts
git commit -m "feat(settings): SettingsPatch reader_base_url/reader_api_key passthrough"
```

---

## Task 11: Settings page — reader endpoint form (🔧)

**Files:**
- Modify: `apps/web/app/(authed)/settings/actions.ts`
- Modify: `apps/web/app/(authed)/settings/SettingsForm.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`
- Modify: `apps/web/app/(authed)/settings/SettingsForm.test.ts`

- [ ] **Step 1: Add i18n keys (both locales) — keep zh/en in lockstep (CI `check:i18n`)**

In `apps/web/messages/en.json`, add to the `settings` object:
```json
    "readerSection": "Reader endpoint (fallback)",
    "readerBaseUrlPlaceholder": "Reader base URL (e.g. https://r.jina.ai), blank to disable",
    "readerApiKeyPlaceholder": "Reader API key (optional)",
    "readerApiKeyConfigured": "Reader API key saved — leave blank to keep"
```
In `apps/web/messages/zh.json`, add to the `settings` object:
```json
    "readerSection": "Reader 端点(兜底)",
    "readerBaseUrlPlaceholder": "Reader 基址(如 https://r.jina.ai),留空则不启用",
    "readerApiKeyPlaceholder": "Reader API Key(可选)",
    "readerApiKeyConfigured": "已保存 Reader API Key — 留空则保持不变"
```

- [ ] **Step 2: Run i18n check**

Run: `pnpm check:i18n`
Expected: `✓ i18n keys consistent`.

- [ ] **Step 3: Update the source-boundary test to require reader plumbing**

Append to `apps/web/app/(authed)/settings/SettingsForm.test.ts` (inside the existing `describe`):
```ts
  test('client form does not read the stored reader API key, and renders the reader section', async () => {
    const source = await readFile(path.join(dir, 'SettingsForm.tsx'), 'utf8');
    expect(source).not.toMatch(/settings\.readerApiKey(?!Configured)/);
    expect(source).toContain('readerApiKeyConfigured');
    expect(source).toContain("name=\"readerBaseUrl\"");
  });
```
And add to the page-strip test's assertions:
```ts
    expect(source).toContain('readerApiKeyConfigured: Boolean(readerApiKey)');
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @benkyou/web exec vitest run "app/(authed)/settings/SettingsForm.test.ts"`
Expected: FAIL — reader plumbing not present yet.

- [ ] **Step 5: Add the reader fields to the form's prop type + markup**

In `SettingsForm.tsx`, extend the omitted-secret prop type:
```ts
export type SettingsFormSettings = Omit<UserSettings, 'llmApiKey' | 'embedApiKey' | 'readerApiKey'> & {
  llmApiKeyConfigured: boolean;
  embedApiKeyConfigured: boolean;
  readerApiKeyConfigured: boolean;
};
```
Then add a reader section before the `interestTags` input:
```tsx
      <h2 className="font-semibold">{t('readerSection')}</h2>
      <input
        name="readerBaseUrl"
        defaultValue={v?.readerBaseUrl ?? settings.readerBaseUrl ?? ''}
        className={field}
        placeholder={t('readerBaseUrlPlaceholder')}
      />
      <input
        name="readerApiKey"
        type="password"
        defaultValue={v?.readerApiKey ?? ''}
        className={field}
        placeholder={settings.readerApiKeyConfigured ? t('readerApiKeyConfigured') : t('readerApiKeyPlaceholder')}
      />
```

- [ ] **Step 6: Thread reader fields through the server action**

In `apps/web/app/(authed)/settings/actions.ts`:

(a) Add to `FormValues`:
```ts
  readerBaseUrl: string;
  readerApiKey: string;
  interestTags: string;
```
(b) Add to the `Schema` object: `readerBaseUrl: z.string().optional(), readerApiKey: z.string().optional(),`
(c) Add to the `values` literal: `readerBaseUrl: String(fd.get('readerBaseUrl') ?? ''), readerApiKey: String(fd.get('readerApiKey') ?? ''),`
(d) Add to the `safeParse` object: `readerBaseUrl: str(fd, 'readerBaseUrl'), readerApiKey: str(fd, 'readerApiKey'),`
(e) Before `updateSettings`, preserve the stored key when the field is blank (mirror llm/embed):
```ts
  const readerApiKey = v.readerApiKey ?? current.readerApiKey;
```
(f) Add to the `updateSettings({...})` call:
```ts
    readerBaseUrl: v.readerBaseUrl ?? null,
    readerApiKey,
```

- [ ] **Step 7: Strip the reader secret in the page (mirror llm/embed)**

In `apps/web/app/(authed)/settings/page.tsx`, change the destructure and props:
```ts
  const { llmApiKey, embedApiKey, readerApiKey, ...safeSettings } = settings;
```
```tsx
          settings={{
            ...safeSettings,
            llmApiKeyConfigured: Boolean(llmApiKey),
            embedApiKeyConfigured: Boolean(embedApiKey),
            readerApiKeyConfigured: Boolean(readerApiKey),
          }}
```

- [ ] **Step 8: Run the form test + typecheck**

Run: `pnpm --filter @benkyou/web exec vitest run "app/(authed)/settings/SettingsForm.test.ts"`
Expected: PASS.
Run: `pnpm --filter @benkyou/web typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add "apps/web/app/(authed)/settings" apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "feat(web): reader endpoint settings section (base url + api key)"
```

---

## Task 12: Item query — expose `contentMd` + `extractStatus`

**Files:**
- Modify: `packages/core/src/items/queries.ts`
- Test: `packages/core/test/items/item-detail-columns.test.ts`

- [ ] **Step 1: Write the failing test (source-level: ItemDetail selects the new columns)**

Create `packages/core/test/items/item-detail-columns.test.ts`:
```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

describe('getItemForUser projection', () => {
  test('selects content_md and extract_status', async () => {
    const src = await readFile(
      path.resolve(import.meta.dirname, '../../src/items/queries.ts'),
      'utf8',
    );
    expect(src).toContain('contentMd: items.contentMd');
    expect(src).toContain('extractStatus: items.extractStatus');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/core exec vitest run test/items/item-detail-columns.test.ts`
Expected: FAIL — strings not present.

- [ ] **Step 3: Add the fields to `ItemDetail` and the projection**

In `packages/core/src/items/queries.ts`:

(a) Extend the `ItemDetail` interface:
```ts
export interface ItemDetail extends FeedItem {
  rawContent: string | null;
  contentMd: string | null;
  extractStatus: string;
  deepSummary: string | null;
  author: string | null;
  topicTags: string[] | null;
}
```
(b) Add to the `getItemForUser` select object (after `rawContent: items.rawContent,`):
```ts
      rawContent: items.rawContent,
      contentMd: items.contentMd,
      extractStatus: items.extractStatus,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/core exec vitest run test/items/item-detail-columns.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @benkyou/core typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/items/queries.ts packages/core/test/items/item-detail-columns.test.ts
git commit -m "feat(items): expose content_md + extract_status in ItemDetail"
```

---

## Task 13: Notice decision helper (pure logic) (🔧)

**Files:**
- Create: `apps/web/lib/extract.ts`
- Test: `apps/web/test/extract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/extract.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { extractNoticeState } from '@/lib/extract';

describe('extractNoticeState', () => {
  test('non-article items never show an extract notice (videos use transcript_status)', () => {
    expect(extractNoticeState('video', 'blocked', false)).toEqual({ kind: 'none', titleOnly: false });
  });

  test('article + ok → no notice', () => {
    expect(extractNoticeState('article', 'ok', true)).toEqual({ kind: 'none', titleOnly: false });
  });

  test('article + failure + no body → missing notice + title-only summary', () => {
    expect(extractNoticeState('article', 'blocked', false)).toEqual({ kind: 'missing', titleOnly: true });
  });

  test('article + failure + has body (partial) → incomplete notice, summary not title-only', () => {
    expect(extractNoticeState('article', 'blocked', true)).toEqual({ kind: 'partial', titleOnly: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/web exec vitest run test/extract.test.ts`
Expected: FAIL — cannot resolve `@/lib/extract`.

- [ ] **Step 3: Implement the helper**

Create `apps/web/lib/extract.ts`:
```ts
// Pure presentation decision (design §7.2/§7.3). Keeps the views logic-free.
// kind: which fetch-status notice to render. titleOnly: whether the summary was made
// without a body (annotate it). Only meaningful for content_type='article'.
export type ExtractNoticeKind = 'none' | 'missing' | 'partial';

export function extractNoticeState(
  contentType: string,
  extractStatus: string,
  hasContentMd: boolean,
): { kind: ExtractNoticeKind; titleOnly: boolean } {
  if (contentType !== 'article' || extractStatus === 'ok') {
    return { kind: 'none', titleOnly: false };
  }
  return hasContentMd ? { kind: 'partial', titleOnly: false } : { kind: 'missing', titleOnly: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/web exec vitest run test/extract.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/extract.ts apps/web/test/extract.test.ts
git commit -m "feat(web): pure extractNoticeState helper for article fetch-status UI"
```

---

## Task 14: `ArticleBody` markdown view (🎨 structurally-neutral shell)

**Files:**
- Create: `apps/web/components/ArticleBody.tsx`
- Test: `apps/web/test/article-body.test.ts`
- Modify: `apps/web/app/(authed)/items/[id]/page.tsx`

> 🎨 This renders net-new **prose** primitives (headings/code/blockquote/list) that `DESIGN.md` does not yet define. Build the structurally-neutral shell now; the impeccable polish pass fills the prose tokens. Mark the gap; do **not** invent prose styling here.

- [ ] **Step 1: Write the failing test (source-level — repo has no component-render harness; assert composition + No-Improvisation guard)**

Create `apps/web/test/article-body.test.ts`:
```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const file = path.resolve(import.meta.dirname, '../components/ArticleBody.tsx');

describe('ArticleBody', () => {
  test('renders markdown via react-markdown with sanitize + gfm', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toContain("from 'react-markdown'");
    expect(src).toContain("from 'rehype-sanitize'");
    expect(src).toContain("from 'remark-gfm'");
  });

  test('falls back to raw_content when content_md absent', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toContain('whitespace-pre-wrap'); // flat fallback path preserved
    expect(src).toContain('rawContent');
  });

  test('marks the prose-token gap and uses no improvised visual values', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toContain('DESIGN-GAP');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/); // no raw hex
    expect(src).not.toMatch(/\b(?:p|m|gap|text|bg)-\[/); // no Tailwind arbitrary values
    expect(src).not.toMatch(/style=\{/); // no inline style
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @benkyou/web exec vitest run test/article-body.test.ts`
Expected: FAIL — component file missing.

- [ ] **Step 3: Implement the dumb view (server component)**

Create `apps/web/components/ArticleBody.tsx`:
```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

// Dumb view: markdown when we have it, flat raw_content fallback for old items.
// {/* DESIGN-GAP: markdown prose tokens (heading/code/blockquote/list scale + rhythm)
//     not yet in DESIGN.md — impeccable craft→document fills these before code review. */}
export function ArticleBody({
  contentMd,
  rawContent,
  emptyLabel,
}: {
  contentMd: string | null;
  rawContent: string | null;
  emptyLabel: string;
}) {
  if (contentMd) {
    return (
      <div className="text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {contentMd}
        </ReactMarkdown>
      </div>
    );
  }
  if (rawContent) {
    return <article className="whitespace-pre-wrap text-sm leading-relaxed">{rawContent}</article>;
  }
  return <p className="text-sm text-muted">{emptyLabel}</p>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @benkyou/web exec vitest run test/article-body.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `ArticleBody` into the item page (replace the raw_content block)**

In `apps/web/app/(authed)/items/[id]/page.tsx`, add the import:
```tsx
import { ArticleBody } from '@/components/ArticleBody';
```
Replace the current body block (lines 66-70, the `item.rawContent ? … : …` ternary) with:
```tsx
      <ArticleBody contentMd={item.contentMd} rawContent={item.rawContent} emptyLabel={t('noContent')} />
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @benkyou/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ArticleBody.tsx apps/web/test/article-body.test.ts "apps/web/app/(authed)/items/[id]/page.tsx"
git commit -m "feat(web): ArticleBody markdown view with raw_content fallback (prose tokens DESIGN-GAP)"
```

---

## Task 15: Fetch-status notice + summary-basis badge (🔧 logic, neutral shell)

**Files:**
- Create: `apps/web/components/ExtractNotice.tsx`
- Test: `apps/web/test/extract-notice.test.ts`
- Modify: `apps/web/app/(authed)/items/[id]/page.tsx`
- Modify: `apps/web/messages/zh.json`, `apps/web/messages/en.json`

- [ ] **Step 1: Add i18n keys (both locales, lockstep)**

In `apps/web/messages/en.json`, add to the `item` object:
```json
    "extractMissing": "Full text not fetched ({reason})",
    "extractPartial": "Full text may be incomplete ({reason})",
    "summaryTitleOnly": "From title only",
    "extractReason": {
      "blocked": "blocked by the site",
      "fetch_failed": "fetch failed",
      "empty_parse": "no readable content"
    }
```
In `apps/web/messages/zh.json`, add to the `item` object:
```json
    "extractMissing": "正文未抓取({reason})",
    "extractPartial": "正文可能不完整({reason})",
    "summaryTitleOnly": "仅据标题",
    "extractReason": {
      "blocked": "被站点拦截",
      "fetch_failed": "抓取失败",
      "empty_parse": "无可读正文"
    }
```

- [ ] **Step 2: Run i18n check**

Run: `pnpm check:i18n`
Expected: `✓ i18n keys consistent`.

- [ ] **Step 3: Write the failing test**

Create `apps/web/test/extract-notice.test.ts`:
```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const file = path.resolve(import.meta.dirname, '../components/ExtractNotice.tsx');

describe('ExtractNotice', () => {
  test('uses the pure decision helper and links to the original', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toContain('extractNoticeState');
    expect(src).toContain('item.original'); // reuses existing "Original" link label
  });

  test('renders both missing and partial copy, and the title-only summary badge', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).toContain('extractMissing');
    expect(src).toContain('extractPartial');
    expect(src).toContain('summaryTitleOnly');
  });

  test('no improvised visual values', async () => {
    const src = await readFile(file, 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(src).not.toMatch(/\b(?:p|m|gap|text|bg)-\[/);
    expect(src).not.toMatch(/style=\{/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @benkyou/web exec vitest run test/extract-notice.test.ts`
Expected: FAIL — component missing.

- [ ] **Step 5: Implement `ExtractNotice` (dumb view driven by the helper)**

Create `apps/web/components/ExtractNotice.tsx`:
```tsx
import { useTranslations } from 'next-intl';
import { extractNoticeState } from '@/lib/extract';

// Article fetch-status notice (design §7.2) + summary-basis badge (§7.3).
// Recessive, calm — a missing body is a normal degradation, not an error (no red).
export function ExtractNotice({
  contentType,
  extractStatus,
  hasContentMd,
  url,
}: {
  contentType: string;
  extractStatus: string;
  hasContentMd: boolean;
  url: string;
}) {
  const t = useTranslations('item');
  const { kind } = extractNoticeState(contentType, extractStatus, hasContentMd);
  if (kind === 'none') return null;

  const reason = t(`extractReason.${extractStatus}` as 'extractReason.blocked');
  const label = kind === 'missing' ? t('extractMissing', { reason }) : t('extractPartial', { reason });

  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span>{label}</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-accent underline-offset-2 transition-colors duration-150 hover:underline motion-reduce:transition-none"
      >
        {t('original')}
      </a>
    </p>
  );
}

// Small recessive badge: the AI summary was produced without a body (design §7.3).
export function SummaryBasisBadge({
  contentType,
  extractStatus,
  hasContentMd,
}: {
  contentType: string;
  extractStatus: string;
  hasContentMd: boolean;
}) {
  const t = useTranslations('item');
  const { titleOnly } = extractNoticeState(contentType, extractStatus, hasContentMd);
  if (!titleOnly) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs text-faint">
      {t('summaryTitleOnly')}
    </span>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @benkyou/web exec vitest run test/extract-notice.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Wire into the item page**

In `apps/web/app/(authed)/items/[id]/page.tsx`:

(a) Add import:
```tsx
import { ExtractNotice, SummaryBasisBadge } from '@/components/ExtractNotice';
```
(b) Inside the `<header>`, after the meta `<div>` (and the existing video `TranscriptBadge` block), add the notice:
```tsx
        <div className="mt-2">
          <ExtractNotice
            contentType={item.contentType}
            extractStatus={item.extractStatus}
            hasContentMd={Boolean(item.contentMd)}
            url={item.url}
          />
        </div>
```
(c) Replace the `<DeepSummary … />` line with a wrapper carrying the badge:
```tsx
      <div className="flex flex-col gap-2">
        <SummaryBasisBadge
          contentType={item.contentType}
          extractStatus={item.extractStatus}
          hasContentMd={Boolean(item.contentMd)}
        />
        <DeepSummary itemId={item.id} initial={item.deepSummary} />
      </div>
```

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @benkyou/web typecheck`
Expected: PASS.

- [ ] **Step 9: Manual browser verification (UI workflow — don't claim "looks good" without running)**

Run the app and a worker against real data (or seed one item per state via `psql`):
```bash
pnpm --filter @benkyou/web dev
```
Verify in browser:
1. An `ok` article with `content_md` → renders structured markdown (headings distinct from body, code block fenced); no notice, no badge.
2. A `blocked` article with empty `content_md` → "正文未抓取(被站点拦截)" + 原文 link; "仅据标题" badge near the summary; body shows "没有正文内容".
3. A `blocked` article with a short feed blurb in `content_md` → "正文可能不完整(被站点拦截)" + link; blurb still renders; **no** title-only badge.
4. A video item → no extract notice (transcript badge only).
5. An old article (`content_md` NULL, `raw_content` present) → flat `whitespace-pre-wrap` fallback, no regression.

- [ ] **Step 10: Commit**

```bash
git add apps/web/components/ExtractNotice.tsx apps/web/test/extract-notice.test.ts "apps/web/app/(authed)/items/[id]/page.tsx" apps/web/messages/zh.json apps/web/messages/en.json
git commit -m "feat(web): article fetch-status notice + title-only summary badge"
```

---

## Task 16 (optional, low priority): List-row extract badge (🔧)

> Spec §7.4 — defer unless time allows. Reuses the `TranscriptBadge` calm-status pattern, no cards (DESIGN.md No-Card Rule). Skip if descoping; not required for a working milestone.

**Files:**
- Create: `apps/web/components/ExtractBadge.tsx`
- Modify: `packages/core/src/items/queries.ts` (add `extractStatus` + `contentType` already in `FEED_COLUMNS`; `contentType` is present, add `extractStatus`)
- Modify: the feed row component that renders list items
- Test: `apps/web/test/extract-badge.test.ts`

- [ ] **Step 1: Add `extractStatus` to `FEED_COLUMNS`**

In `packages/core/src/items/queries.ts`, add to `FEED_COLUMNS` and the `FeedItem` interface:
```ts
  transcriptStatus: items.transcriptStatus,
  extractStatus: items.extractStatus,
```
```ts
  transcriptStatus: string;
  extractStatus: string;
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/test/extract-badge.test.ts`:
```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

describe('ExtractBadge', () => {
  test('renders nothing for ok / non-article, no improvised values', async () => {
    const src = await readFile(path.resolve(import.meta.dirname, '../components/ExtractBadge.tsx'), 'utf8');
    expect(src).toContain("=== 'article'");
    expect(src).toContain("=== 'ok'");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(src).not.toMatch(/\b(?:p|m|gap|text|bg)-\[/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @benkyou/web exec vitest run test/extract-badge.test.ts`
Expected: FAIL — component missing.

- [ ] **Step 4: Implement `ExtractBadge` (mirror TranscriptBadge's calm-status pattern)**

Create `apps/web/components/ExtractBadge.tsx`:
```tsx
import { useTranslations } from 'next-intl';

// Calm, recessive status badge on feed rows (design §7.4). Article-only; 'ok' shows nothing.
export function ExtractBadge({ contentType, status }: { contentType: string; status: string }) {
  const t = useTranslations('item');
  if (contentType !== 'article' || status === 'ok') return null;
  const reason = t(`extractReason.${status}` as 'extractReason.blocked');
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs text-faint">
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />
      {reason}
    </span>
  );
}
```

- [ ] **Step 5: Run test, render in the feed row, manual-verify, commit**

Run: `pnpm --filter @benkyou/web exec vitest run test/extract-badge.test.ts` → PASS.
Add `<ExtractBadge contentType={item.contentType} status={item.extractStatus} />` to the feed-row component (locate via `listFeed` consumer). Manually verify a blocked article shows the recessive badge in the feed.
```bash
git add apps/web/components/ExtractBadge.tsx apps/web/test/extract-badge.test.ts packages/core/src/items/queries.ts
git commit -m "feat(web): recessive extract_status badge on feed rows"
```

---

## Task 17: Documentation sync — mother spec §6.2 / §3.4 (🔧)

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-benkyou-design.md` (§6.2 pipeline degradation, §3.4 non-goals note)

- [ ] **Step 1: Update §6.2 (pipeline degradation semantics)**

In the mother spec §6.2, change the article-extraction "silent degrade" wording to "degrade **+ record `extract_status`**", and add:
- The reader fallback contract (Jina convention, last resort after direct fetch, degrade-not-retry).
- The dual-storage body model: `raw_content` (plain text, feeds search/embeddings/summary) / `content_md` (markdown, display only).
- **The threshold refinement (this plan's deviation):** `FULLTEXT_MIN_CHARS` is judged against the **plain-text length** of the candidate markdown (not the markdown string length), so inline link URLs cannot falsely clear the threshold. Note this supersedes design §5.2's "markdown length" wording.

- [ ] **Step 2: Update §3.4 (non-goals — record, don't change)**

Add a note: browser extension remains a postponed non-goal; the "paste body" entry for protected pages is a pending standalone mini-spec. This design's stance on protected pages is graceful degradation (summary + original link + honest labeling), not bypass.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-05-27-benkyou-design.md
git commit -m "docs(spec): sync §6.2 extract_status + dual-storage + reader; §3.4 protected-page stance"
```

---

## Final verification (run before code review)

- [ ] **Step 1: Full CI gate**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm check:i18n
pnpm test
```
Expected: all PASS.

- [ ] **Step 2: Confirm the dual-storage invariant held**

Run: `git diff main --stat -- packages/core/src/db/schema.ts`
Expected: only **additive** column lines; the `search_vec` generated column (`schema.ts:151`) and `raw_content` are **unchanged**.

- [ ] **Step 3: 🎨 Polish handoff (before requesting-code-review)**

The `ArticleBody` prose rendering carries a `DESIGN-GAP` marker. Per CLAUDE.md UI workflow, run the impeccable polish pass on the markdown reading view (`/impeccable live` → `/impeccable document`) to define heading/code/blockquote/list prose tokens in `DESIGN.md` and apply them — **before** code review, so review sees the final state. Find targets by grepping: `grep -rn "DESIGN-GAP" apps/web/components`.

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- §3.1 reader BYO client → Task 6. §3.2 `resolveContent` three-stage → Task 8. §3.3 `fetchReadable`→outcome → Task 7. §3.4 dual-storage schema + `ExtractResult` → Tasks 2, 3, 9. §3.5 settings → Tasks 10, 11. §3.6 UI (markdown view + notices + title-only badge) → Tasks 13, 14, 15. §3.7 docs → Task 17.
- §4.1/§4.2 columns → Task 2. §4.3 `ExtractResult` → Task 3. §4.4 migration env → Task 2 Step 3.
- §5.1 reader URL-join rules (trailing slash, query kept, no empty Bearer, Accept header) → Task 6 + tests. §5.2 best-of + lastFail priority + threshold-triggers-not-empty → Task 8 + tests. §5.3 turndown + stripMarkdown → Tasks 4, 5. §5.4 degrade-not-retry preserved (no throw anywhere) → Tasks 6–8.
- §7.1 markdown/fallback → Task 14. §7.2 missing vs partial → Tasks 13, 15. §7.3 title-only badge → Tasks 13, 15. §7.4 list badge → Task 16 (optional). §7.5 🎨 spike routing → noted in routing tags + final Step 3.
- §8 test matrix → covered across Tasks 5–9, 13; UI behaviors via source-guard tests + manual browser checklist (repo's web vitest is node-env, no render harness).

**2. Placeholder scan:** No "TBD"/"handle errors"/"similar to". Every code step has complete code.

**3. Type consistency:** `FetchOutcome`/`ExtractStatus`/`FetchFailReason` defined once (Task 3), consumed identically in `reader.ts`, `extract-article.ts`. `ResolvedContent` shape (`{contentMd, rawContent, extractStatus}`) consistent between `resolveContent` (Task 8) and `extractArticle`. `extractColumns` mapping (Task 9) matches `ExtractResult` fields. `extractNoticeState(contentType, extractStatus, hasContentMd)` signature identical across helper (13), `ExtractNotice`/`SummaryBasisBadge` (15). i18n keys added in both locales in lockstep at each UI task.

**Flagged deviation:** threshold on plain-text length vs spec's markdown length (see top banner + Task 17) — surface to user at handoff.
