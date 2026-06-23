export type ImagerySource =
  | 'mapbox'
  | 'ign-current'
  | 'ign-pleiades-2026';

export const IMAGERY_SOURCES: readonly ImagerySource[] = [
  'mapbox',
  'ign-current',
  'ign-pleiades-2026',
] as const;

export interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface TileSummary {
  id: string;
  name?: string;
  created_at?: string;
}

export type ObAnnotationClass = 'vehicle' | 'background';

export interface ObAnnotation {
  id: string;
  class: ObAnnotationClass;
  /** Center x, center y, width, height, angle (radians) in pixel space */
  obb: [number, number, number, number, number];
}

export interface TileDetail extends TileSummary {
  image_url?: string;
  width?: number;
  height?: number;
  annotations?: ObAnnotation[];
}

export interface DatasetSummary {
  id: string;
  name: string;
  tile_count?: number;
}

export interface TrainingRun {
  id: string;
  status: string;
  created_at?: string;
  metrics?: Record<string, number>;
}

export interface TrainingMetricPoint {
  step: number;
  loss?: number;
  map50?: number;
  [key: string]: number | undefined;
}
