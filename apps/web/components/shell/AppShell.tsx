'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NavList } from './NavList';
import { LocaleSwitcher } from './LocaleSwitcher';
import { useGlobalSearchShortcut, useShellState } from './useShellState';
import { LogoutButton } from '@/components/LogoutButton';
import { CloseIcon, CollapseIcon, ExpandIcon, MenuIcon, RailIcon } from './icons';

function Wordmark({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className={`flex items-center gap-2.5 rounded-md ${compact ? 'justify-center' : 'px-1'}`}
    >
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-soft font-serif text-lg leading-none text-accent-vivid"
      >
        勉
      </span>
      {!compact && (
        <span className="font-serif text-lg font-semibold tracking-tight text-ink">Benkyou</span>
      )}
    </Link>
  );
}

function MobileDrawer({
  open,
  onClose,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 h-dvh max-h-none w-(--drawer-w) max-w-(--drawer-max-w) -translate-x-full bg-surface-2 text-ink transition-transform duration-300 ease-out backdrop:bg-ink/25 open:translate-x-0 starting:open:-translate-x-full motion-reduce:transition-none"
    >
      {children}
    </dialog>
  );
}

export function AppShell({
  initialNavCollapsed,
  initialRailHidden,
  rail,
  children,
}: {
  initialNavCollapsed: boolean;
  initialRailHidden: boolean;
  rail: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('shell');
  const { collapsed, railHidden, drawerOpen, toggleNav, toggleRail, openDrawer, closeDrawer } =
    useShellState({ navCollapsed: initialNavCollapsed, railHidden: initialRailHidden });
  useGlobalSearchShortcut();

  return (
    <div className="flex min-h-dvh">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-toast focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        {t('skipToContent')}
      </a>

      {/* Desktop nav — spec §9.2: 60px collapsed / 220px expanded */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-line bg-surface-2 py-4 transition-[width] duration-200 ease-out lg:flex motion-reduce:transition-none ${
          collapsed ? 'w-(--nav-w-collapsed) px-2.5' : 'w-(--nav-w) px-3'
        }`}
      >
        <div className="mb-6">
          <Wordmark compact={collapsed} />
        </div>
        <nav aria-label={t('mainNav')} className="flex-1">
          <NavList collapsed={collapsed} />
        </nav>
        <button
          type="button"
          onClick={toggleNav}
          title={collapsed ? t('expandNav') : t('collapseNav')}
          aria-label={collapsed ? t('expandNav') : t('collapseNav')}
          aria-expanded={!collapsed}
          className={`flex h-9 items-center gap-2.5 rounded-md text-sm whitespace-nowrap text-faint transition-colors duration-150 hover:bg-ink/5 hover:text-ink motion-reduce:transition-none ${
            collapsed ? 'justify-center px-0' : 'px-2.5'
          }`}
        >
          {collapsed ? <ExpandIcon className="shrink-0" /> : <CollapseIcon className="shrink-0" />}
          {!collapsed && <span className="truncate">{t('collapseNav')}</span>}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-sticky flex h-12 shrink-0 items-center gap-1 border-b border-line bg-bg px-3 lg:px-5">
          <button
            type="button"
            onClick={openDrawer}
            title={t('openMenu')}
            aria-label={t('openMenu')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink lg:hidden motion-reduce:transition-none"
          >
            <MenuIcon />
          </button>
          <div className="lg:hidden">
            <Wordmark compact />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <button
              type="button"
              onClick={toggleRail}
              title={railHidden ? t('showRail') : t('hideRail')}
              aria-label={railHidden ? t('showRail') : t('hideRail')}
              aria-pressed={!railHidden}
              className="hidden h-8 w-8 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink xl:inline-flex motion-reduce:transition-none"
            >
              <RailIcon />
            </button>
            <LogoutButton />
          </div>
        </header>

        <div className="flex flex-1">
          <div id="content" className="min-w-0 flex-1 px-4 py-6 lg:px-8">
            <div className="mx-auto w-full max-w-3xl">{children}</div>
          </div>
          {!railHidden && (
            <aside
              aria-label={t('contextRail')}
              className="sticky top-12 hidden max-h-(--rail-max-h) w-(--rail-w) shrink-0 self-start overflow-y-auto border-l border-line px-5 py-6 xl:block"
            >
              {rail}
            </aside>
          )}
        </div>
      </div>

      <MobileDrawer open={drawerOpen} onClose={closeDrawer} label={t('mainNav')}>
        <div className="flex h-full flex-col p-4">
          <div className="mb-6 flex items-center justify-between">
            <Wordmark onNavigate={closeDrawer} />
            <button
              type="button"
              onClick={closeDrawer}
              title={t('closeMenu')}
              aria-label={t('closeMenu')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink motion-reduce:transition-none"
            >
              <CloseIcon />
            </button>
          </div>
          <nav aria-label={t('mainNav')}>
            <NavList collapsed={false} showShortcut={false} onNavigate={closeDrawer} />
          </nav>
        </div>
      </MobileDrawer>
    </div>
  );
}
