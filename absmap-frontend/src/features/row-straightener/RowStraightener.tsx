import { useCallback, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { applyAlignment } from "../../store/absmap-slice";
import * as api from "../../api/absmap-api";

/**
 * Row straightener: click one slot to discover its row, then apply
 * the corrected (angle + centroid) geometries.
 */
export function RowStraightener() {
  const dispatch = useAppDispatch();
  const job = useAppSelector((s) => s.absmap.job);
  const selection = useAppSelector((s) => s.absmap.selection);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<any[]>([]);

  const handleStraighten = useCallback(async () => {
    if (!job?.id || selection.length !== 1) return;
    setLoading(true);
    try {
      const result = await api.straightenRow(job.id, selection[0]);
      if (result.proposed_slots.length > 0) {
        setPreview(result.proposed_slots);
      }
    } finally {
      setLoading(false);
    }
  }, [job, selection]);

  const handleAccept = useCallback(() => {
    if (preview.length > 0) {
      dispatch(applyAlignment(preview));
      setPreview([]);
    }
  }, [dispatch, preview]);

  const handleCancel = useCallback(() => setPreview([]), []);

  const canStraighten = job?.status === "done" && selection.length === 1;

  return (
    <div className="panel straightener-panel">
      <h3>Row straightener</h3>
      <p className="hint-text">Select one slot to straighten its row.</p>
      {preview.length === 0 ? (
        <button
          className="btn btn-sm"
          onClick={handleStraighten}
          disabled={!canStraighten || loading}
        >
          {loading ? "Detecting row..." : "Straighten row"}
        </button>
      ) : (
        <div className="btn-group">
          <button className="btn btn-sm btn-accent" onClick={handleAccept}>
            Accept ({preview.length} slots)
          </button>
          <button className="btn btn-sm btn-ghost" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
