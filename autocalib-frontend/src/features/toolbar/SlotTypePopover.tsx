import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import type { ParkingSlotType, Slot } from '../../types';
import { PARKING_SLOT_TYPE_OPTGROUP_DEFS, SLOT_TYPE_COLORS } from '../../theme/slotTypes';
import styles from './SlotTypePopover.module.css';

const MIXED_TYPES_SWATCH = '#9ca3af';

export interface SlotTypePopoverProps {
  anchor: { clientX: number; clientY: number };
  slots: Slot[];
  onPickType: (type: ParkingSlotType) => void;
  onDismiss: () => void;
}

export function SlotTypePopover({
  anchor,
  slots,
  onPickType,
  onDismiss,
}: SlotTypePopoverProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.clientX + 12, top: anchor.clientY + 12 });

  const slotCount = slots.length;
  const selectId = `slot-type-popover-${slots[0]?.slot_id.slice(0, 8) ?? 'bulk'}`;

  const { currentType, hasMixedTypes } = useMemo(() => {
    if (slots.length === 0) {
      return { currentType: 'common' as ParkingSlotType, hasMixedTypes: false };
    }
    const types = new Set(slots.map((s) => s.slot_type ?? 'common'));
    if (types.size === 1) {
      return { currentType: [...types][0]!, hasMixedTypes: false };
    }
    return { currentType: 'common' as ParkingSlotType, hasMixedTypes: true };
  }, [slots]);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 10;
    let left = anchor.clientX + 14;
    let top = anchor.clientY + 14;
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad;
    }
    left = Math.max(pad, left);
    top = Math.max(pad, top);
    setPosition({ left, top });
  }, [anchor.clientX, anchor.clientY, slotCount, hasMixedTypes]);

  const swatchColor = hasMixedTypes ? MIXED_TYPES_SWATCH : SLOT_TYPE_COLORS[currentType];
  const selectValue = hasMixedTypes ? '' : currentType;

  const pop = (
    <div
      ref={panelRef}
      className={styles.popover}
      style={{ left: position.left, top: position.top }}
      role="dialog"
      aria-labelledby={`${selectId}-title`}
      aria-modal="false"
    >
      <div className={styles.head}>
        <span id={`${selectId}-title`} className={styles.title}>
          {slotCount > 1
            ? t('slotTypePopover.titleMultiple', { count: slotCount })
            : t('slotTypePopover.title')}
        </span>
        <button
          type="button"
          className={styles.close}
          onClick={onDismiss}
          aria-label={t('slotTypePopover.closeAria')}
        >
          ×
        </button>
      </div>

      <p className={styles.hint}>
        <span
          className={styles.swatch}
          style={{ backgroundColor: swatchColor }}
          aria-hidden
        />
        {t('slotTypePopover.hint')}
      </p>

      <label htmlFor={selectId} className={styles.label}>
        {t('slotTypePopover.category')}
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={selectValue}
        autoFocus
        onChange={(e) => {
          onPickType(e.target.value as ParkingSlotType);
        }}
      >
        {hasMixedTypes && (
          <option value="" disabled>
            {t('slotTypePopover.mixedTypes')}
          </option>
        )}
        {PARKING_SLOT_TYPE_OPTGROUP_DEFS.map((group) => (
          <optgroup key={group.labelKey} label={t(group.labelKey)}>
            {group.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );

  return createPortal(pop, document.body);
}
