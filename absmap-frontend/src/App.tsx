import { useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { IMapProvider } from "./map/MapProvider.interface";
import { DualMapLayout } from "./features/dual-map/DualMapLayout";
import { CropPanel } from "./features/crops/CropPanel";
import { PipelineTrigger } from "./features/pipeline/PipelineTrigger";
import { SlotLayer } from "./features/slot-layer/SlotLayer";
import { EditingToolbox } from "./features/editing/EditingToolbox";
import { SessionBar } from "./features/session/SessionBar";
import { ReprocessPanel } from "./features/reprocessing/ReprocessPanel";
import { RowStraightener } from "./features/row-straightener/RowStraightener";
import { SavePanel } from "./features/save/SavePanel";
import { useAppSelector } from "./store/hooks";

export default function App() {
  const [leftProvider, setLeftProvider] = useState<IMapProvider | null>(null);
  const [rightProvider, setRightProvider] = useState<IMapProvider | null>(null);
  const job = useAppSelector((s) => s.absmap.job);

  const handleLeftReady = useCallback((provider: IMapProvider, _map: mapboxgl.Map) => {
    setLeftProvider(provider);
  }, []);

  const handleRightReady = useCallback((provider: IMapProvider, _map: mapboxgl.Map) => {
    setRightProvider(provider);
  }, []);

  const hasResult = job?.status === "done";

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">absmap</h1>
        <SessionBar />
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <CropPanel mapProvider={leftProvider} />
          <PipelineTrigger />

          {hasResult && (
            <>
              <EditingToolbox mapProvider={rightProvider} />
              <ReprocessPanel mapProvider={rightProvider} />
              <RowStraightener />
              <SavePanel />
            </>
          )}
        </aside>

        <main className="map-container">
          <DualMapLayout onLeftReady={handleLeftReady} onRightReady={handleRightReady}>
            <SlotLayer mapProvider={rightProvider} />
          </DualMapLayout>
        </main>
      </div>
    </div>
  );
}
