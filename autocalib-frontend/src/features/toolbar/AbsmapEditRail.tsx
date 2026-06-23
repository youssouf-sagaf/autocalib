import { useTranslation } from 'react-i18next';
import type { EditMode } from '../../types';
import { IconEraser, IconLasso } from '../../ui/ToolbarIcons';
import { ToolDock, ToolDockButton, ToolDockGroup, ToolDockSep } from '../../ui/ToolDock';

interface AbsmapEditRailProps {
  editMode: EditMode;
  hasSlots: boolean;
  canCloneRow: boolean;
  canAddSlot: boolean;
  hasResults: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onToggleMode: (mode: EditMode) => void;
  onToggleEraserMode: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function AbsmapEditRail({
  editMode,
  hasSlots,
  canCloneRow,
  canAddSlot,
  hasResults,
  canUndo,
  canRedo,
  onToggleMode,
  onToggleEraserMode,
  onUndo,
  onRedo,
}: AbsmapEditRailProps) {
  const { t } = useTranslation();
  const isEraserMode = editMode === 'eraser';
  const isSelectMode = editMode === 'none';

  return (
    <ToolDock ariaLabel={t('absmapRail.ariaLabel')}>
      <ToolDockGroup label={t('toolDock.groups.selection')}>
        <ToolDockButton
          active={isSelectMode}
          icon="◎"
          label={t('absmapRail.select')}
          shortcut="V"
          title={t('absmapRail.titleSelect')}
          onClick={() => onToggleMode('none')}
        />
        <ToolDockButton
          active={editMode === 'bulk_delete'}
          destructive
          icon={<IconLasso />}
          label={t('absmapRail.lasso')}
          shortcut="L"
          disabled={!hasSlots}
          title={t('absmapRail.titleLasso')}
          onClick={() => onToggleMode('bulk_delete')}
        />
        <ToolDockButton
          active={isEraserMode}
          destructive
          icon={<IconEraser />}
          label={t('absmapRail.eraser')}
          shortcut="E"
          disabled={!hasSlots}
          title={t('absmapRail.titleEraser')}
          onClick={onToggleEraserMode}
        />
      </ToolDockGroup>

      <ToolDockSep />

      <ToolDockGroup label={t('toolDock.groups.edit')}>
        <ToolDockButton
          active={editMode === 'add'}
          icon="+"
          label={t('absmapRail.add')}
          shortcut="A"
          disabled={!canAddSlot}
          title={t('absmapRail.titleTool', { label: t('absmapRail.add'), shortcut: ' (A)' })}
          onClick={() => onToggleMode('add')}
        />
        <ToolDockButton
          active={editMode === 'tile_row'}
          icon="⫶"
          label={t('absmapRail.rowBrush')}
          shortcut="T"
          disabled={!canAddSlot}
          title={t('absmapRail.titleRowBrush', { shortcut: 'T' })}
          onClick={() => onToggleMode('tile_row')}
        />
        <ToolDockButton
          active={editMode === 'clone_row'}
          icon="⧉"
          label={t('absmapRail.cloneRow')}
          shortcut="⇧R"
          disabled={!canCloneRow}
          title={t('absmapRail.titleCloneRow', { shortcut: '⇧R' })}
          onClick={() => onToggleMode('clone_row')}
        />
        <ToolDockButton
          active={editMode === 'copy'}
          icon="⎘"
          label={t('absmapRail.copy')}
          shortcut="C"
          disabled={!hasSlots}
          title={t('absmapRail.titleTool', { label: t('absmapRail.copy'), shortcut: ' (C)' })}
          onClick={() => onToggleMode('copy')}
        />
        <ToolDockButton
          active={editMode === 'modify'}
          icon="✎"
          label={t('absmapRail.modify')}
          shortcut="M"
          disabled={!hasSlots}
          title={t('absmapRail.titleTool', { label: t('absmapRail.modify'), shortcut: ' (M)' })}
          onClick={() => onToggleMode('modify')}
        />
      </ToolDockGroup>

      <ToolDockSep />

      <ToolDockGroup label={t('toolDock.groups.ai')}>
        <ToolDockButton
          active={editMode === 'straighten'}
          icon="≡"
          label={t('absmapRail.straighten')}
          shortcut="Y"
          disabled={!hasSlots}
          ai
          title={t('absmapRail.titleStraighten', { shortcut: 'Y' })}
          onClick={() => onToggleMode('straighten')}
        />
        <ToolDockButton
          active={editMode === 'reprocess'}
          icon="↻"
          label={t('absmapRail.reprocess')}
          shortcut="B"
          disabled={!hasResults}
          title={t('absmapRail.titleReprocess', { shortcut: 'B' })}
          onClick={() => onToggleMode('reprocess')}
        />
      </ToolDockGroup>

      <ToolDockSep />

      <ToolDockGroup label={t('toolDock.groups.history')}>
        <ToolDockButton
          icon="↶"
          label={t('common.undoBack')}
          shortcut="⌘Z"
          disabled={!canUndo}
          title={t('absmapRail.titleUndo')}
          onClick={onUndo}
        />
        <ToolDockButton
          icon="↷"
          label={t('common.redo')}
          shortcut="⌘⇧Z"
          disabled={!canRedo}
          title={t('absmapRail.titleRedo')}
          onClick={onRedo}
        />
      </ToolDockGroup>
    </ToolDock>
  );
}
