import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  getCalibPreview,
  lastPicObjectDataUrl,
  postCalibPreviewRefresh,
} from '../../api/autocalib-api';
import type { CalibPreviewImage, CalibPreviewResponse, CalibPreviewRefreshStatus } from '../../types';
import { defaultPreviewSelection } from './calib-preview-utils';

const POLL_MS = 4000;
/** Poll GET after POST until terminal status or images (~6 min). */
const MAX_POLL_ATTEMPTS = 90;

export type CalibPreviewRefreshHint = 'accepted' | 'already_running' | null;

function isRefreshRunning(status: CalibPreviewRefreshStatus | undefined): boolean {
  return status === 'running';
}

function previewErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') {
    return err.response.data.detail;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export interface UseCalibPreviewResult {
  data: CalibPreviewResponse | null;
  loading: boolean;
  refreshing: boolean;
  loaded: boolean;
  error: string | null;
  pollAttempt: number;
  refreshStatus: CalibPreviewRefreshStatus;
  refreshHint: CalibPreviewRefreshHint;
  selected: CalibPreviewImage | null;
  setSelected: (item: CalibPreviewImage) => void;
  /** POST /calib-preview/refresh then poll GET until completed or failed. */
  refresh: () => Promise<void>;
  getImageUrl: (objectKey: string) => Promise<string | null>;
  imageCache: ReadonlyMap<string, string>;
}

export function useCalibPreview(deviceId: string | null): UseCalibPreviewResult {
  const [data, setData] = useState<CalibPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [refreshHint, setRefreshHint] = useState<CalibPreviewRefreshHint>(null);
  const [selected, setSelected] = useState<CalibPreviewImage | null>(null);
  const [imageCache, setImageCache] = useState<Map<string, string>>(new Map());
  const imageCacheRef = useRef<Map<string, string>>(new Map());
  const inflightKeysRef = useRef<Set<string>>(new Set());

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAttemptRef = useRef(0);
  const pollingActiveRef = useRef(false);
  const deviceIdRef = useRef(deviceId);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollAttemptRef.current = 0;
    pollingActiveRef.current = false;
    setPollAttempt(0);
  }, []);

  const stopPolling = useCallback(
    (options?: { errorKey?: string; keepHint?: boolean }) => {
      pollingActiveRef.current = false;
      clearPoll();
      setRefreshing(false);
      if (!options?.keepHint) {
        setRefreshHint(null);
      }
      if (options?.errorKey) {
        setError(options.errorKey);
      }
    },
    [clearPoll],
  );

  const applyPreview = useCallback((payload: CalibPreviewResponse) => {
    setData(payload);
    const items = payload.top_occupied_images ?? [];
    setSelected((prev) => {
      if (prev && items.some((i) => i.rank === prev.rank)) return prev;
      return defaultPreviewSelection(items);
    });
  }, []);

  const fetchPreview = useCallback(async (): Promise<CalibPreviewResponse | null> => {
    if (!deviceId) return null;
    const payload = await getCalibPreview(deviceId);
    if (deviceIdRef.current !== deviceId) return null;
    applyPreview(payload);
    return payload;
  }, [deviceId, applyPreview]);

  const evaluatePollResult = useCallback(
    (payload: CalibPreviewResponse): 'continue' | 'done' | 'failed' | 'timeout' => {
      const status = payload.refresh?.status ?? 'idle';
      const hasImages = (payload.top_occupied_images?.length ?? 0) > 0;

      if (hasImages) return 'done';
      if (status === 'failed') return 'failed';
      if (status === 'completed') return 'done';
      if (pollAttemptRef.current >= MAX_POLL_ATTEMPTS) return 'timeout';
      if (isRefreshRunning(status) || pollingActiveRef.current) return 'continue';
      return 'continue';
    },
    [],
  );

  const schedulePoll = useCallback(() => {
    clearPoll();
    pollingActiveRef.current = true;
    setRefreshing(true);

    const tick = async () => {
      pollAttemptRef.current += 1;
      setPollAttempt(pollAttemptRef.current);
      try {
        const payload = await fetchPreview();
        if (!payload || !pollingActiveRef.current) return;

        const outcome = evaluatePollResult(payload);
        if (outcome === 'done') {
          stopPolling();
          return;
        }
        if (outcome === 'failed') {
          stopPolling({ errorKey: 'calib.preview.refreshFailed' });
          return;
        }
        if (outcome === 'timeout') {
          stopPolling({ errorKey: 'calib.preview.pollTimeout' });
          return;
        }
        pollTimerRef.current = setTimeout(tick, POLL_MS);
      } catch (err: unknown) {
        if (pollingActiveRef.current && pollAttemptRef.current < MAX_POLL_ATTEMPTS) {
          pollTimerRef.current = setTimeout(tick, POLL_MS);
          return;
        }
        stopPolling({ errorKey: previewErrorMessage(err, 'calib.preview.pollFailed') });
      }
    };

    pollTimerRef.current = setTimeout(tick, POLL_MS);
  }, [clearPoll, fetchPreview, evaluatePollResult, stopPolling]);

  useEffect(() => {
    deviceIdRef.current = deviceId;
    stopPolling();
    setData(null);
    setSelected(null);
    setError(null);
    setLoaded(false);
    setRefreshHint(null);
    imageCacheRef.current = new Map();
    inflightKeysRef.current = new Set();
    setImageCache(new Map());

    if (!deviceId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void fetchPreview()
      .then((payload) => {
        if (cancelled || !payload) return;
        if (isRefreshRunning(payload.refresh?.status)) {
          setRefreshHint('already_running');
          schedulePoll();
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(previewErrorMessage(err, 'calib.preview.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [deviceId, fetchPreview, schedulePoll, stopPolling]);

  const refresh = useCallback(async () => {
    if (!deviceId) return;
    setError(null);
    setRefreshing(true);

    let postResult: Awaited<ReturnType<typeof postCalibPreviewRefresh>>;
    try {
      postResult = await postCalibPreviewRefresh(deviceId);
    } catch (err: unknown) {
      stopPolling();
      setError(previewErrorMessage(err, 'calib.preview.postFailed'));
      return;
    }

    setRefreshHint(postResult.alreadyRunning ? 'already_running' : 'accepted');
    schedulePoll();

    try {
      await fetchPreview();
    } catch (err: unknown) {
      setError(previewErrorMessage(err, 'calib.preview.pollFailed'));
    }
  }, [deviceId, fetchPreview, schedulePoll, stopPolling]);

  const getImageUrl = useCallback(async (objectKey: string): Promise<string | null> => {
    if (!deviceId) return null;
    const cached = imageCacheRef.current.get(objectKey);
    if (cached) return cached;
    if (inflightKeysRef.current.has(objectKey)) return null;

    inflightKeysRef.current.add(objectKey);
    try {
      const dataUrl = await lastPicObjectDataUrl(deviceId, objectKey);
      if (!dataUrl || deviceIdRef.current !== deviceId) return null;
      imageCacheRef.current.set(objectKey, dataUrl);
      setImageCache(new Map(imageCacheRef.current));
      return dataUrl;
    } finally {
      inflightKeysRef.current.delete(objectKey);
    }
  }, [deviceId]);

  const refreshStatus: CalibPreviewRefreshStatus = data?.refresh?.status ?? 'idle';

  return {
    data,
    loading,
    refreshing,
    loaded,
    error,
    pollAttempt,
    refreshStatus,
    refreshHint,
    selected,
    setSelected,
    refresh,
    getImageUrl,
    imageCache,
  };
}
