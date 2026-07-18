// Inline stroke icons. Emoji were previously used as UI glyphs, which render
// as a different picture on every platform, stay multicolour against the paper
// palette, and can't take the accent colour when a tab is selected. These are
// drawn on a 24px grid, inherit `currentColor`, and ship inside the bundle so
// the app stays offline.

export type IconName =
  | 'library'
  | 'collections'
  | 'settings'
  | 'search'
  | 'marks'
  | 'annotate'
  | 'outline'
  | 'columns'
  | 'back'
  | 'close'
  | 'more'
  | 'plus'
  | 'minus'
  | 'note'
  | 'area'
  | 'zoomIn'

interface IconProps {
  name: IconName
  /** Rendered size in px; defaults to 24. */
  size?: number
  className?: string
  /** Fills the shape instead of stroking it — used for selected tabs. */
  filled?: boolean
}

const PATHS: Record<IconName, React.JSX.Element> = {
  library: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M9 4h4.5A1.5 1.5 0 0 1 15 5.5v13a1.5 1.5 0 0 1-1.5 1.5H9z" />
      <path d="m16.5 5.8 2.2-.5a1 1 0 0 1 1.2.8l2 12.3a1 1 0 0 1-.8 1.1l-1.9.4" />
    </>
  ),
  collections: (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5z" />
      <path d="M7 6V4.8A.8.8 0 0 1 7.8 4h4.4l1.8 2.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="m15.6 15.6 4.4 4.4" />
    </>
  ),
  marks: (
    <>
      <path d="M6 4.5h12a1 1 0 0 1 1 1V20l-7-3.6L5 20V5.5a1 1 0 0 1 1-1z" />
    </>
  ),
  annotate: (
    <>
      <path d="m4.5 19.5.6-3.4L15.7 5.5a1.6 1.6 0 0 1 2.3 0l.5.5a1.6 1.6 0 0 1 0 2.3L7.9 18.9z" />
      <path d="m14.5 6.8 2.7 2.7" />
    </>
  ),
  outline: (
    <>
      <path d="M4.5 6.5h15M7.5 12h12M10.5 17.5h9" />
    </>
  ),
  columns: (
    <>
      <rect x="4" y="4.5" width="7" height="15" rx="1.2" />
      <rect x="13" y="4.5" width="7" height="15" rx="1.2" />
    </>
  ),
  back: <path d="m14.5 5.5-7 6.5 7 6.5" />,
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  note: (
    <>
      <path d="M6.5 3.8h11a1.5 1.5 0 0 1 1.5 1.5v10.2l-5 5H6.5A1.5 1.5 0 0 1 5 19V5.3a1.5 1.5 0 0 1 1.5-1.5z" />
      <path d="M19 15.5h-4a1 1 0 0 0-1 1v4" />
    </>
  ),
  area: <rect x="4.5" y="6" width="15" height="12" rx="1.4" strokeDasharray="3 2.4" />,
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="m15.6 15.6 4.4 4.4M11 8.6v4.8M8.6 11h4.8" />
    </>
  )
}

export function Icon({ name, size = 24, className, filled }: IconProps): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
