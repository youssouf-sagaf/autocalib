import type { Map as MapboxMap } from 'mapbox-gl';
import {
  SLOT_TYPE_COLORS,
  parkingPinSvg,
  parkingSlotIconImageId,
} from '../theme/slotTypes';
import type { ParkingSlotType } from '../types';

const ADD_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.27 21.73 0 14 0z" fill="#2979ff"/>
  <circle cx="14" cy="13" r="9" fill="#2979ff"/>
  <text x="14" y="17.5" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="16" fill="white">+</text>
</svg>`;

const PIN_PIXEL_RATIO = 2;

/** 1×1 transparent pixel — Mapbox requires a synchronous addImage in styleimagemissing. */
const TRANSPARENT_PLACEHOLDER = {
  width: 1,
  height: 1,
  data: new Uint8Array([0, 0, 0, 0]),
};

/** Shared across all Mapbox instances — enables synchronous addImage in styleimagemissing. */
const pinImageCache = new Map<string, HTMLImageElement>();
const pinLoadPromises = new Map<string, Promise<HTMLImageElement>>();

const attachedMaps = new WeakSet<MapboxMap>();

let preloadPromise: Promise<void> | null = null;

function dataUrlForPin(fill: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(parkingPinSvg(fill))}`;
}

function dataUrlForId(id: string): string | null {
  if (id === 'add-marker') {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ADD_MARKER_SVG)}`;
  }
  if (!id.startsWith('parking-slot-')) return null;
  const key = id.slice('parking-slot-'.length) as ParkingSlotType;
  const fill = SLOT_TYPE_COLORS[key] ?? SLOT_TYPE_COLORS.common;
  return dataUrlForPin(fill);
}

function addCachedImageToMap(map: MapboxMap, id: string, img: HTMLImageElement): void {
  if (map.hasImage(id)) return;
  try {
    map.addImage(id, img, { pixelRatio: PIN_PIXEL_RATIO });
    map.triggerRepaint();
  } catch {
    /* style was replaced while the map was tearing down */
  }
}

function replaceImageOnMap(map: MapboxMap, id: string, img: HTMLImageElement): void {
  try {
    if (map.hasImage(id)) map.removeImage(id);
  } catch {
    /* map tearing down */
  }
  addCachedImageToMap(map, id, img);
}

function addPlaceholderToMap(map: MapboxMap, id: string): void {
  if (map.hasImage(id)) return;
  try {
    map.addImage(id, TRANSPARENT_PLACEHOLDER, { pixelRatio: 1 });
  } catch {
    /* style was replaced while the map was tearing down */
  }
}

/**
 * Load an SVG pin into the module cache (HTMLImageElement — Mapbox rejects many SVG data URLs via loadImage).
 */
function loadPinIntoCache(id: string, url: string): Promise<HTMLImageElement> {
  const cached = pinImageCache.get(id);
  if (cached) return Promise.resolve(cached);

  const inflight = pinLoadPromises.get(id);
  if (inflight) return inflight;

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      pinImageCache.set(id, img);
      pinLoadPromises.delete(id);
      resolve(img);
    };
    img.onerror = () => {
      pinLoadPromises.delete(id);
      reject(new Error(`Failed to decode pin image: ${id}`));
    };
    img.src = url;
  });
  pinLoadPromises.set(id, promise);
  return promise;
}

/** Warm the cache before any map paints slot symbols (avoids styleimagemissing races). */
export function preloadAllSlotPinImages(): Promise<void> {
  if (preloadPromise) return preloadPromise;

  const jobs: Promise<HTMLImageElement>[] = [];
  for (const key of Object.keys(SLOT_TYPE_COLORS) as ParkingSlotType[]) {
    const id = parkingSlotIconImageId(key);
    jobs.push(loadPinIntoCache(id, dataUrlForPin(SLOT_TYPE_COLORS[key])));
  }
  jobs.push(
    loadPinIntoCache(
      'add-marker',
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ADD_MARKER_SVG)}`,
    ),
  );
  preloadPromise = Promise.all(jobs).then(() => undefined);
  return preloadPromise;
}

/** Resolves once every parking pin sprite is decoded (safe to paint symbol layers). */
export const slotPinImagesReady = preloadAllSlotPinImages();

export function areSlotPinImagesReady(): boolean {
  const expected = Object.keys(SLOT_TYPE_COLORS).length + 1;
  return pinImageCache.size >= expected;
}

function syncCachedPinsOntoMap(map: MapboxMap): void {
  for (const [id, img] of pinImageCache) {
    replaceImageOnMap(map, id, img);
  }
}

/**
 * Mapbox requires addImage inside styleimagemissing to run synchronously; serve from cache when possible.
 */
function registerPinById(map: MapboxMap, id: string): void {
  const cached = pinImageCache.get(id);
  if (cached) {
    replaceImageOnMap(map, id, cached);
    return;
  }

  const url = dataUrlForId(id);
  if (!url) return;

  addPlaceholderToMap(map, id);
  void loadPinIntoCache(id, url).then((img) => {
    replaceImageOnMap(map, id, img);
  });
}

function registerAllSlotPins(map: MapboxMap): void {
  if (areSlotPinImagesReady()) {
    syncCachedPinsOntoMap(map);
    return;
  }
  void slotPinImagesReady.then(() => syncCachedPinsOntoMap(map));
}

/**
 * Register parking pin sprites on a Mapbox map instance.
 */
export function attachSlotPinImages(map: MapboxMap): void {
  if (!attachedMaps.has(map)) {
    attachedMaps.add(map);
    map.on('styleimagemissing', (e) => registerPinById(map, e.id));
    map.on('style.load', () => registerAllSlotPins(map));
  }
  registerAllSlotPins(map);
}
