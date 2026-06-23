import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setAbsmapViewState } from '../store/autocalib-slice';
import { activeClientDirectoryKey } from '../utils/clientContext';
import {
  centroidViewForSlots,
  DEFAULT_ABSMAP_MAP_VIEW,
  type AbsmapMapViewState,
} from '../utils/absmapMapView';
import { useAbsmapDisplaySlots } from './useAbsmapDisplaySlots';

/**
 * Map camera synced with absmap Redux view state — same auto-fit rules as /absmap.
 */
export function useAbsmapSyncedMapView() {
  const dispatch = useAppDispatch();
  const savedView = useAppSelector((s) => s.autocalib.absmap.absmapViewState);
  const displaySlots = useAbsmapDisplaySlots();
  const contextDirectoryKey = useAppSelector((s) => activeClientDirectoryKey(s.autocalib.context));
  const clientLocation = useAppSelector((s) =>
    contextDirectoryKey
      ? s.autocalib.directory.clientLocations[contextDirectoryKey] ?? null
      : null,
  );

  const mapAutoFitClientKeyRef = useRef<string | null>(null);

  useEffect(() => {
    mapAutoFitClientKeyRef.current = null;
  }, [contextDirectoryKey]);

  const fallbackView = useMemo((): AbsmapMapViewState => {
    const fromSlots = centroidViewForSlots(displaySlots);
    if (fromSlots) return fromSlots;
    if (clientLocation) {
      return {
        longitude: clientLocation.lng,
        latitude: clientLocation.lat,
        zoom: clientLocation.zoom,
      };
    }
    return DEFAULT_ABSMAP_MAP_VIEW;
  }, [displaySlots, clientLocation]);

  useEffect(() => {
    if (savedView) return;
    if (!contextDirectoryKey) return;
    if (displaySlots.length > 0) {
      if (mapAutoFitClientKeyRef.current === contextDirectoryKey) return;
      mapAutoFitClientKeyRef.current = contextDirectoryKey;
      const view = centroidViewForSlots(displaySlots);
      if (view) dispatch(setAbsmapViewState(view));
      return;
    }
    if (!clientLocation) return;
    dispatch(
      setAbsmapViewState({
        longitude: clientLocation.lng,
        latitude: clientLocation.lat,
        zoom: clientLocation.zoom,
      }),
    );
  }, [savedView, displaySlots, clientLocation, contextDirectoryKey, dispatch]);

  const [viewState, setViewState] = useState<AbsmapMapViewState>(
    () => savedView ?? fallbackView,
  );

  useEffect(() => {
    if (!savedView) {
      setViewState((prev) => ({ ...prev, ...fallbackView }));
      return;
    }
    setViewState((prev) => ({
      ...prev,
      longitude: savedView.longitude,
      latitude: savedView.latitude,
      zoom: savedView.zoom,
    }));
  }, [savedView, fallbackView]);

  const onMove = useCallback((evt: { viewState: AbsmapMapViewState }) => {
    setViewState(evt.viewState);
  }, []);

  const onMoveEnd = useCallback(
    (evt: { viewState: AbsmapMapViewState }) => {
      const vs = evt.viewState;
      setViewState(vs);
      dispatch(
        setAbsmapViewState({
          longitude: vs.longitude,
          latitude: vs.latitude,
          zoom: vs.zoom,
        }),
      );
    },
    [dispatch],
  );

  return { viewState, onMove, onMoveEnd };
}
