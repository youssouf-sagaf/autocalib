import type { ImagerySource } from '../types';

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

export function buildIgnTileUrl(layer: string, format: string): string {
  return (
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    `&LAYER=${layer}&TILEMATRIXSET=PM&TILEMATRIX={z}` +
    `&TILEROW={y}&TILECOL={x}&FORMAT=${encodeURIComponent(format)}&STYLE=normal`
  );
}

export function mapStyleForImagery(source: ImagerySource): string {
  return source === 'mapbox'
    ? 'mapbox://styles/mapbox/satellite-streets-v12'
    : 'mapbox://styles/mapbox/light-v11';
}
