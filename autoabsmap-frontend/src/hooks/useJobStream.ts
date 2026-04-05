import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { fetchJobResult, markJobFailed, updateJobProgress } from '../store/autoabsmap-slice';
import { streamJobProgress } from '../api/autoabsmap-api';
import { createLogger } from '../utils/logger';

const log = createLogger('sse');

export function useJobStream(): void {
  const dispatch = useAppDispatch();
  const jobId = useAppSelector((s) => s.absmap.job?.id);
  const jobStatus = useAppSelector((s) => s.absmap.job?.status);
  const statusRef = useRef(jobStatus);
  statusRef.current = jobStatus;

  useEffect(() => {
    if (!jobId || statusRef.current === 'done' || statusRef.current === 'failed') return;

    log.info(`Opening SSE stream for job ${jobId}`);

    const cleanup = streamJobProgress(
      jobId,
      (progress) => dispatch(updateJobProgress(progress)),
      () => {
        log.info(`SSE stream done for job ${jobId}, fetching result`);
        void dispatch(fetchJobResult(jobId));
      },
      () => {
        log.warn(`SSE stream: job ${jobId} failed on server`);
        dispatch(markJobFailed('Pipeline failed on server'));
      },
      (err) => log.error(`SSE stream error for job ${jobId}`, err),
    );

    return () => {
      log.info(`Closing SSE stream for job ${jobId}`);
      cleanup();
    };
  }, [jobId, dispatch]);
}
