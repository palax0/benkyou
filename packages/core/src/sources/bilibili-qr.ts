import { upsertPlatformCredential } from './platform-credentials';

const GENERATE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const POLL_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';
const HEADERS = { 'user-agent': 'benkyou/0.1 (+https://github.com/benkyou)', referer: 'https://www.bilibili.com/' };

export interface QrGenerate { qrcodeKey: string; url: string; }
export type QrPollStatus = 'pending' | 'scanned' | 'success' | 'expired';
export interface QrPollResult { status: QrPollStatus; }

export function mapQrPollCode(code: number): QrPollStatus {
  switch (code) {
    case 0: return 'success';
    case 86090: return 'scanned';
    case 86038: return 'expired';
    default: return 'pending'; // 86101 not-scanned + any unknown transient code
  }
}

export function parseSessdataFromSetCookie(setCookie: string[]): { sessdata: string | null; expiresAt: number | null } {
  for (const c of setCookie) {
    const m = /(?:^|;\s*)SESSDATA=([^;]+)/.exec(c);
    if (!m) continue;
    // RFC 6265 §5.3: Max-Age (seconds-from-now) takes precedence over Expires when both present.
    const maxAge = /(?:^|;\s*)Max-Age=(-?\d+)/i.exec(c);
    const expires = /(?:^|;\s*)Expires=([^;]+)/i.exec(c);
    let expiresAt: number | null = null;
    if (maxAge) {
      expiresAt = Date.now() + Number(maxAge[1]) * 1000;
    } else if (expires) {
      const parsed = Date.parse(expires[1]!);
      expiresAt = Number.isFinite(parsed) ? parsed : null;
    }
    return { sessdata: m[1] ?? null, expiresAt };
  }
  return { sessdata: null, expiresAt: null };
}

export async function generateBilibiliQr(): Promise<QrGenerate> {
  const res = await fetch(GENERATE_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`bilibili qr generate failed: ${res.status}`);
  const json = (await res.json()) as { data?: { url?: string; qrcode_key?: string } };
  const url = json.data?.url;
  const qrcodeKey = json.data?.qrcode_key;
  if (!url || !qrcodeKey) throw new Error('bilibili qr generate: missing url/qrcode_key');
  return { qrcodeKey, url };
}

export async function pollBilibiliQr(qrcodeKey: string): Promise<QrPollResult> {
  const res = await fetch(`${POLL_URL}?qrcode_key=${encodeURIComponent(qrcodeKey)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`bilibili qr poll failed: ${res.status}`);
  const json = (await res.json()) as { data?: { code?: number } };
  const status = mapQrPollCode(json.data?.code ?? -1);
  if (status === 'success') {
    // undici exposes split cookies via getSetCookie(); fall back to a single header.
    const setCookie = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
    const { sessdata, expiresAt } = parseSessdataFromSetCookie(setCookie);
    if (!sessdata) throw new Error('bilibili qr success but no SESSDATA in Set-Cookie');
    await upsertPlatformCredential('bilibili', { secret: sessdata, meta: { expiresAt } });
  }
  return { status };
}
