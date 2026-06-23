// Thin HTTP client for the anonymous-PoToken sidecar (bgutil-class provider, design §2).
// The worker hands the sidecar a visitor_data "content binding"; the sidecar runs
// BotGuard and returns a po_token. No retry/cache here — youtube-session owns lifecycle.

interface GetPotResponse {
  po_token?: string;
}

export async function fetchAnonymousPoToken(providerUrl: string, visitorData: string): Promise<string> {
  const base = providerUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/get_pot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content_binding: visitorData }),
  });
  if (!res.ok) throw new Error(`PoToken provider /get_pot failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as GetPotResponse;
  if (!json.po_token) throw new Error('PoToken provider response missing po_token');
  return json.po_token;
}

export async function pingPotokenSidecar(providerUrl: string): Promise<boolean> {
  const base = providerUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/ping`);
    return res.ok;
  } catch {
    return false;
  }
}
