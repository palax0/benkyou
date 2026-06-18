'use client';

export const PASTE_EVENT = 'bk:open-paste';
export const PALETTE_EVENT = 'bk:open-palette';

export function openPaste(): void {
  window.dispatchEvent(new CustomEvent(PASTE_EVENT));
}
export function openPalette(): void {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}
