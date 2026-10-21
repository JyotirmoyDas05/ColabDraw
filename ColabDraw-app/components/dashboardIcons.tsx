import type { ReactElement } from "react";

const svg = (children: ReactElement) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const GridIcon = svg(
  <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 10h16M10 10v10" />
  </>,
);

export const LockIcon = svg(
  <>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
);

export const PinIcon = svg(
  <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 14v6" />,
);

export const ImportIcon = svg(
  <>
    <path d="M4 12h11M11 8l4 4-4 4" />
    <path d="M20 5v14" />
  </>,
);

export const NewSceneIcon = svg(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
    <path d="M14 3v5h5M12 11v6M9 14h6" />
  </>,
);

export const SidebarIcon = svg(
  <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9 4v16" />
  </>,
);

export const ChevronLeftIcon = svg(<path d="M15 6l-6 6 6 6" />);

export const SortIcon = svg(
  <path d="M8 5v14M5 16l3 3 3-3M16 19V5M13 8l3-3 3 3" />,
);

export const ChevronRightIcon = svg(<path d="M9 6l6 6-6 6" />);

export const CloseIcon = svg(<path d="M6 6l12 12M18 6L6 18" />);

/** the sidebar button while the sidebar is open: a panel with an arrow pointing it shut */
export const SidebarCloseIcon = svg(
  <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9 4v16M16 9l-3 3 3 3" />
  </>,
);

export const DownloadIcon = svg(<path d="M12 4v11M7 11l5 5 5-5M5 20h14" />);
