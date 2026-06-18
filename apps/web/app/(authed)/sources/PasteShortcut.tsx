'use client';

import { useTranslations } from 'next-intl';
import { openPaste } from '@/components/shell/commands';

export function PasteShortcut() {
  const t = useTranslations('sources');
  return (
    <button
      type="button"
      onClick={openPaste}
      className="rounded-md border border-line px-3 py-1.5 text-sm text-ink transition-colors duration-150 hover:bg-ink/5 motion-reduce:transition-none"
    >
      {t('pasteUrl')}
    </button>
  );
}
