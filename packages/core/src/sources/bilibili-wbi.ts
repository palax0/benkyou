import { createHash } from 'node:crypto';

// Bilibili's fixed permutation of the 64-char (img+sub) key; take first 32 of the
// reordered string. Sourced from the public wbi scheme (SocialSisterYi/bilibili-API-collect).
const MIXIN_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9,
  42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0,
  1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

export function mixinKey(rawKey: string): string {
  let out = '';
  for (const idx of MIXIN_TABLE) {
    if (idx < rawKey.length) out += rawKey[idx];
    if (out.length >= 32) break;
  }
  return out.slice(0, 32);
}

const UNSAFE = /[!'()*]/g;

export function encodeWbi(
  params: Record<string, string | number>,
  mixin: string,
  wtsSeconds: number,
): Record<string, string> & { wts: string; w_rid: string } {
  const withTs: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) withTs[k] = String(v);
  withTs.wts = String(wtsSeconds);

  const query = Object.keys(withTs)
    .sort()
    .map((k) => {
      const val = String(withTs[k]).replace(UNSAFE, ''); // bilibili strips !'()* before signing
      return `${encodeURIComponent(k)}=${encodeURIComponent(val)}`;
    })
    .join('&');

  const w_rid = createHash('md5').update(query + mixin).digest('hex');
  return { ...withTs, wts: String(wtsSeconds), w_rid };
}
