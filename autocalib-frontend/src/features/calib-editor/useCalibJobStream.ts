import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  calibUpdateProgress,
  calibMarkFailed,
  fetchCalibResult,
} from '../../store/autocalib-slice';
import { streamCalibProgress } from '../../api/autocalib-api';

export function useCalibJobStream() {
  const dispatch = useAppDispatch();
  const jobId = useAppSelector((s) => s.autocalib.calib.jobId);
  const jobStatus = useAppSelector((s) => s.autocalib.calib.jobStatus);
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!jobId || (jobStatus !== 'pending' && jobStatus !== 'running')) {
      return;
    }

    unsub.current?.();
    unsub.current = streamCalibProgress(
      jobId,
      (progress) => dispatch(calibUpdateProgress(progress)),
      () => {
        dispatch(fetchCalibResult(jobId));
      },
      (errorMsg) => dispatch(calibMarkFailed(errorMsg)),
      () => dispatch(calibMarkFailed('Connection lost')),
    );

    return () => {
      unsub.current?.();
      unsub.current = null;
    };
  }, [dispatch, jobId, jobStatus]);
}
