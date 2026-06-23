import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  calibSetEditMode,
  calibUndo,
  calibRedo,
  calibToggleLock,
  calibBulkRemove,
} from '../../store/autocalib-slice';
import type { CalibEditMode } from '../../types';
import { IconLock, IconLasso, IconUnlock, IconRemoveCalibSelection } from '../../ui/ToolbarIcons';
import { ToolDock, ToolDockButton, ToolDockGroup, ToolDockSep } from '../../ui/ToolDock';

interface CalibEditRailProps {
  isReference: boolean;
  interactive?: boolean;
}

export function CalibEditRail({ isReference, interactive = true }: CalibEditRailProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const calib = useAppSelector((s) => s.autocalib.calib);
  const { editMode, selectedBboxIds, lockedBboxIds, bboxes, editIndex, editHistory, showCalibEditorResult } =
    calib;

  const hasBboxes = bboxes.length > 0 && showCalibEditorResult;
  const hasSelection = selectedBboxIds.length > 0;
  const canUndo = editIndex > 0;
  const canRedo = editIndex < editHistory.length;
  const lockedSet = new Set(lockedBboxIds);
  const allSelectedLocked = hasSelection && selectedBboxIds.every((id) => lockedSet.has(id));
  const disabled = !hasBboxes || !isReference || !interactive;

  const setMode = useCallback(
    (mode: CalibEditMode) => {
      dispatch(calibSetEditMode(editMode === mode ? 'none' : mode));
    },
    [dispatch, editMode],
  );

  const handleLock = useCallback(() => {
    if (hasSelection) dispatch(calibToggleLock(selectedBboxIds));
  }, [dispatch, hasSelection, selectedBboxIds]);

  const handleRemoveSel = useCallback(() => {
    if (!hasSelection) return;
    const unlocked = selectedBboxIds.filter((id) => !lockedSet.has(id));
    if (unlocked.length > 0) dispatch(calibBulkRemove(unlocked));
  }, [dispatch, hasSelection, selectedBboxIds, lockedSet]);

  return (
    <ToolDock ariaLabel={t('calib.railAria')}>
      <ToolDockGroup label={t('toolDock.groups.selection')}>
        <ToolDockButton
          active={editMode === 'select'}
          icon="◎"
          label={t('calib.select')}
          shortcut="V"
          disabled={disabled}
          onClick={() => setMode('select')}
        />
        <ToolDockButton
          active={editMode === 'lasso_select'}
          icon={<IconLasso />}
          label={t('calib.lassoTool')}
          shortcut="L"
          disabled={disabled}
          onClick={() => setMode('lasso_select')}
        />
      </ToolDockGroup>

      <ToolDockSep />

      <ToolDockGroup label={t('toolDock.groups.edit')}>
        <ToolDockButton
          active={editMode === 'add'}
          icon="+"
          label={t('calib.add')}
          shortcut="A"
          disabled={disabled}
          onClick={() => setMode('add')}
        />
        <ToolDockButton
          active={editMode === 'modify'}
          icon="✎"
          label={t('calib.modify')}
          shortcut="M"
          disabled={disabled}
          onClick={() => setMode('modify')}
        />
      </ToolDockGroup>

      <ToolDockSep />

      <ToolDockGroup label={t('toolDock.groups.actions')}>
        <ToolDockButton
          active={allSelectedLocked}
          icon={allSelectedLocked ? <IconLock /> : <IconUnlock />}
          label={t('calib.lock')}
          shortcut="K"
          disabled={!hasSelection || disabled}
          onClick={handleLock}
        />
        <ToolDockButton
          destructive
          icon={<IconRemoveCalibSelection />}
          label={t('common.delete')}
          shortcut="Del"
          disabled={!hasSelection || disabled}
          onClick={handleRemoveSel}
        />
      </ToolDockGroup>

      <ToolDockSep />

      <ToolDockGroup label={t('toolDock.groups.history')}>
        <ToolDockButton
          icon="↶"
          label={t('common.undoBack')}
          shortcut="⌘Z"
          disabled={!canUndo || disabled}
          onClick={() => dispatch(calibUndo())}
        />
        <ToolDockButton
          icon="↷"
          label={t('common.redo')}
          shortcut="⌘⇧Z"
          disabled={!canRedo || disabled}
          onClick={() => dispatch(calibRedo())}
        />
      </ToolDockGroup>
    </ToolDock>
  );
}
