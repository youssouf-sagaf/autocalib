import type { Polygon } from "geojson";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { IMapProvider } from "./MapProvider.interface";
import type { BBox, LayerHandle, Slot, SlotLayerOptions } from "../types";

let layerCounter = 0;

function slotsToGeoJSON(slots: Slot[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: slots.map((s) => ({
      type: "Feature" as const,
      geometry: s.polygon,
      properties: {
        slot_id: s.slot_id,
        source: s.source,
        confidence: s.confidence,
        status: s.status,
      },
    })),
  };
}

function styleForOpts(opts: SlotLayerOptions): {
  fillColor: string;
  fillOpacity: number;
  lineColor: string;
} {
  switch (opts.style) {
    case "existing":
      return { fillColor: "#a0a0b0", fillOpacity: 0.2, lineColor: "#0f3460" };
    case "proposed":
      return { fillColor: "#f59e0b", fillOpacity: 0.35, lineColor: "#d97706" };
    case "active":
    default:
      return { fillColor: "#e94560", fillOpacity: 0.35, lineColor: "#d63352" };
  }
}

/**
 * Mapbox GL JS implementation of IMapProvider.
 *
 * Wraps a raw `mapboxgl.Map` instance. Used in the POC; the integration
 * phase will swap this for GoogleMapsMapProvider without touching any
 * feature module.
 */
export class MapboxGLMapProvider implements IMapProvider {
  private map: mapboxgl.Map;
  private draw: MapboxDraw | null = null;
  private layers: Set<string> = new Set();

  constructor(map: mapboxgl.Map) {
    this.map = map;
  }

  syncWith(other: IMapProvider): void {
    const center = other.getCenter();
    const zoom = other.getZoom();
    this.map.setCenter(center);
    this.map.setZoom(zoom);
  }

  addSlotLayer(slots: Slot[], opts: SlotLayerOptions): LayerHandle {
    const id = `absmap-slots-${++layerCounter}`;
    const sourceId = `${id}-src`;
    const style = styleForOpts(opts);

    this.map.addSource(sourceId, {
      type: "geojson",
      data: slotsToGeoJSON(slots),
    });

    this.map.addLayer({
      id: `${id}-fill`,
      type: "fill",
      source: sourceId,
      paint: {
        "fill-color": style.fillColor,
        "fill-opacity": style.fillOpacity,
      },
    });

    this.map.addLayer({
      id: `${id}-line`,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": style.lineColor,
        "line-width": 1.5,
      },
    });

    this.layers.add(id);
    return id;
  }

  updateSlotLayer(handle: LayerHandle, slots: Slot[]): void {
    const sourceId = `${handle}-src`;
    const source = this.map.getSource(sourceId) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(slotsToGeoJSON(slots));
    }
  }

  removeLayer(handle: LayerHandle): void {
    const sourceId = `${handle}-src`;
    if (this.map.getLayer(`${handle}-fill`)) this.map.removeLayer(`${handle}-fill`);
    if (this.map.getLayer(`${handle}-line`)) this.map.removeLayer(`${handle}-line`);
    if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
    this.layers.delete(handle);
  }

  enableMultiRectDraw(): Promise<Polygon[]> {
    return new Promise((resolve) => {
      const draw = this._ensureDraw();
      draw.changeMode("draw_polygon");

      const polygons: Polygon[] = [];
      const onCreateOrUpdate = () => {
        const all = draw.getAll();
        polygons.length = 0;
        for (const f of all.features) {
          if (f.geometry.type === "Polygon") {
            polygons.push(f.geometry as Polygon);
          }
        }
      };

      this.map.on("draw.create", onCreateOrUpdate);
      this.map.on("draw.update", onCreateOrUpdate);

      const finishHandler = () => {
        this.map.off("draw.create", onCreateOrUpdate);
        this.map.off("draw.update", onCreateOrUpdate);
        draw.deleteAll();
        resolve(polygons);
      };

      this.map.once("draw.modechange" as any, () => {
        setTimeout(finishHandler, 100);
      });
    });
  }

  enableLassoDraw(): Promise<Polygon> {
    return new Promise((resolve) => {
      const draw = this._ensureDraw();
      draw.changeMode("draw_polygon");

      const handler = () => {
        const all = draw.getAll();
        const feat = all.features[all.features.length - 1];
        if (feat?.geometry.type === "Polygon") {
          draw.deleteAll();
          resolve(feat.geometry as Polygon);
        }
      };
      this.map.once("draw.create", handler);
    });
  }

  enableFreehandDraw(hintClass: "A" | "B"): Promise<Polygon> {
    return this.enableLassoDraw();
  }

  fitBounds(bounds: BBox): void {
    this.map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 40 },
    );
  }

  getCenter(): [number, number] {
    const c = this.map.getCenter();
    return [c.lng, c.lat];
  }

  getZoom(): number {
    return this.map.getZoom();
  }

  destroy(): void {
    for (const handle of this.layers) {
      this.removeLayer(handle);
    }
    if (this.draw) {
      this.map.removeControl(this.draw as any);
      this.draw = null;
    }
  }

  private _ensureDraw(): MapboxDraw {
    if (!this.draw) {
      this.draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: { polygon: true, trash: true },
      });
      this.map.addControl(this.draw as any);
    }
    return this.draw;
  }
}
