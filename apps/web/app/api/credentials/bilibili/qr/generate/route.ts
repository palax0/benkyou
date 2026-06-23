import QRCode from 'qrcode';
import { generateBilibiliQr } from '@benkyou/core/sources';
import { requireApiAuth } from '@/lib/auth';

export async function POST(): Promise<Response> {
  const unauth = await requireApiAuth();
  if (unauth) return unauth;
  const { qrcodeKey, url } = await generateBilibiliQr();
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  return Response.json({ qrcodeKey, qrDataUrl });
}
