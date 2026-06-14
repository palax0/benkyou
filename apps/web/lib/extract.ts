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
