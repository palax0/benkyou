import type { SVGProps } from 'react';

// One coherent set: 20px viewBox, 1.5 stroke, round caps. Decorative by default
// (aria-hidden); accessible names live on the wrapping control.
function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props,
  } as const;
}

export function FeedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3.5" width="14" height="13" rx="2" />
      <path d="M6.5 7.5h7M6.5 10.5h7M6.5 13.5h4" />
    </svg>
  );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.2 13.2 3.8 3.8" />
    </svg>
  );
}

export function SourcesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 11.5a4.5 4.5 0 0 1 4.5 4.5M4 7.5a8.5 8.5 0 0 1 8.5 8.5" />
      <circle cx="4.75" cy="15.25" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PipelineIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 10h3l2-4.5 3 9 2-4.5h5" />
    </svg>
  );
}

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h12M4 10h12M4 14h12" />
      <circle cx="7.5" cy="6" r="1.75" fill="var(--bg)" />
      <circle cx="12.5" cy="10" r="1.75" fill="var(--bg)" />
      <circle cx="9" cy="14" r="1.75" fill="var(--bg)" />
    </svg>
  );
}

export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
    </svg>
  );
}

export function CollapseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3.5" width="14" height="13" rx="2" />
      <path d="M7.5 3.5v13M13 8.5 11.5 10l1.5 1.5" />
    </svg>
  );
}

export function ExpandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3.5" width="14" height="13" rx="2" />
      <path d="M7.5 3.5v13M11.5 8.5 13 10l-1.5 1.5" />
    </svg>
  );
}

export function RailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3.5" width="14" height="13" rx="2" />
      <path d="M12.5 3.5v13" />
    </svg>
  );
}

export function LogoutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12.5 6.5v-1a2 2 0 0 0-2-2h-5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2v-1" />
      <path d="M8.5 10h8m0 0-2.5-2.5M16.5 10 14 12.5" />
    </svg>
  );
}

// Content-type glyphs for the feed — same 20px/1.5-stroke family as the nav set.
export function ArticleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M5.5 3.5h5l4 4v8a1.5 1.5 0 0 1-1.5 1.5h-7.5A1.5 1.5 0 0 1 4 15.5v-10A1.5 1.5 0 0 1 5.5 3.5Z" />
      <path d="M10.5 3.5v3.5a1 1 0 0 0 1 1H14" />
      <path d="M6.75 11.5h6.5M6.75 14h4" />
    </svg>
  );
}

export function VideoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4.5" width="14" height="11" rx="2" />
      <path d="M8.5 7.75 12.25 10 8.5 12.25Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function DiscussionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H5.5A1.5 1.5 0 0 1 4 11.5Z" />
      <path d="M7.5 8.25h5M7.5 10.5h3" />
    </svg>
  );
}

export function PaperIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="4.5" y="3" width="11" height="14" rx="1.5" />
      <path d="M8 6.5h4M7 9.25h6M7 11.75h6M7 14.25h3.5" />
    </svg>
  );
}

export function BookmarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h5A1.5 1.5 0 0 1 14 4.5V17l-4-2.75L6 17Z" />
    </svg>
  );
}
