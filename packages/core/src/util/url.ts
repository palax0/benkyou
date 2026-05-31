import { createHash } from 'node:crypto';

// Query keys considered tracking noise and dropped before hashing.
const TRACKING = /^(utm_.*|fbclid|gclid|mc_eid|mc_cid|ref|ref_src|igshid)$/i;

export function normalizeUrl(input: string): string {
  const u = new URL(input);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();

  const kept: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams) {
    if (!TRACKING.test(k)) kept.push([k, v]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // Rebuild search deterministically.
  const search = new URLSearchParams();
  for (const [k, v] of kept) search.append(k, v);
  u.search = search.toString();

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

export function urlHash(input: string): string {
  return createHash('sha256').update(normalizeUrl(input)).digest('hex');
}
