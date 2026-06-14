import TurndownService from 'turndown';

// turndown v7 bundles a DOM (domino), so this runs server-side without jsdom.
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  return turndown.turndown(html).trim();
}
