import type { ImagerySource, MapDisplayLayer } from '../types';

/** Kept in sync with autoabsmap/imagery/ign.py IGN_LAYER_PRESETS. */
export const IGN_LAYER_PRESETS: Record<
  Exclude<ImagerySource, 'mapbox'>,
  { layer: string; format: string; maxZoom: number }
> = {
  'ign-current': {
    layer: 'ORTHOIMAGERY.ORTHOPHOTOS',
    format: 'image/jpeg',
    maxZoom: 19,
  },
  'ign-pleiades-2026': {
    layer: 'ORTHOIMAGERY.ORTHO-SAT.PLEIADES.2026',
    format: 'image/png',
    maxZoom: 18,
  },
};

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function buildIgnTileUrl(layer: string, format: string): string {
  return (
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    `&LAYER=${layer}&TILEMATRIXSET=PM&TILEMATRIX={z}` +
    `&TILEROW={y}&TILECOL={x}&FORMAT=${encodeURIComponent(format)}&STYLE=normal`
  );
}

export function isIgnDisplayLayer(layer: MapDisplayLayer): layer is 'ign-current' | 'ign-pleiades-2026' {
  return layer === 'ign-current' || layer === 'ign-pleiades-2026';
}

export function mapStyleForDisplayLayer(layer: MapDisplayLayer): string {
  switch (layer) {
    case 'mapbox-satellite':
    case 'ign-current':
    case 'ign-pleiades-2026':
      return 'mapbox://styles/mapbox/satellite-streets-v12';
    case 'streets':
    case 'osm':
      return 'mapbox://styles/mapbox/light-v11';
  }
}

export function displayLayerNeedsOsmRaster(layer: MapDisplayLayer): boolean {
  return layer === 'osm';
}

export function displayLayerIgnPreset(
  layer: MapDisplayLayer,
): (typeof IGN_LAYER_PRESETS)[keyof typeof IGN_LAYER_PRESETS] | null {
  if (!isIgnDisplayLayer(layer)) return null;
  return IGN_LAYER_PRESETS[layer];
}

/** Orthophoto display layers align with pipeline imagery sources. */
export function imagerySourceForDisplayLayer(layer: MapDisplayLayer): ImagerySource | null {
  switch (layer) {
    case 'mapbox-satellite':
      return 'mapbox';
    case 'ign-current':
    case 'ign-pleiades-2026':
      return layer;
    default:
      return null;
  }
}
