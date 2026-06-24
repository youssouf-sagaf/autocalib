import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { loadClientSlots } from '../store/autocalib-slice';
import { activeClientDirectoryKey, isB2bClientId } from '../utils/clientContext';

/** Warm B2B reference slots when the active client can be resolved (dashboard or absmap). */
export function usePrefetchReferenceSlots(): void {
  const dispatch = useAppDispatch();
  const contextClientNameForRef = useAppSelector((s) => s.autocalib.context.clientName.trim());
  const contextB2bClientId = useAppSelector((s) => s.autocalib.context.clientId.trim());
  const cropsLen = useAppSelector((s) => s.autocalib.absmap.crops.length);
  const contextDirectoryKey = useAppSelector((s) => activeClientDirectoryKey(s.autocalib.context));
  const clientLocation = useAppSelector((s) =>
    contextDirectoryKey
      ? s.autocalib.directory.clientLocations[contextDirectoryKey] ?? null
      : null,
  );

  useEffect(() => {
    if (!contextClientNameForRef && !contextB2bClientId) return;
    const canLoadWithB2bId = isB2bClientId(contextB2bClientId);
    const canLoadWithGeo = cropsLen > 0 || clientLocation != null;
    if (canLoadWithB2bId || canLoadWithGeo) {
      void dispatch(loadClientSlots());
    }
  }, [
    dispatch,
    contextB2bClientId,
    contextClientNameForRef,
    cropsLen,
    clientLocation?.lat,
    clientLocation?.lng,
  ]);
}
