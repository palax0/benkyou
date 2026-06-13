import localFont from 'next/font/local';

// Vendored variable fonts (latin subset only — CJK falls through to the system
// stacks declared in globals.css; shipping multi-MB CJK webfonts is not worth it
// for a self-hosted tool). Source pair harmonizes with Source Han / Noto CJK.
export const sourceSans = localFont({
  src: '../fonts/source-sans-3-latin.woff2',
  weight: '200 900',
  display: 'swap',
  variable: '--font-source-sans',
});

export const sourceSerif = localFont({
  src: '../fonts/source-serif-4-latin.woff2',
  weight: '200 900',
  display: 'swap',
  variable: '--font-source-serif',
});
