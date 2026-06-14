import { describe, expect, test } from 'vitest';
import { htmlToMarkdown, stripMarkdown } from '../../src/util/markdown.js';

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
