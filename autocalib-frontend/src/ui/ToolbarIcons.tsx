import type { SVGAttributes } from 'react';
import styles from './ToolbarIcons.module.css';

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

type SvgProps = SVGAttributes<SVGSVGElement>;

function Svg({ size = 16, ...rest }: SvgProps & { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      {...rest}
    />
  );
}

/** Play / run / launch */
export function IconPlay(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path
        d="M10 8.5v7l5.5-3.5L10 8.5z"
        fill="currentColor"
        stroke="none"
      />
    </Svg>
  );
}

/** Indeterminate progress (replaces hourglass emoji) */
export function IconLoader({ className, ...rest }: SvgProps & { size?: number }) {
  return (
    <Svg className={[styles.spinner, className].filter(Boolean).join(' ')} {...rest}>
      <circle cx="12" cy="12" r="9" {...stroke} strokeOpacity={0.25} />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        {...stroke}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Save session / persist */
export function IconSave(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path d="M6 3h10l4 4v14H6V3z" {...stroke} />
      <path d="M6 3v6h10" {...stroke} />
      <rect x="8" y="14" width="8" height="5" rx="1" {...stroke} />
    </Svg>
  );
}

/** Eraser — single-click slot removal */
export function IconEraser(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path d="M20 20H8L3 15l9-9 7 7-5 5" {...stroke} />
      <path d="M12 6l6 6" {...stroke} />
    </Svg>
  );
}

/** Freehand lasso selection */
export function IconLasso(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path
        d="M4 8c2-4 8-4 10 0s-2 8-6 10-6-2-4-10z"
        {...stroke}
        fill="none"
        strokeDasharray="3 2"
      />
      <circle cx="18" cy="6" r="2" {...stroke} />
    </Svg>
  );
}

/** Bulk delete slots (Absolute Map — trash = remove many geometries) */
export function IconTrash(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" {...stroke} />
      <path d="M10 11v6M14 11v6" {...stroke} />
    </Svg>
  );
}

/** Remove selected calibration bboxes — distinct from map bulk delete semantics */
export function IconRemoveCalibSelection(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" {...stroke} />
      <path d="M8 12h8" {...stroke} />
    </Svg>
  );
}

/** Zone unpair — break pairing links in a zone (links only, no asset deletion). */
export function IconZoneUnpair(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path d="M4 10 12 13 20 10 12 7 4 10z" {...stroke} />
      <path d="M5 13.5 12 16.5 19 13.5" {...stroke} />
      <path d="m8 17 10-11" {...stroke} />
    </Svg>
  );
}

/** Lock selected items */
export function IconLock(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" {...stroke} />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" {...stroke} />
    </Svg>
  );
}

export function IconUnlock(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" {...stroke} />
      <path d="M8 11V8a4 4 0 0 1 7.2-2" {...stroke} />
    </Svg>
  );
}

/** Pair / link */
export function IconLink(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1" {...stroke} />
      <path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1" {...stroke} />
    </Svg>
  );
}

/** Unpair / cut */
export function IconScissors(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <circle cx="6" cy="7" r="2.5" {...stroke} />
      <circle cx="6" cy="17" r="2.5" {...stroke} />
      <path d="m14 6 6 11M14 17 20 6" {...stroke} />
    </Svg>
  );
}

/** Auto-suggest / quick action */
export function IconBolt(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path d="M13 10V3L4 14h7v7l9-11h-7z" {...stroke} />
    </Svg>
  );
}

/** Polygon ROI outline (pentagon-ish) */
export function IconRoiPolygon(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path d="M12 3 20 9.5 17 19H7l-3-9.5L12 3z" {...stroke} />
    </Svg>
  );
}

/** Confirm / saved */
export function IconCheck(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path d="M5 12.5 9.5 17 19 7" {...stroke} />
    </Svg>
  );
}

/** Image zone tool (bounding square) */
export function IconSquareFrame(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <rect x="5" y="5" width="14" height="14" rx="1.5" {...stroke} />
    </Svg>
  );
}

/** Map zone tool (selection diamond) */
export function IconDiamond(props: SvgProps & { size?: number }) {
  return (
    <Svg {...props}>
      <path d="M12 5 19 12 12 19 5 12 12 5z" {...stroke} />
    </Svg>
  );
}
