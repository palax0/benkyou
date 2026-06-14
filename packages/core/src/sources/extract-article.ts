import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { htmlToText } from '../util/text';
import type { ExtractInput, ExtractResult } from './types';

// Below this many chars of *plain text* (feed content is HTML-stripped first, so
// markup doesn't inflate the count) we assume the feed gave only a blurb and fetch
// the real article. Article-fetch failures degrade (keep what we had) rather than
// failing the stage — spec §6.2: pipeline continues even without full text.
const FULLTEXT_MIN_CHARS = 600;

export async function fetchReadable(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'benkyou/0.1 (+readability)' } });
    if (!res.ok) return null;
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const text = article?.textContent?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
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
