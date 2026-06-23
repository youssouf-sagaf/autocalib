import { Trans, useTranslation } from 'react-i18next';
import type { PairingTool } from '../../types';
import { StatusBar, StatusDot, StatusToolBadge } from '../../ui/StatusBar';
import { Kbd } from '../../ui/Kbd';
import styles from '../../ui/StatusBar.module.css';
import { pairingStatusHintKey } from './pairingStatusHints';

interface PairingStatusBarProps {
  activeTool: PairingTool;
  pairsCount: number;
  bboxCount: number;
  zonesCount: number;
  autoSuggestMode: boolean;
  pendingChanges?: number;
  mapPtsLen: number;
  imgPtsLen: number;
  zoneMismatchError?: string | null;
}

function toolLabelKey(tool: PairingTool, auto: boolean): string {
  if (auto) return 'statusBar.pairing.autoSuggest';
  if (tool === 'none') return 'statusBar.pairing.default';
  return `statusBar.pairing.tools.${tool}`;
}

const PAIRING_HINT_KBD = {
  kCmdZ: <Kbd size="xs">⌘Z</Kbd>,
  kP: <Kbd size="xs">P</Kbd>,
  kU: <Kbd size="xs">U</Kbd>,
  kEsc: <Kbd size="xs">Esc</Kbd>,
  kZ: <Kbd size="xs">Z</Kbd>,
  kQ: <Kbd size="xs">Q</Kbd>,
};

export function PairingStatusBar({
  activeTool,
  pairsCount,
  bboxCount,
  zonesCount,
  autoSuggestMode,
  pendingChanges = 0,
  mapPtsLen,
  imgPtsLen,
  zoneMismatchError,
}: PairingStatusBarProps) {
  const { t } = useTranslation();
  const hintKey = pairingStatusHintKey({
    activeTool,
    autoSuggestMode,
    mapPtsLen,
    imgPtsLen,
    zoneMismatchError,
  });

  return (
    <StatusBar
      left={
        <>
          <StatusToolBadge destructive={activeTool === 'unpair'}>
            {t(toolLabelKey(activeTool, autoSuggestMode))}
          </StatusToolBadge>
          <StatusDot />
          <span>
            {t('common.pairsProgress', { paired: pairsCount, total: bboxCount })}
            {zonesCount > 0 ? ` · ${zonesCount} zones` : ''}
            {pendingChanges > 0
              ? ` · ${t('pairing.pendingChanges', { count: pendingChanges })}`
              : ''}
          </span>
        </>
      }
      center={
        zoneMismatchError ? (
          <Trans
            i18nKey={hintKey}
            values={{ message: zoneMismatchError }}
            components={{ strong: <strong /> }}
          />
        ) : (
          <Trans i18nKey={hintKey} components={PAIRING_HINT_KBD} />
        )
      }
      right={
        activeTool !== 'none' || autoSuggestMode ? (
          <span className={styles.hint}>
            <Kbd size="xs">Esc</Kbd> {t('statusBar.exitTool')}
          </span>
        ) : null
      }
    />
  );
}
