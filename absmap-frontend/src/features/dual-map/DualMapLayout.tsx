import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { MapboxGLMapProvider } from "../../map/MapboxGLMapProvider";
import type { IMapProvider } from "../../map/MapProvider.interface";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

interface DualMapLayoutProps {
  onLeftReady: (provider: IMapProvider, map: mapboxgl.Map) => void;
  onRightReady: (provider: IMapProvider, map: mapboxgl.Map) => void;
  children?: React.ReactNode;
}

export function DualMapLayout({ onLeftReady, onRightReady, children }: DualMapLayoutProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    if (!leftRef.current || !rightRef.current || !MAPBOX_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const leftMap = new mapboxgl.Map({
      container: leftRef.current,
      style: "mapbox://styles/mapbox/satellite-v9",
      center: [2.35, 48.86],
      zoom: 17,
    });

    const rightMap = new mapboxgl.Map({
      container: rightRef.current,
      style: "mapbox://styles/mapbox/satellite-v9",
      center: [2.35, 48.86],
      zoom: 17,
    });

    leftMap.on("load", () => {
      rightMap.on("load", () => {
        const leftProvider = new MapboxGLMapProvider(leftMap);
        const rightProvider = new MapboxGLMapProvider(rightMap);

        // Sync left → right on move
        leftMap.on("move", () => {
          if (!synced) return;
          rightMap.setCenter(leftMap.getCenter());
          rightMap.setZoom(leftMap.getZoom());
          rightMap.setBearing(leftMap.getBearing());
          rightMap.setPitch(leftMap.getPitch());
        });

        onLeftReady(leftProvider, leftMap);
        onRightReady(rightProvider, rightMap);
        setSynced(true);
      });
    });

    return () => {
      leftMap.remove();
      rightMap.remove();
    };
  }, []);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="dual-map-error">
        <p>Set <code>VITE_MAPBOX_TOKEN</code> in your <code>.env</code> file.</p>
      </div>
    );
  }

  return (
    <div className="dual-map-layout">
      <div className="map-pane" ref={leftRef} />
      <div className="map-pane" ref={rightRef} />
      {children}
    </div>
  );
}
