import type { PipelineJob } from "../../types";

interface JobStatusProps {
  job: PipelineJob;
}

export function JobStatus({ job }: JobStatusProps) {
  const statusColor: Record<string, string> = {
    pending: "var(--color-warning)",
    running: "var(--color-info)",
    done: "var(--color-success)",
    failed: "var(--color-error)",
  };

  const progress = job.progress;
  const overallPercent = progress
    ? Math.round(((progress.crop_index + progress.percent / 100) / progress.crop_total) * 100)
    : 0;

  return (
    <div className="job-status">
      <div className="status-badge" style={{ color: statusColor[job.status] ?? "#888" }}>
        {job.status.toUpperCase()}
      </div>

      {progress && (
        <div className="progress-detail">
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${overallPercent}%` }} />
          </div>
          <span className="progress-label">
            Crop {progress.crop_index + 1}/{progress.crop_total} — {progress.stage} ({progress.percent}%)
          </span>
        </div>
      )}

      {job.status === "done" && <span className="done-label">Results ready</span>}
      {job.error && <span className="error-label">{job.error}</span>}
    </div>
  );
}
