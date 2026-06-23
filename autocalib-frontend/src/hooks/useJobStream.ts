import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchJobResult, markJobFailed, updateJobProgress } from '../store/autocalib-slice';
import { streamJobProgress, getPipelineJob } from '../api/autocalib-api';
import { createLogger } from '../utils/logger';

const log = createLogger('sse');

/** Poll fallback for long CPU jobs — proxies often drop SSE before `done`. */
const JOB_POLL_INTERVAL_MS = 20_000;

export function useJobStream(): void {
  const dispatch = useAppDispatch();
  const jobId = useAppSelector((s) => s.autocalib.absmap.job?.id);
  const jobStatus = useAppSelector((s) => s.autocalib.absmap.job?.status);
  const statusRef = useRef(jobStatus);
  statusRef.current = jobStatus;
  const terminalHandledRef = useRef(false);

  useEffect(() => {
    if (!jobId || statusRef.current === 'done' || statusRef.current === 'failed') return;

    terminalHandledRef.current = false;

    const handleTerminal = (status: 'done' | 'failed', error?: string) => {
      if (terminalHandledRef.current) return;
      terminalHandledRef.current = true;
      if (status === 'done') {
        log.info(`Job ${jobId} done — fetching result`);
        void dispatch(fetchJobResult(jobId));
      } else {
        dispatch(markJobFailed(error ?? 'Pipeline failed on server'));
      }
    };

    const pollJobStatus = async () => {
      if (terminalHandledRef.current) return;
      if (statusRef.current === 'done' || statusRef.current === 'failed') return;
      try {
        const j = await getPipelineJob(jobId);
        if (j.status === 'done') {
          log.info(`Poll: job ${jobId} is done`);
          handleTerminal('done');
        } else if (j.status === 'failed') {
          log.warn(`Poll: job ${jobId} failed`);
          handleTerminal('failed', j.error ?? undefined);
        }
      } catch {
        /* Job may be 404 after container restart */
      }
    };

    log.info(`Opening SSE stream for job ${jobId}`);

    const pollTimer = window.setInterval(() => {
      void pollJobStatus();
    }, JOB_POLL_INTERVAL_MS);
    void pollJobStatus();

    const cleanup = streamJobProgress(
      jobId,
      (progress) => dispatch(updateJobProgress(progress)),
      () => handleTerminal('done'),
      () => {
        void getPipelineJob(jobId)
          .then((j) => handleTerminal('failed', j.error ?? undefined))
          .catch(() => handleTerminal('failed'));
      },
      () => {
        log.warn(`SSE stream error for job ${jobId} — polling for terminal status`);
        void pollJobStatus();
      },
    );

    return () => {
      log.info(`Closing SSE stream for job ${jobId}`);
      window.clearInterval(pollTimer);
      cleanup();
    };
  }, [jobId, dispatch]);
}
