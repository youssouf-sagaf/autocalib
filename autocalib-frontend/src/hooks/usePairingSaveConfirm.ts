import { useCallback, useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { saveCalibrationFromState } from '../store/autocalib-slice';
import { deletedPairingSlotIds } from '../utils/calibrationDb';
import { registerPairingSaveRequest } from './pairingSaveGate';

export function usePairingSaveConfirm() {
  const dispatch = useAppDispatch();
  const prodPairingBySlotId = useAppSelector((s) => s.autocalib.calib.prodPairingBySlotId);
  const draftPairingBySlotId = useAppSelector((s) => s.autocalib.pairing.pairingBySlotId);
  const [open, setOpen] = useState(false);
  const [deletedCount, setDeletedCount] = useState(0);

  const executeSave = useCallback(() => {
    void dispatch(saveCalibrationFromState());
  }, [dispatch]);

  const requestSave = useCallback(() => {
    const deleted = deletedPairingSlotIds(prodPairingBySlotId, draftPairingBySlotId);
    if (deleted.length === 0) {
      executeSave();
      return;
    }
    setDeletedCount(deleted.length);
    setOpen(true);
  }, [prodPairingBySlotId, draftPairingBySlotId, executeSave]);

  useEffect(() => {
    registerPairingSaveRequest(requestSave);
    return () => registerPairingSaveRequest(null);
  }, [requestSave]);

  const confirmSave = useCallback(() => {
    setOpen(false);
    executeSave();
  }, [executeSave]);

  const cancelSave = useCallback(() => {
    setOpen(false);
    setDeletedCount(0);
  }, []);

  return {
    open,
    deletedCount,
    confirmSave,
    cancelSave,
  };
}
