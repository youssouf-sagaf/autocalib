import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  pairingSetTool,
  pairingDeleteZone,
  pairingUnpairActiveZone,
  pairingToggleAutoSuggestMode,
  pairingUndo,
  pairingRedo,
} from '../../store/autocalib-slice';
import type { PairingTool } from '../../types';
import {
  IconDiamond,
  IconLink,
  IconScissors,
  IconTrash,
} from '../../ui/ToolbarIcons';
import { ToolDock, ToolDockButton, ToolDockGroup, ToolDockSep } from '../../ui/ToolDock';
import { useAbsmapDisplaySlots } from '../../hooks/useAbsmapDisplaySlots';
import { visibleCalibBboxes } from '../../utils/calibVisibility';
import { useMemo } from 'react';
import { usePairingReverse } from '../../hooks/usePairingReverse';

export function PairingEditRail({ onRequestReverse }: { onRequestReverse: () => void }) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const pairing = useAppSelector((s) => s.autocalib.pairing);
  const {
    activeTool, editHistory, editIndex,
  } = pairing;

  const displaySlots = useAbsmapDisplaySlots();
  const calibBboxes = useAppSelector((s) => s.autocalib.calib.bboxes);
  const confidenceThreshold = useAppSelector((s) => s.autocalib.calib.confidenceThreshold);
  const visibleBboxLen = useMemo(
    () => visibleCalibBboxes(calibBboxes, confidenceThreshold).length,
    [calibBboxes, confidenceThreshold],
  );
  const { autoSuggestMode } = pairing;
  const { canReverse, reverseSide, activeZone } = usePairingReverse();

  const canPairingUndo = editIndex > 0;
  const canPairingRedo = editIndex < editHistory.length;

  const setTool = useCallback(
    (tool: PairingTool) => dispatch(pairingSetTool(activeTool === tool ? 'none' : tool)),
    [dispatch, activeTool],
  );

  const sideWord =
    reverseSide === 'map' ? t('pairing.sideMap') : t('pairing.sideImage');

  return (
    <ToolDock ariaLabel={t('pairing.railAria')} defaultExpanded>
      <ToolDockGroup label={t('toolDock.groups.pairing')}>
        <ToolDockButton
          active={activeTool === 'pair'}
          icon={<IconLink />}
          label={t('pairing.pair')}
          shortcut="P"
          onClick={() => setTool('pair')}
        />
        <ToolDockButton
          active={activeTool === 'unpair'}
          icon={<IconScissors />}
          label={t('pairing.unpair')}
          shortcut="U"
          onClick={() => setTool('unpair')}
        />
        <ToolDockButton
          active={activeTool === 'draw_zone'}
          icon={<IconDiamond />}
          label={t('pairing.zone')}
          shortcut="Z"
          onClick={() => setTool('draw_zone')}
        />
        <ToolDockButton
          active={autoSuggestMode}
          ai
          icon="⚡"
          label={autoSuggestMode ? t('pairing.autoSuggestOn') : t('pairing.autoSuggest')}
          shortcut="Q"
          disabled={displaySlots.length === 0 || visibleBboxLen === 0}
          onClick={() => dispatch(pairingToggleAutoSuggestMode())}
        />
      </ToolDockGroup>

      <ToolDockSep />

      <ToolDockGroup label={t('toolDock.groups.zone')}>
        <ToolDockButton
          icon="↕"
          label={t('pairing.reverse')}
          shortcut="R"
          disabled={!canReverse}
          onClick={onRequestReverse}
          title={
            !canReverse
              ? t('pairing.reverseNoPairings')
              : activeZone
                ? t('pairing.reverseOk', { side: sideWord })
                : t('pairing.reverseProdOk', { side: sideWord })
          }
        />
        <ToolDockButton
          icon={<IconScissors />}
          label={t('pairing.unpairZone')}
          disabled={!activeZone}
          onClick={() => dispatch(pairingUnpairActiveZone())}
        />
        <ToolDockButton
          destructive
          icon={<IconTrash />}
          label={t('pairing.deleteZone')}
          shortcut="Del"
          disabled={!activeZone}
          onClick={() => activeZone && dispatch(pairingDeleteZone(activeZone.id))}
        />
      </ToolDockGroup>

      <ToolDockSep />

      <ToolDockGroup label={t('toolDock.groups.history')}>
        <ToolDockButton
          icon="↶"
          label={t('common.undoBack')}
          shortcut="⌘Z"
          disabled={!canPairingUndo}
          onClick={() => dispatch(pairingUndo())}
        />
        <ToolDockButton
          icon="↷"
          label={t('common.redo')}
          shortcut="⌘⇧Z"
          disabled={!canPairingRedo}
          onClick={() => dispatch(pairingRedo())}
        />
      </ToolDockGroup>
    </ToolDock>
  );
}
