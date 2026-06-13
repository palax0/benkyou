'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FeedIcon, PipelineIcon, SearchIcon, SettingsIcon, SourcesIcon } from './icons';

const ITEMS = [
  { key: 'feed', href: '/', icon: FeedIcon, exact: true },
  { key: 'search', href: '/search', icon: SearchIcon, exact: false },
  { key: 'sources', href: '/sources', icon: SourcesIcon, exact: false },
  { key: 'jobs', href: '/admin/jobs', icon: PipelineIcon, exact: false },
  { key: 'settings', href: '/settings', icon: SettingsIcon, exact: false },
] as const;

export function NavList({
  collapsed,
  onNavigate,
  showShortcut = true,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  showShortcut?: boolean;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  // Shortcut hint is platform-dependent; render it only after mount to avoid a
  // server/client mismatch on `navigator`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const cmdKey = mounted && /Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl+';

  return (
    <ul className="flex flex-col gap-1">
      {ITEMS.map(({ key, href, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <li key={key}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? t(key) : undefined}
              className={`flex h-9 items-center gap-2.5 rounded-md text-sm whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none ${
                collapsed ? 'justify-center px-0' : 'px-2.5'
              } ${
                active
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-muted hover:bg-ink/5 hover:text-ink'
              }`}
            >
              <Icon className="shrink-0" />
              {!collapsed && <span className="truncate">{t(key)}</span>}
              {!collapsed && showShortcut && key === 'search' && mounted && (
                <kbd className="ml-auto font-sans text-xs text-faint">{cmdKey}K</kbd>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
