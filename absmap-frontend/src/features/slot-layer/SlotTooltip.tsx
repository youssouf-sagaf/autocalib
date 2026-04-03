import type { Slot } from "../../types";

interface SlotTooltipProps {
  slot: Slot | null;
  position?: { x: number; y: number };
}

export function SlotTooltip({ slot, position }: SlotTooltipProps) {
  if (!slot || !position) return null;

  return (
    <div
      className="slot-tooltip"
      style={{ left: position.x + 12, top: position.y - 8 }}
    >
      <div><strong>{slot.slot_id.slice(0, 8)}</strong></div>
      <div>Source: {slot.source}</div>
      <div>Status: {slot.status}</div>
      <div>Confidence: {(slot.confidence * 100).toFixed(0)}%</div>
    </div>
  );
}
