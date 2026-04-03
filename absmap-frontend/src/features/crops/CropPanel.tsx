import { useCallback, useRef } from "react";
import type { Polygon } from "geojson";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addCrop, clearCrops, removeCrop } from "../../store/absmap-slice";
import type { IMapProvider } from "../../map/MapProvider.interface";

interface CropPanelProps {
  mapProvider: IMapProvider | null;
}

export function CropPanel({ mapProvider }: CropPanelProps) {
  const dispatch = useAppDispatch();
  const crops = useAppSelector((s) => s.absmap.crops);
  const job = useAppSelector((s) => s.absmap.job);
  const isDrawing = useRef(false);

  const handleDraw = useCallback(async () => {
    if (!mapProvider || isDrawing.current) return;
    isDrawing.current = true;
    try {
      const polygons = await mapProvider.enableMultiRectDraw();
      for (const polygon of polygons) {
        dispatch(addCrop({ polygon }));
      }
    } finally {
      isDrawing.current = false;
    }
  }, [mapProvider, dispatch]);

  const isRunning = job?.status === "running" || job?.status === "pending";

  return (
    <div className="panel crop-panel">
      <h3>Crops</h3>
      <button className="btn btn-primary" onClick={handleDraw} disabled={isRunning || !mapProvider}>
        Draw crop zone
      </button>

      {crops.length > 0 && (
        <div className="crop-list">
          {crops.map((crop, idx) => (
            <div key={idx} className="crop-item">
              <span>Crop {idx + 1}</span>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => dispatch(removeCrop(idx))}
                disabled={isRunning}
              >
                &times;
              </button>
            </div>
          ))}
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => dispatch(clearCrops())}
            disabled={isRunning}
          >
            Clear all
          </button>
        </div>
      )}

      {crops.length === 0 && (
        <p className="hint-text">Draw rectangles on the map to define crop zones.</p>
      )}
    </div>
  );
}
