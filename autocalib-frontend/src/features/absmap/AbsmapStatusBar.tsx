import { Trans, useTranslation } from 'react-i18next';
import type { EditMode } from '../../types';
import { StatusBar, StatusDot, StatusToolBadge } from '../../ui/StatusBar';
import { Kbd } from '../../ui/Kbd';
import styles from '../../ui/StatusBar.module.css';

const BULK_CONFIRM_THRESHOLD = 1;

interface AbsmapStatusBarProps {
  editMode: EditMode;
  isDrawing: boolean;
  selectionCount: number;
  isDirty: boolean;
  pipelineHint?: string | null;
}

function modeLabelKey(editMode: EditMode, isDrawing: boolean): string {
  if (isDrawing) return 'statusBar.absmap.drawing';
  if (editMode === 'none') return 'statusBar.absmap.select';
  return `statusBar.absmap.modes.${editMode}`;
}

function modeHintKey(editMode: EditMode, isDrawing: boolean): string {
  if (isDrawing) return 'statusBar.absmap.hints.drawing';
  if (editMode === 'none') return 'statusBar.absmap.hints.select';
  return `statusBar.absmap.hints.${editMode}`;
}

function isDestructiveMode(editMode: EditMode): boolean {
  return editMode === 'eraser' || editMode === 'bulk_delete';
}

export function AbsmapStatusBar({
  editMode,
  isDrawing,
  selectionCount,
  isDirty,
  pipelineHint,
}: AbsmapStatusBarProps) {
  const { t } = useTranslation();
  const destructive = !isDrawing && isDestructiveMode(editMode);

  return (
    <StatusBar
      left={
        <>
          <StatusToolBadge destructive={destructive}>
            {t(modeLabelKey(editMode, isDrawing))}
          </StatusToolBadge>
          {selectionCount > 0 && (
            <>
              <StatusDot />
              <span>{t('statusBar.absmap.selectedCount', { count: selectionCount })}</span>
            </>
          )}
        </>
      }
      center={
        pipelineHint ? (
          <span>{pipelineHint}</span>
        ) : (
          <Trans
            i18nKey={modeHintKey(editMode, isDrawing)}
            components={{ kDel: <Kbd size="xs">Del</Kbd>, kEsc: <Kbd size="xs">Esc</Kbd> }}
          />
        )
      }
      right={
        <>
          {isDirty && (
            <span className={styles.unsaved}>{t('statusBar.unsaved')}</span>
          )}
          {selectionCount > BULK_CONFIRM_THRESHOLD && editMode === 'none' && (
            <>
              <StatusDot />
              <span className={styles.hint}>
                <Kbd size="xs">Del</Kbd> {t('statusBar.absmap.deleteSelection')}
              </span>
            </>
          )}
          {(isDrawing || editMode !== 'none') && (
            <>
              <StatusDot />
              <span className={styles.hint}>
                <Kbd size="xs">Esc</Kbd> {t('statusBar.exitTool')}
              </span>
            </>
          )}
        </>
      }
    />
  );
}
