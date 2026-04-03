import { useCallback, useState } from "react";
import type { Polygon } from "geojson";
import type { IMapProvider } from "../../map/MapProvider.interface";

interface HintToolbarProps {
  mapProvider: IMapProvider | null;
  onHint: (hintClass: "A" | "B", polygon: Polygon) => void;
}

/**
 * Toolbar for drawing freehand hint masks per crop.
 * Class A = "definitely parkable", Class B = "definitely not parkable".
 */
export function HintToolbar({ mapProvider, onHint }: HintToolbarProps) {
  const [drawing, setDrawing] = useState<"A" | "B" | null>(null);

  const startDraw = useCallback(
    async (cls: "A" | "B") => {
      if (!mapProvider || drawing) return;
      setDrawing(cls);
      try {
        const polygon = await mapProvider.enableFreehandDraw(cls);
        onHint(cls, polygon);
      } finally {
        setDrawing(null);
      }
    },
    [mapProvider, drawing, onHint],
  );

  return (
    <div className="hint-toolbar">
      <span className="label">Hints:</span>
      <button
        className={`btn btn-sm ${drawing === "A" ? "active" : ""}`}
        onClick={() => startDraw("A")}
        disabled={drawing !== null}
      >
        Class A (parkable)
      </button>
      <button
        className={`btn btn-sm ${drawing === "B" ? "active" : ""}`}
        onClick={() => startDraw("B")}
        disabled={drawing !== null}
      >
        Class B (not parkable)
      </button>
    </div>
  );
}
