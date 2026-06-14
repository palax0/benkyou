import type { FetchOutcome } from './types';

// Jina convention: GET {base}/{targetUrl}, optional Bearer. Returns markdown.
// Never throws — maps every failure to a FetchOutcome reason (design §5.1).
export async function fetchViaReader(
  url: string,
  cfg: { baseUrl: string; apiKey?: string },
): Promise<FetchOutcome> {
  const base = cfg.baseUrl.replace(/\/+$/, ''); // drop trailing slash(es)
  const target = `${base}/${url}`; // Jina accepts a bare URL appended; query string kept as-is
  const headers: Record<string, string> = { accept: 'text/markdown, text/plain, */*' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`; // empty Bearer is rejected by some gateways

  let res: Response;
  try {
    res = await fetch(target, { headers });
  } catch {
    return { ok: false, reason: 'fetch_failed' };
  }
  if (res.status === 403 || res.headers.has('cf-mitigated')) return { ok: false, reason: 'blocked' };
  if (!res.ok) return { ok: false, reason: 'fetch_failed' };
  const markdown = (await res.text()).trim();
  if (markdown.length === 0) return { ok: false, reason: 'empty_parse' };
  return { ok: true, markdown };
}
