import { useEffect, useRef } from "react";
import type { IMapProvider } from "../../map/MapProvider.interface";
import { useAppSelector } from "../../store/hooks";
import type { LayerHandle, Slot } from "../../types";

interface SlotLayerProps {
  mapProvider: IMapProvider | null;
}

export function SlotLayer({ mapProvider }: SlotLayerProps) {
  const slots = useAppSelector((s) => s.absmap.slots);
  const existingSlots = useAppSelector((s) => s.absmap.existingSlots);
  const selection = useAppSelector((s) => s.absmap.selection);

  const activeHandle = useRef<LayerHandle | null>(null);
  const existingHandle = useRef<LayerHandle | null>(null);

  useEffect(() => {
    if (!mapProvider) return;

    if (existingSlots.length > 0 && !existingHandle.current) {
      existingHandle.current = mapProvider.addSlotLayer(existingSlots, {
        style: "existing",
        interactive: false,
      });
    } else if (existingHandle.current) {
      mapProvider.updateSlotLayer(existingHandle.current, existingSlots);
    }
  }, [mapProvider, existingSlots]);

  useEffect(() => {
    if (!mapProvider) return;

    if (slots.length > 0 && !activeHandle.current) {
      activeHandle.current = mapProvider.addSlotLayer(slots, {
        style: "active",
        interactive: true,
      });
    } else if (activeHandle.current) {
      mapProvider.updateSlotLayer(activeHandle.current, slots);
    }
  }, [mapProvider, slots]);

  useEffect(() => {
    return () => {
      if (mapProvider && activeHandle.current) {
        mapProvider.removeLayer(activeHandle.current);
      }
      if (mapProvider && existingHandle.current) {
        mapProvider.removeLayer(existingHandle.current);
      }
    };
  }, [mapProvider]);

  return null;
}
