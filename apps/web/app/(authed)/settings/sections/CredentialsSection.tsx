'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CredentialStatus } from '@benkyou/core/sources';

type QrState =
  | { phase: 'idle' }
  | { phase: 'active'; qrDataUrl: string; status: 'pending' | 'scanned' }
  | { phase: 'success' }
  | { phase: 'expired' }
  | { phase: 'error'; message: string };

function useBilibiliQr() {
  const [state, setState] = useState<QrState>({ phase: 'idle' });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = useCallback(() => { if (timer.current) clearInterval(timer.current); timer.current = null; }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    stop();
    try {
      const res = await fetch('/api/credentials/bilibili/qr/generate', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const { qrcodeKey, qrDataUrl } = (await res.json()) as { qrcodeKey: string; qrDataUrl: string };
      setState({ phase: 'active', qrDataUrl, status: 'pending' });
      timer.current = setInterval(async () => {
        try {
          const p = await fetch(`/api/credentials/bilibili/qr/poll?key=${encodeURIComponent(qrcodeKey)}`);
          if (!p.ok) throw new Error(String(p.status));
          const { status } = (await p.json()) as { status: 'pending' | 'scanned' | 'success' | 'expired' };
          if (status === 'success') { stop(); setState({ phase: 'success' }); }
          else if (status === 'expired') { stop(); setState({ phase: 'expired' }); }
          else setState((s) => (s.phase === 'active' ? { ...s, status } : s));
        } catch (e) {
          stop();
          setState({ phase: 'error', message: e instanceof Error ? e.message : 'error' });
        }
      }, 2000);
    } catch (e) {
      stop();
      setState({ phase: 'error', message: e instanceof Error ? e.message : 'error' });
    }
  }, [stop]);

  return { state, start };
}

const STATUS_CLASS: Record<string, string> = {
  valid: 'text-accent', expired: 'text-err', unset: 'text-muted', auto: 'text-accent', off: 'text-muted',
};

export function CredentialsSection({ status }: { status: CredentialStatus }) {
  const t = useTranslations('credentials');
  const { state, start } = useBilibiliQr();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink">{t('youtubeLabel')}</span>
        <span className={STATUS_CLASS[status.youtube]}>{t(`youtube.${status.youtube}` as 'youtube.auto')}</span>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-ink">{t('bilibiliLabel')}</span>
          <span className={STATUS_CLASS[status.bilibili]}>{t(`bilibili.${status.bilibili}` as 'bilibili.valid')}</span>
          <button type="button" onClick={start} className="rounded-md bg-accent-vivid px-3 py-1 text-bg">
            {t('scanButton')}
          </button>
        </div>
        {state.phase === 'active' ? (
          <div className="flex flex-col gap-1">
            {/* qrDataUrl is a self-generated data: URI (server-side qrcode), not remote */}
            <img src={state.qrDataUrl} alt={t('qrAlt')} width={220} height={220} />
            <span className="text-muted">{t(`qr.${state.status}` as 'qr.pending')}</span>
          </div>
        ) : null}
        {state.phase === 'success' ? <span className="text-accent">{t('qr.success')}</span> : null}
        {state.phase === 'expired' ? <span className="text-err">{t('qr.expired')}</span> : null}
        {state.phase === 'error' ? <span className="text-err">{t('qr.error', { message: state.message })}</span> : null}
      </div>
    </div>
  );
}
