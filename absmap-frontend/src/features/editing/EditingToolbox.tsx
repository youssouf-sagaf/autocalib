import { useCallback } from "react";
import { v4 as uuid } from "uuid";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addSlot, deleteSlots, modifySlot, clearSelection } from "../../store/absmap-slice";
import type { IMapProvider } from "../../map/MapProvider.interface";
import type { Slot } from "../../types";

interface EditingToolboxProps {
  mapProvider: IMapProvider | null;
}

export function EditingToolbox({ mapProvider }: EditingToolboxProps) {
  const dispatch = useAppDispatch();
  const selection = useAppSelector((s) => s.absmap.selection);
  const slots = useAppSelector((s) => s.absmap.slots);
  const job = useAppSelector((s) => s.absmap.job);

  const hasResult = job?.status === "done";

  const handleAdd = useCallback(async () => {
    if (!mapProvider) return;
    const polygon = await mapProvider.enableLassoDraw();
    const coords = polygon.coordinates[0];
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;

    const slot: Slot = {
      slot_id: uuid(),
      center: [cLng, cLat],
      polygon,
      source: "manual",
      confidence: 1.0,
      status: "unknown",
    };
    dispatch(addSlot(slot));
  }, [mapProvider, dispatch]);

  const handleDelete = useCallback(() => {
    if (selection.length === 0) return;
    dispatch(deleteSlots(selection));
  }, [selection, dispatch]);

  const handleBulkDelete = useCallback(async () => {
    if (!mapProvider) return;
    const lasso = await mapProvider.enableLassoDraw();
    const lassoCoords = lasso.coordinates[0];

    const insideIds = slots
      .filter((s) => {
        const [lng, lat] = s.center;
        return _pointInPolygon(lng, lat, lassoCoords);
      })
      .map((s) => s.slot_id);

    if (insideIds.length > 0) {
      dispatch(deleteSlots(insideIds));
    }
  }, [mapProvider, slots, dispatch]);

  return (
    <div className="panel editing-panel">
      <h3>Editing</h3>
      <div className="btn-group">
        <button className="btn btn-sm" onClick={handleAdd} disabled={!hasResult}>
          Add slot
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={handleDelete}
          disabled={selection.length === 0}
        >
          Delete ({selection.length})
        </button>
        <button className="btn btn-sm" onClick={handleBulkDelete} disabled={!hasResult}>
          Lasso delete
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => dispatch(clearSelection())}>
          Deselect
        </button>
      </div>
    </div>
  );
}

/** Ray-casting point-in-polygon test. */
function _pointInPolygon(
  x: number,
  y: number,
  polygon: number[][],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
