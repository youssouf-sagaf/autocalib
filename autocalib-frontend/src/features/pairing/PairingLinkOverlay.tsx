import { useMemo } from 'react';
import { useAbsmapDisplaySlots } from '../../hooks/useAbsmapDisplaySlots';
import { useAppSelector } from '../../store/hooks';
import type { CalibBbox, Slot } from '../../types';
import { visibleCalibBboxes } from '../../utils/calibVisibility';
import styles from './PairingLinkOverlay.module.css';

interface PairingLinkOverlayProps {
  mapPanelRef: React.RefObject<HTMLDivElement | null>;
  imagePanelRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function getSlotScreenPos(
  slot: Slot,
  slots: Slot[],
  panelEl: HTMLDivElement,
  containerEl: HTMLDivElement,
): { x: number; y: number } | null {
  if (slots.length === 0) return null;
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const s of slots) {
    minLng = Math.min(minLng, s.center.lng);
    maxLng = Math.max(maxLng, s.center.lng);
    minLat = Math.min(minLat, s.center.lat);
    maxLat = Math.max(maxLat, s.center.lat);
  }
  const padLng = (maxLng - minLng) * 0.15 || 0.0005;
  const padLat = (maxLat - minLat) * 0.15 || 0.0005;
  minLng -= padLng; maxLng += padLng; minLat -= padLat; maxLat += padLat;

  const panelRect = panelEl.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();
  const w = panelRect.width;
  const h = panelRect.height;

  const px = ((slot.center.lng - minLng) / (maxLng - minLng)) * w;
  const py = (1 - (slot.center.lat - minLat) / (maxLat - minLat)) * h;

  return {
    x: panelRect.left - containerRect.left + px,
    y: panelRect.top - containerRect.top + py,
  };
}

function getBboxScreenPos(
  bbox: CalibBbox,
  allBboxes: CalibBbox[],
  panelEl: HTMLDivElement,
  containerEl: HTMLDivElement,
): { x: number; y: number } | null {
  if (allBboxes.length === 0) return null;
  let maxX = 0, maxY = 0;
  for (const b of allBboxes) {
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const imgW = maxX * 1.1;
  const imgH = maxY * 1.1;

  const panelRect = panelEl.getBoundingClientRect();
  const containerRect = containerEl.getBoundingClientRect();
  const w = panelRect.width;
  const h = panelRect.height;

  const scaleX = w / imgW;
  const scaleY = h / imgH;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (w - imgW * scale) / 2;
  const offsetY = (h - imgH * scale) / 2;

  const cx = offsetX + (bbox.x + bbox.width / 2) * scale;
  const cy = offsetY + (bbox.y + bbox.height / 2) * scale;

  return {
    x: panelRect.left - containerRect.left + cx,
    y: panelRect.top - containerRect.top + cy,
  };
}

export function PairingLinkOverlay({ mapPanelRef, imagePanelRef, containerRef }: PairingLinkOverlayProps) {
  const slots = useAbsmapDisplaySlots();
  const bboxes = useAppSelector((s) => s.autocalib.calib.bboxes);
  const confidenceThreshold = useAppSelector((s) => s.autocalib.calib.confidenceThreshold);
  const visibleBboxes = useMemo(
    () => visibleCalibBboxes(bboxes, confidenceThreshold),
    [bboxes, confidenceThreshold],
  );
  const pairing = useAppSelector((s) => s.autocalib.pairing);
  const { suggestion } = pairing;

  /* Confirmed pairs and the in-progress pair use only the colored highlight
   * on slot + bbox markers — no connecting line. Suggestion previews keep
   * their dashed lines because the auto-suggest workflow shows multiple
   * proposed pairs at once and the lines disambiguate the mapping. */
  const lines = useMemo(() => {
    const mapEl = mapPanelRef.current;
    const imgEl = imagePanelRef.current;
    const cEl = containerRef.current;
    if (!mapEl || !imgEl || !cEl || slots.length === 0 || visibleBboxes.length === 0) return [];

    const result: {
      key: string;
      x1: number; y1: number; x2: number; y2: number;
    }[] = [];

    for (const link of suggestion?.links ?? []) {
      const slot = slots.find((s) => s.slot_id === link.slotId);
      const bbox = visibleBboxes.find((b) => b.spot_id === link.bboxSpotId);
      if (!slot || !bbox) continue;

      const p1 = getSlotScreenPos(slot, slots, mapEl, cEl);
      const p2 = getBboxScreenPos(bbox, visibleBboxes, imgEl, cEl);
      if (!p1 || !p2) continue;

      result.push({
        key: link.id,
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
      });
    }
    return result;
  }, [suggestion, slots, visibleBboxes, mapPanelRef, imagePanelRef, containerRef]);

  if (lines.length === 0) return null;

  return (
    <svg className={styles.overlay}>
      {lines.map((line) => (
        <line
          key={line.key}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke="#37bc9b"
          strokeWidth={1.5}
          strokeDasharray="6,4"
          opacity={0.7}
        />
      ))}
    </svg>
  );
}
