import { JSDOM } from 'jsdom';

export function truncateChars(input: string | null | undefined, max: number): string {
  if (!input) return '';
  return input.length <= max ? input : input.slice(0, max);
}

/**
 * HTML → plain text. textContent alone would concatenate adjacent blocks
 * ("</p><p>" → words glued together), so block-closing tags get a newline
 * injected before parsing.
 */
export function htmlToText(html: string): string {
  if (!/[<&]/.test(html)) return html.trim();
  const withBreaks = html.replace(/<(?:br|hr|\/p|\/div|\/li|\/h[1-6]|\/tr|\/blockquote|\/pre)\b[^>]*>/gi, '$&\n');
  const dom = new JSDOM(withBreaks);
  const body = dom.window.document.body;
  body.querySelectorAll('script,style,noscript,template').forEach((el) => el.remove());
  return (body.textContent ?? '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
