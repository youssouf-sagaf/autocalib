import type { Polygon } from "geojson";
import type { BBox, LayerHandle, Slot, SlotLayerOptions } from "../types";

/**
 * Renderer-agnostic map contract.
 *
 * POC:         MapboxGLMapProvider (react-map-gl + mapbox-gl-draw)
 * Integration: GoogleMapsMapProvider
 *
 * Feature modules only ever call these methods — never Mapbox-specific
 * or Google-specific APIs.
 */
export interface IMapProvider {
  /** Synchronize viewport (center, zoom, bearing) with another map. */
  syncWith(other: IMapProvider): void;

  /** Render a slot layer on the map, returns a handle for updates. */
  addSlotLayer(slots: Slot[], opts: SlotLayerOptions): LayerHandle;

  /** Replace the data behind an existing layer. */
  updateSlotLayer(handle: LayerHandle, slots: Slot[]): void;

  /** Remove a layer from the map. */
  removeLayer(handle: LayerHandle): void;

  /** Enter multi-rectangle draw mode; resolves when user finishes. */
  enableMultiRectDraw(): Promise<Polygon[]>;

  /** Enter lasso draw mode; resolves with the drawn polygon. */
  enableLassoDraw(): Promise<Polygon>;

  /** Enter freehand draw mode for hint masks. */
  enableFreehandDraw(hintClass: "A" | "B"): Promise<Polygon>;

  /** Fit the viewport to bounds [west, south, east, north]. */
  fitBounds(bounds: BBox): void;

  /** Get the current map center as [lng, lat]. */
  getCenter(): [number, number];

  /** Get the current zoom level. */
  getZoom(): number;

  /** Destroy the provider, clean up resources. */
  destroy(): void;
}
