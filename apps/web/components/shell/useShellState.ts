'use client';

import { useEffect, useState } from 'react';
import { PALETTE_EVENT } from './commands';

function persist(name: 'bk_nav' | 'bk_rail', value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

export interface ShellState {
  collapsed: boolean;
  railHidden: boolean;
  drawerOpen: boolean;
  toggleNav: () => void;
  toggleRail: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export function useShellState(init: {
  navCollapsed: boolean;
  railHidden: boolean;
}): ShellState {
  const [collapsed, setCollapsed] = useState(init.navCollapsed);
  const [railHidden, setRailHidden] = useState(init.railHidden);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function toggleNav(): void {
    setCollapsed((prev) => {
      const next = !prev;
      persist('bk_nav', next ? 'collapsed' : 'expanded');
      return next;
    });
  }

  function toggleRail(): void {
    setRailHidden((prev) => {
      const next = !prev;
      persist('bk_rail', next ? 'hidden' : 'shown');
      return next;
    });
  }

  return {
    collapsed,
    railHidden,
    drawerOpen,
    toggleNav,
    toggleRail,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
  };
}

// Cmd/Ctrl-K opens the command palette from anywhere. Kept out of the view so
// the shell markup stays logic-free (polishable without touching behavior).
export function useCommandPaletteShortcut(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
