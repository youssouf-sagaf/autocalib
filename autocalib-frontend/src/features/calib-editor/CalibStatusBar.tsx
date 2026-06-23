import { Trans, useTranslation } from 'react-i18next';
import type { CalibEditMode } from '../../types';
import { StatusBar, StatusDot, StatusToolBadge } from '../../ui/StatusBar';
import { Kbd } from '../../ui/Kbd';
import styles from '../../ui/StatusBar.module.css';

interface CalibStatusBarProps {
  editMode: CalibEditMode;
  bboxCount: number;
  selectedCount: number;
}

const CALIB_HINT_MODES = new Set<CalibEditMode>(['select', 'lasso_select', 'add', 'modify']);

function modeLabelKey(editMode: CalibEditMode): string {
  if (editMode === 'none') return 'statusBar.calib.select';
  return `statusBar.calib.modes.${editMode}`;
}

function modeHintKey(editMode: CalibEditMode): string {
  if (CALIB_HINT_MODES.has(editMode)) {
    return `statusBar.calib.hints.${editMode}`;
  }
  return 'statusBar.calib.hint';
}

export function CalibStatusBar({ editMode, bboxCount, selectedCount }: CalibStatusBarProps) {
  const { t } = useTranslation();

  return (
    <StatusBar
      left={
        <>
          <StatusToolBadge>{t(modeLabelKey(editMode))}</StatusToolBadge>
          <StatusDot />
          <span>{t('statusBar.calib.bboxCount', { count: bboxCount })}</span>
          {selectedCount > 0 && (
            <>
              <StatusDot />
              <span>{t('statusBar.calib.selectedCount', { count: selectedCount })}</span>
            </>
          )}
        </>
      }
      center={
        <Trans
          i18nKey={modeHintKey(editMode)}
          components={{ kDel: <Kbd size="xs">Del</Kbd>, kEsc: <Kbd size="xs">Esc</Kbd> }}
        />
      }
      right={
        editMode !== 'none' && editMode !== 'select' ? (
          <span className={styles.hint}>
            <Kbd size="xs">Esc</Kbd> {t('statusBar.exitTool')}
          </span>
        ) : null
      }
    />
  );
}
