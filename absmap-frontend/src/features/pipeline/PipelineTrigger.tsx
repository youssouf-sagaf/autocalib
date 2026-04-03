import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { launchJob } from "../../store/absmap-slice";
import { JobStatus } from "./JobStatus";

export function PipelineTrigger() {
  const dispatch = useAppDispatch();
  const crops = useAppSelector((s) => s.absmap.crops);
  const job = useAppSelector((s) => s.absmap.job);

  const handleLaunch = useCallback(() => {
    dispatch(launchJob());
  }, [dispatch]);

  const isRunning = job?.status === "running" || job?.status === "pending";
  const canLaunch = crops.length > 0 && !isRunning;

  return (
    <div className="panel pipeline-panel">
      <h3>Pipeline</h3>
      <button className="btn btn-accent" onClick={handleLaunch} disabled={!canLaunch}>
        {isRunning ? "Running..." : `Launch (${crops.length} crop${crops.length !== 1 ? "s" : ""})`}
      </button>
      {job && <JobStatus job={job} />}
    </div>
  );
}
