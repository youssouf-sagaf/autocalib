import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { saveCalibrationFromState, saveSlotsToB2b } from '../store/autocalib-slice';
import { invokePairingSaveRequest } from './pairingSaveGate';

export type WorkspaceSaveKind = 'absmap' | 'calib' | 'pairing' | null;

export interface WorkspaceSaveState {
  kind: WorkspaceSaveKind;
  visible: boolean;
  canSave: boolean;
  isSaving: boolean;
  isDirty: boolean;
  saveError: string | null;
  title: string;
  labelKey: string;
  save: () => void;
}

export function useWorkspaceSave(): WorkspaceSaveState {
  const dispatch = useAppDispatch();
  const location = useLocation();

  const kind: WorkspaceSaveKind = location.pathname.startsWith('/calib')
    ? 'calib'
    : location.pathname.startsWith('/pairing')
      ? 'pairing'
      : location.pathname.startsWith('/absmap')
        ? 'absmap'
        : null;

  const absmap = useAppSelector((s) => s.autocalib.absmap);
  const calib = useAppSelector((s) => s.autocalib.calib);
  const context = useAppSelector((s) => s.autocalib.context);

  const hasClient = Boolean(context.clientId.trim() || context.clientName.trim());
  const deviceId = context.deviceId.trim() || calib.deviceId.trim();
  const pipelineBusy =
    absmap.job?.status === 'running' || absmap.job?.status === 'pending';
  const hasDraftAbsmapSlots = absmap.slots.some((slot) => !slot.slot_id.trim());

  const save = useCallback(() => {
    if (kind === 'absmap') {
      void dispatch(saveSlotsToB2b());
      return;
    }
    if (kind === 'calib' || kind === 'pairing') {
      if (kind === 'pairing' && invokePairingSaveRequest()) {
        return;
      }
      void dispatch(saveCalibrationFromState());
    }
  }, [dispatch, kind]);

  return useMemo((): WorkspaceSaveState => {
    if (kind === 'absmap') {
      const canSave = hasClient && absmap.isDirty && !pipelineBusy && !absmap.isSaving;
      return {
        kind,
        visible: true,
        canSave,
        isSaving: absmap.isSaving,
        isDirty: absmap.isDirty,
        saveError: absmap.saveError,
        title: absmap.isDirty ? 'absmapSession.saveDirty' : 'absmapSession.saveClean',
        labelKey: 'common.save',
        save,
      };
    }

    if (kind === 'calib') {
      const jobBusy = calib.jobStatus === 'pending' || calib.jobStatus === 'running';
      const hasBboxes = calib.bboxes.length > 0;
      const onGenerateTab = calib.viewTab === 'generate';
      const canSave = Boolean(
        deviceId && hasBboxes && !calib.isSavingCalibration && !jobBusy,
      );
      return {
        kind,
        visible: true,
        canSave,
        isSaving: calib.isSavingCalibration,
        isDirty: false,
        saveError: null,
        title: onGenerateTab ? 'calib.saveToProdTitle' : 'calib.saveCalibTitle',
        labelKey: onGenerateTab ? 'calib.saveToProd' : 'calib.saveCalib',
        save,
      };
    }

    if (kind === 'pairing') {
      const client = context.clientName.trim() || context.clientId.trim();
      const canSave = Boolean(client && deviceId && !hasDraftAbsmapSlots && !calib.isSavingCalibration);
      let title = 'pairing.saveTitleOk';
      if (hasDraftAbsmapSlots) title = 'pairing.saveTitleNeedAbsmapSave';
      else if (!client) title = 'pairing.saveTitleNeedClient';
      else if (!deviceId) title = 'pairing.saveTitleNeedDeviceOnly';
      return {
        kind,
        visible: true,
        canSave,
        isSaving: calib.isSavingCalibration,
        isDirty: false,
        saveError: null,
        title,
        labelKey: 'pairing.savePairings',
        save,
      };
    }

    return {
      kind: null,
      visible: false,
      canSave: false,
      isSaving: false,
      isDirty: false,
      saveError: null,
      title: '',
      labelKey: 'common.save',
      save,
    };
  }, [
    kind,
    hasClient,
    absmap.isDirty,
    absmap.isSaving,
    absmap.saveError,
    pipelineBusy,
    calib.bboxes.length,
    calib.isSavingCalibration,
    calib.jobStatus,
    calib.viewTab,
    calib.deviceId,
    deviceId,
    context.clientId,
    context.clientName,
    hasDraftAbsmapSlots,
    save,
  ]);
}
