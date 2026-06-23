import { useCallback, useEffect, useState } from 'react';
import { MapPanel, type MapPanelProps, type MapViewState } from './MapPanel';

const DEFAULT_VIEW: MapViewState = { longitude: 2.3488, latitude: 48.8534, zoom: 12 };

function useSyncedMapViewState(
  initialViewState: MapViewState,
  externalViewCommand: number,
  externalViewState: MapViewState | null,
  onViewPersist: (viewState: MapViewState) => void,
) {
  const [viewState, setViewState] = useState(initialViewState);

  useEffect(() => {
    if (!externalViewState) return;
    setViewState((prev) => ({ ...prev, ...externalViewState }));
  }, [externalViewCommand, externalViewState]);

  const handleMove = useCallback((evt: { viewState: MapViewState }) => {
    setViewState(evt.viewState);
  }, []);

  const handleMoveEnd = useCallback(
    (evt: { viewState: MapViewState }) => {
      setViewState(evt.viewState);
      onViewPersist(evt.viewState);
    },
    [onViewPersist],
  );

  return { viewState, handleMove, handleMoveEnd };
}

type SharedMapPanelProps = Omit<MapPanelProps, 'viewState' | 'onMove' | 'onMoveEnd'>;

export interface AbsmapMapViewportProps extends SharedMapPanelProps {
  initialViewState?: MapViewState | null;
  externalViewCommand: number;
  externalViewState: MapViewState | null;
  onViewPersist: (viewState: MapViewState) => void;
}

export function AbsmapMapViewport({
  initialViewState,
  externalViewCommand,
  externalViewState,
  onViewPersist,
  ...panelProps
}: AbsmapMapViewportProps) {
  const { viewState, handleMove, handleMoveEnd } = useSyncedMapViewState(
    initialViewState ?? DEFAULT_VIEW,
    externalViewCommand,
    externalViewState,
    onViewPersist,
  );

  return (
    <MapPanel
      {...panelProps}
      viewState={viewState}
      onMove={handleMove}
      onMoveEnd={handleMoveEnd}
    />
  );
}

export interface AbsmapDualMapViewportProps {
  initialViewState?: MapViewState | null;
  externalViewCommand: number;
  externalViewState: MapViewState | null;
  onViewPersist: (viewState: MapViewState) => void;
  referencePanelProps: SharedMapPanelProps;
  detectionPanelProps: SharedMapPanelProps;
}

export function AbsmapDualMapViewport({
  initialViewState,
  externalViewCommand,
  externalViewState,
  onViewPersist,
  referencePanelProps,
  detectionPanelProps,
}: AbsmapDualMapViewportProps) {
  const { viewState, handleMove, handleMoveEnd } = useSyncedMapViewState(
    initialViewState ?? DEFAULT_VIEW,
    externalViewCommand,
    externalViewState,
    onViewPersist,
  );

  return (
    <div className="dualMapContainer">
      <MapPanel
        {...referencePanelProps}
        viewState={viewState}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
      />
      <div className="dualMapDivider" />
      <MapPanel
        {...detectionPanelProps}
        viewState={viewState}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
      />
    </div>
  );
}
