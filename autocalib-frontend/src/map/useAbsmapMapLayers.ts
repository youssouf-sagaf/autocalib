import { useMemo } from 'react';
import { useAbsmapDisplaySlots } from '../hooks/useAbsmapDisplaySlots';
import { slotKey } from '../utils/slot-key';
import { useAppSelector } from '../store/hooks';
import type { Slot } from '../types';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const EMPTY_POINT_FC: FeatureCollection<Point> = {
  type: 'FeatureCollection',
  features: [],
};

export interface AbsmapMapLayersInput {
  showCrops?: boolean;
  showSlots?: boolean;
  showCentroids?: boolean;
  previewFeature?: Feature<Polygon> | null;
  edgeFeature?: Feature<LineString> | null;
  vertexFeatures?: FeatureCollection<Point>;
  pendingSlot?: Slot | null;
  pendingShowsBbox?: boolean;
  selectedSlotId?: string | null;
  hoveredSlotId?: string | null;
  modifyDragSlot?: Slot | null;
  bulkPreviewSlotIds?: string[] | null;
  reprocessProposedSlots?: Slot[];
  tileRowGhostSlots?: Slot[];
  tileRowGhostShowFootprint?: boolean;
}

export interface AbsmapMapLayers {
  slots: Slot[];
  slotsLayerKey: string;
  cropsGeoJSON: GeoJSON.FeatureCollection;
  centroidsGeoJSON: GeoJSON.FeatureCollection;
  slotsHitGeoJSON: GeoJSON.FeatureCollection;
  tileRowGhostGeoJSON: GeoJSON.FeatureCollection;
  tileRowGhostMarkerGeoJSON: GeoJSON.FeatureCollection;
  previewGeoJSON: GeoJSON.FeatureCollection;
  edgeGeoJSON: GeoJSON.FeatureCollection;
  vertexGeoJSON: FeatureCollection<Point>;
  pendingBboxGeoJSON: GeoJSON.FeatureCollection;
  pendingMarkerGeoJSON: GeoJSON.FeatureCollection;
  reprocessGhostGeoJSON: GeoJSON.FeatureCollection;
}

export function useAbsmapMapLayers({
  showCrops = true,
  showSlots = true,
  showCentroids = true,
  previewFeature,
  edgeFeature,
  vertexFeatures,
  pendingSlot,
  pendingShowsBbox = true,
  selectedSlotId,
  hoveredSlotId,
  modifyDragSlot,
  bulkPreviewSlotIds = null,
  reprocessProposedSlots,
  tileRowGhostSlots,
  tileRowGhostShowFootprint = true,
}: AbsmapMapLayersInput): AbsmapMapLayers {
  const crops = useAppSelector((s) => s.autocalib.absmap.crops);
  const b2bSnapshotAtLoad = useAppSelector((s) => s.autocalib.absmap.b2bSnapshotAtLoad);
  const slotMapDisplayMode = useAppSelector((s) => s.autocalib.absmap.slotMapDisplayMode);
  const slotSelection = useAppSelector((s) => s.autocalib.absmap.selection);
  const selectionSet = useMemo(
    () => new Set(slotSelection.map((id) => id.trim()).filter(Boolean)),
    [slotSelection],
  );
  const slots = useAbsmapDisplaySlots();

  const b2bSnapshotIds = useMemo(
    () => new Set(b2bSnapshotAtLoad.map((s) => s.slot_id.trim()).filter(Boolean)),
    [b2bSnapshotAtLoad],
  );

  const bulkPreviewSet = useMemo(() => {
    if (!bulkPreviewSlotIds?.length) return new Set<string>();
    return new Set(bulkPreviewSlotIds);
  }, [bulkPreviewSlotIds]);

  const cropsGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      showCrops && crops.length > 0
        ? {
            type: 'FeatureCollection',
            features: crops.map((crop, i) => ({
              type: 'Feature' as const,
              properties: { index: i },
              geometry: crop.polygon,
            })),
          }
        : EMPTY_FC,
    [crops, showCrops],
  );

  const centroidsGeoJSON: GeoJSON.FeatureCollection = useMemo(() => {
    if (!showCentroids) return EMPTY_FC;
    if (slots.length === 0) return EMPTY_FC;
    return {
      type: 'FeatureCollection',
      features: slots.map((slot) => {
        const key = slotKey(slot);
        const dragging =
          modifyDragSlot != null && slotKey(modifyDragSlot) === key;
        const isSelected =
          selectionSet.has(key)
          || (selectedSlotId != null && key === selectedSlotId.trim())
          || dragging;
        const lng = dragging ? modifyDragSlot.center.lng : slot.center.lng;
        const lat = dragging ? modifyDragSlot.center.lat : slot.center.lat;
        return {
          type: 'Feature' as const,
          properties: {
            slot_id: key,
            source: slot.source,
            slot_type: slot.slot_type ?? 'common',
            isExisting: b2bSnapshotIds.has(slot.slot_id.trim()),
            selected: isSelected,
            hovered: key === hoveredSlotId,
            bulkPreview: bulkPreviewSet.has(key),
          },
          geometry: {
            type: 'Point' as const,
            coordinates: [lng, lat],
          },
        };
      }),
    };
  }, [
    slots,
    b2bSnapshotIds,
    showCentroids,
    selectedSlotId,
    hoveredSlotId,
    bulkPreviewSet,
    modifyDragSlot,
    selectionSet,
  ]);

  const slotsHitGeoJSON: GeoJSON.FeatureCollection = useMemo(() => {
    if (!showSlots || slots.length === 0) return EMPTY_FC;
    return {
      type: 'FeatureCollection',
      features: slots.map((slot) => {
        const key = slotKey(slot);
        const live =
          modifyDragSlot != null && slotKey(modifyDragSlot) === key
            ? modifyDragSlot
            : slot;
        const isSelected =
          selectionSet.has(key)
          || (selectedSlotId != null && key === selectedSlotId.trim());
        return {
          type: 'Feature' as const,
          properties: {
            slot_id: key,
            source: slot.source,
            selected: isSelected,
            hovered: key === hoveredSlotId,
          },
          geometry: live.polygon,
        };
      }),
    };
  }, [slots, showSlots, modifyDragSlot, selectionSet, hoveredSlotId, selectedSlotId]);

  const tileRowGhostGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      tileRowGhostShowFootprint && tileRowGhostSlots && tileRowGhostSlots.length > 0
        ? {
            type: 'FeatureCollection',
            features: tileRowGhostSlots.map((slot) => ({
              type: 'Feature' as const,
              properties: { slot_id: slot.slot_id },
              geometry: slot.polygon,
            })),
          }
        : EMPTY_FC,
    [tileRowGhostSlots, tileRowGhostShowFootprint],
  );

  const tileRowGhostMarkerGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      !tileRowGhostShowFootprint && tileRowGhostSlots && tileRowGhostSlots.length > 0
        ? {
            type: 'FeatureCollection',
            features: tileRowGhostSlots.map((slot) => ({
              type: 'Feature' as const,
              properties: { slot_type: slot.slot_type ?? 'common' },
              geometry: {
                type: 'Point' as const,
                coordinates: [slot.center.lng, slot.center.lat],
              },
            })),
          }
        : EMPTY_FC,
    [tileRowGhostSlots, tileRowGhostShowFootprint],
  );

  const previewGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      previewFeature
        ? { type: 'FeatureCollection', features: [previewFeature] }
        : EMPTY_FC,
    [previewFeature],
  );

  const edgeGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      edgeFeature
        ? { type: 'FeatureCollection', features: [edgeFeature] }
        : EMPTY_FC,
    [edgeFeature],
  );

  const vertexGeoJSON = vertexFeatures ?? EMPTY_POINT_FC;

  const pendingBboxGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      pendingSlot && pendingShowsBbox
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature' as const,
                properties: {},
                geometry: pendingSlot.polygon,
              },
            ],
          }
        : EMPTY_FC,
    [pendingSlot, pendingShowsBbox],
  );

  const pendingMarkerGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      pendingSlot
        ? {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature' as const,
                properties: {},
                geometry: {
                  type: 'Point' as const,
                  coordinates: [pendingSlot.center.lng, pendingSlot.center.lat],
                },
              },
            ],
          }
        : EMPTY_FC,
    [pendingSlot],
  );

  const reprocessGhostGeoJSON: GeoJSON.FeatureCollection = useMemo(
    () =>
      reprocessProposedSlots && reprocessProposedSlots.length > 0
        ? {
            type: 'FeatureCollection',
            features: reprocessProposedSlots.map((slot) => ({
              type: 'Feature' as const,
              properties: { slot_id: slot.slot_id, source: slot.source },
              geometry: slot.polygon,
            })),
          }
        : EMPTY_FC,
    [reprocessProposedSlots],
  );

  const slotsLayerKey = `${slotMapDisplayMode}-${slots.length}`;

  return {
    slots,
    slotsLayerKey,
    cropsGeoJSON,
    centroidsGeoJSON,
    slotsHitGeoJSON,
    tileRowGhostGeoJSON,
    tileRowGhostMarkerGeoJSON,
    previewGeoJSON,
    edgeGeoJSON,
    vertexGeoJSON,
    pendingBboxGeoJSON,
    pendingMarkerGeoJSON,
    reprocessGhostGeoJSON,
  };
}
