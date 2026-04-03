import { useCallback, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { applyReprocess } from "../../store/absmap-slice";
import * as api from "../../api/absmap-api";
import type { IMapProvider } from "../../map/MapProvider.interface";

interface ReprocessPanelProps {
  mapProvider: IMapProvider | null;
}

/**
 * Reprocessing helper: select a reference slot, draw a scope polygon,
 * receive proposed slots, preview them, then accept.
 */
export function ReprocessPanel({ mapProvider }: ReprocessPanelProps) {
  const dispatch = useAppDispatch();
  const job = useAppSelector((s) => s.absmap.job);
  const selection = useAppSelector((s) => s.absmap.selection);
  const [loading, setLoading] = useState(false);

  const handleReprocess = useCallback(async () => {
    if (!mapProvider || !job?.id || selection.length !== 1) return;
    setLoading(true);
    try {
      const scope = await mapProvider.enableLassoDraw();
      const result = await api.reprocessArea(job.id, selection[0], scope);
      if (result.proposed_slots.length > 0) {
        dispatch(applyReprocess(result.proposed_slots));
      }
    } finally {
      setLoading(false);
    }
  }, [mapProvider, job, selection, dispatch]);

  const canReprocess = job?.status === "done" && selection.length === 1;

  return (
    <div className="panel reprocess-panel">
      <h3>Reprocess</h3>
      <p className="hint-text">Select one reference slot, then draw a scope area.</p>
      <button
        className="btn btn-sm"
        onClick={handleReprocess}
        disabled={!canReprocess || loading}
      >
        {loading ? "Processing..." : "Reprocess area"}
      </button>
    </div>
  );
}
