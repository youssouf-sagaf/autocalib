import type { Polygon } from "geojson";
import type { IMapProvider } from "./MapProvider.interface";
import type { BBox, LayerHandle, Slot, SlotLayerOptions } from "../types";

/**
 * Stub for Google Maps integration (Cocopilot-FE phase).
 *
 * All feature modules are map-renderer agnostic via IMapProvider.
 * This class will be implemented when integrating into Cocopilot-FE
 * with the Google Maps JS API.
 */
export class GoogleMapsMapProvider implements IMapProvider {
  syncWith(_other: IMapProvider): void {
    throw new Error("GoogleMapsMapProvider not yet implemented");
  }

  addSlotLayer(_slots: Slot[], _opts: SlotLayerOptions): LayerHandle {
    throw new Error("GoogleMapsMapProvider not yet implemented");
  }

  updateSlotLayer(_handle: LayerHandle, _slots: Slot[]): void {
    throw new Error("GoogleMapsMapProvider not yet implemented");
  }

  removeLayer(_handle: LayerHandle): void {
    throw new Error("GoogleMapsMapProvider not yet implemented");
  }

  enableMultiRectDraw(): Promise<Polygon[]> {
    throw new Error("GoogleMapsMapProvider not yet implemented");
  }

  enableLassoDraw(): Promise<Polygon> {
    throw new Error("GoogleMapsMapProvider not yet implemented");
  }

  enableFreehandDraw(_hintClass: "A" | "B"): Promise<Polygon> {
    throw new Error("GoogleMapsMapProvider not yet implemented");
  }

  fitBounds(_bounds: BBox): void {
    throw new Error("GoogleMapsMapProvider not yet implemented");
  }

  getCenter(): [number, number] {
    throw new Error("GoogleMapsMapProvider not yet implemented");
  }

  getZoom(): number {
    throw new Error("GoogleMapsMapProvider not yet implemented");
  }

  destroy(): void {
    // no-op
  }
}
