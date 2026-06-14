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
