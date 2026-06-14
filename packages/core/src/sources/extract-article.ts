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

export async function resolveContent(
  rawContent: string | null,
  url: string | null,
): Promise<string> {
  let content = htmlToText(rawContent ?? '');
  if (content.length < FULLTEXT_MIN_CHARS && url) {
    const fetched = await fetchReadable(url);
    if (fetched && fetched.length > content.length) content = fetched;
  }
  return content;
}

export async function extractArticle(input: ExtractInput): Promise<ExtractResult> {
  const content = await resolveContent(input.rawContent, input.url);
  return {
    rawContent: content.length > 0 ? content : null,
    contentType: 'article',
    transcriptStatus: 'na',
  };
}
