import { describe, expect, test } from 'vitest';
import { htmlToText, truncateChars } from '../../src/util/text.js';

describe('truncateChars', () => {
  test('returns empty string for null/undefined', () => {
    expect(truncateChars(null, 10)).toBe('');
    expect(truncateChars(undefined, 10)).toBe('');
  });

  test('truncates beyond max', () => {
    expect(truncateChars('abcdef', 3)).toBe('abc');
    expect(truncateChars('abc', 10)).toBe('abc');
  });
});

describe('htmlToText', () => {
  test('strips tags, keeping the text', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  test('passes plain text through unchanged', () => {
    expect(htmlToText('Just plain text.')).toBe('Just plain text.');
  });

  test('separates block elements so words do not concatenate', () => {
    const text = htmlToText('<p>First paragraph.</p><p>Second paragraph.</p>');
    expect(text).toContain('First paragraph.');
    expect(text).toContain('Second paragraph.');
    expect(text).not.toContain('paragraph.Second');
  });

  test('drops script and style content', () => {
    const text = htmlToText('<style>.a{color:red}</style><p>Body</p><script>alert(1)</script>');
    expect(text).toBe('Body');
  });

  test('decodes entities', () => {
    expect(htmlToText('<p>a &amp; b &lt;tag&gt;</p>')).toBe('a & b <tag>');
  });

  test('collapses excessive blank lines', () => {
    const text = htmlToText('<p>a</p><br><br><br><p>b</p>');
    expect(text).not.toMatch(/\n{3,}/);
  });
});
