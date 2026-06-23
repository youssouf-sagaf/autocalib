import type { ParkingSlotType, Slot } from '../types';

/**
 * Cocopilot / Cocoparks product colors for parking slot categories
 * (see Cocopilot-FE `src/utils/constants/colors.ts` — SLOT_COLORS).
 */
export const SLOT_TYPE_COLORS = {
  common: '#004595',
  forbidden: '#ff0000',
  evh: '#ffd800',
  pmr: '#0094ff',
  scooter: '#808080',
  bike: '#449424',
  bus_stop: '#6e229f',
  taxi: '#6e229f',
  delivery_dotted: '#ff6a00',
  delivery_only: '#7f3300',
  short_duration: '#21007f',
  to_delete: '#000000',
  trolley: '#17C3B2',
  pole: '#A799B7',
} as const satisfies Record<ParkingSlotType, string>;

/** Mapbox `icon-image` id for a parking slot type (epingle / pin marker). */
export function parkingSlotIconImageId(type: ParkingSlotType): string {
  return `parking-slot-${type}`;
}

/** Mapbox `icon-size` for parking pins (Absmap + pairing maps). */
export const SLOT_MARKER_ICON_SIZE = {
  default: 1.7,
  hover: 2.1,
  selected: 2.8,
  existing: 1.5,
  pending: 2,
} as const;

/** Invisible hit circles under pins — scale with icon-size. */
export const SLOT_MARKER_HIT_RADIUS = 28;

/** Same pin geometry as the original static marker; `fillColor` tints the body. */
export function parkingPinSvg(fillColor: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z" fill="${fillColor}"/>
  <circle cx="14" cy="13" r="9" fill="${fillColor}"/>
  <text x="14" y="17.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="15" fill="white">P</text>
</svg>`;
}

/** Mapbox GL `icon-image` expression: `slot_type` feature property → image id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SLOT_TYPE_ICON_IMAGE: any = (() => {
  const expr: unknown[] = ['match', ['get', 'slot_type']];
  for (const key of Object.keys(SLOT_TYPE_COLORS) as ParkingSlotType[]) {
    expr.push(key, parkingSlotIconImageId(key));
  }
  expr.push(parkingSlotIconImageId('common'));
  return expr;
})();

/** Grouped slot-type picker defs — labels via `t(option.labelKey)` / `t(group.labelKey)`. */
export const PARKING_SLOT_TYPE_OPTGROUP_DEFS: {
  labelKey: string;
  options: { value: ParkingSlotType; labelKey: string }[];
}[] = [
  {
    labelKey: 'slotTypes.groups.commonPlaces',
    options: [
      { value: 'common', labelKey: 'slotTypes.common' },
      { value: 'short_duration', labelKey: 'slotTypes.short_duration' },
    ],
  },
  {
    labelKey: 'slotTypes.groups.accessibility',
    options: [
      { value: 'pmr', labelKey: 'slotTypes.pmr' },
      { value: 'evh', labelKey: 'slotTypes.evh' },
      { value: 'bike', labelKey: 'slotTypes.bike' },
      { value: 'scooter', labelKey: 'slotTypes.scooter' },
    ],
  },
  {
    labelKey: 'slotTypes.groups.regulation',
    options: [
      { value: 'forbidden', labelKey: 'slotTypes.forbidden' },
      { value: 'delivery_dotted', labelKey: 'slotTypes.delivery_dotted' },
      { value: 'delivery_only', labelKey: 'slotTypes.delivery_only' },
    ],
  },
  {
    labelKey: 'slotTypes.groups.network',
    options: [
      { value: 'bus_stop', labelKey: 'slotTypes.bus_stop' },
      { value: 'taxi', labelKey: 'slotTypes.taxi' },
    ],
  },
  {
    labelKey: 'slotTypes.groups.technical',
    options: [
      { value: 'trolley', labelKey: 'slotTypes.trolley' },
      { value: 'pole', labelKey: 'slotTypes.pole' },
      { value: 'to_delete', labelKey: 'slotTypes.to_delete' },
    ],
  },
];

/** B2B / Cocopilot may send `standard` — map it to the common pin sprite. */
export function slotTypeForMapIcon(slotType: string | undefined): ParkingSlotType {
  if (!slotType || slotType === 'standard') return 'common';
  if (slotType in SLOT_TYPE_COLORS) return slotType as ParkingSlotType;
  return 'common';
}

export function normalizeSlotParkingType(slot: Slot): Slot {
  return { ...slot, slot_type: slotTypeForMapIcon(slot.slot_type) };
}
