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
  const title = article?.title?.trim() || null; // refines a URL-placeholder title (extract.ts)
  return { ok: true, markdown, title };
}

// Below this many chars of PLAIN TEXT (stripMarkdown of the candidate, so link URLs /
// markup don't inflate the count) we assume only a blurb and try the next stage.
const FULLTEXT_MIN_CHARS = 600;

// Pick the most user-meaningful failure when several stages fail (design §5.2 step 4).
const FAIL_PRIORITY: Record<FetchFailReason, number> = { blocked: 3, empty_parse: 2, fetch_failed: 1 };

export interface ResolvedContent {
  contentMd: string | null;
  rawContent: string | null;
  extractStatus: ExtractStatus;
  title: string | null; // title of the winning candidate (Readability); null if none
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
  let bestTitle: string | null = null; // title travels with the candidate that wins `best`
  let succeeded = plainLen(best) >= FULLTEXT_MIN_CHARS; // adequate feed alone counts as ok
  let lastFail: FetchFailReason | null = null;
  const mergeFail = (r: FetchFailReason) => {
    if (!lastFail || FAIL_PRIORITY[r] > FAIL_PRIORITY[lastFail]) lastFail = r;
  };
  const consider = (md: string, title?: string | null) => {
    if (plainLen(md) > plainLen(best)) {
      best = md;
      if (title) bestTitle = title;
    }
    succeeded = true;
  };

  // Stage 2: direct fetch. Trigger when best is below threshold (NOT "best empty") — a
  // 200-char feed blurb must still escalate (design §5.2 step 3 note).
  if (plainLen(best) < FULLTEXT_MIN_CHARS && url) {
    const outcome = await fetchReadable(url);
    if (outcome.ok) consider(outcome.markdown, outcome.title);
    else mergeFail(outcome.reason);
  }

  // Stage 3: reader fallback — only if best is still below the plain-text threshold
  // (a failed or absent prior stage leaves best unchanged, so it stays below) AND reader configured.
  if (plainLen(best) < FULLTEXT_MIN_CHARS && reader?.baseUrl && url) {
    const outcome = await fetchViaReader(url, reader);
    if (outcome.ok) consider(outcome.markdown); // reader (Jina) returns body only, no title
    else mergeFail(outcome.reason);
  }

  const extractStatus: ExtractStatus = succeeded ? 'ok' : (lastFail ?? 'ok');
  const md = best.length > 0 ? best : null;
  return { contentMd: md, rawContent: md ? stripMarkdown(md) : null, extractStatus, title: bestTitle };
}

export async function extractArticle(input: ExtractInput): Promise<ExtractResult> {
  const { contentMd, rawContent, extractStatus, title } = await resolveContent(
    input.rawContent,
    input.url || null,
    input.reader,
  );
  return {
    rawContent,
    title,
    contentMd,
    extractStatus,
    contentType: 'article',
    transcriptStatus: 'na',
  };
}
