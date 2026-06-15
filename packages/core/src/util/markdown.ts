import TurndownService from 'turndown';

// turndown v7 bundles a DOM (domino), so this runs server-side without jsdom.
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  return turndown.turndown(html).trim();
}

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
