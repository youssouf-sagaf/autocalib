import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useWorkspaceNavigate } from '../../hooks/useWorkspaceNavigate';
import { useTranslation } from 'react-i18next';
import { useAppSelector, useAppDispatch } from '../../store/hooks';
import { toggleDualMap, toggleSidebar } from '../../store/autocalib-slice';
import { SearchBar } from './SearchBar';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { ContextHeader } from './ContextHeader';
import { CommandPalette } from '../command-palette/CommandPalette';
import {
  createAllCommands,
  type WorkspaceCommandActions,
} from '../command-palette/commandRegistry';
import { CommandPaletteVisibilityContext, useCommandPalette } from '../command-palette/useCommandPalette';
import { ShortcutOverlay } from '../shortcuts/ShortcutOverlay';
import { ClientPicker } from '../client-picker/ClientPicker';
import { DevicePicker } from '../device-picker/DevicePicker';
import { useKeyboardShortcuts, SHORTCUT_PRIORITY } from '../../keyboard/useKeyboardShortcuts';
import { eventMatchesDisplay } from '../../keyboard/matchShortcut';
import styles from './AppShell.module.css';
import { useCalibJobStream } from '../calib-editor/useCalibJobStream';
import { useWorkspaceSave } from '../../hooks/useWorkspaceSave';

interface AppShellProps {
  children: ReactNode;
  leftRail?: ReactNode;
  /** Pairing uses `top` so a tall dock does not straddle the map/image split. */
  leftRailAlign?: 'center' | 'top';
  floatingToolbar?: ReactNode;
  statusBar?: ReactNode;
  headerCenter?: ReactNode;
  headerExtras?: ReactNode;
  onFlyTo?: (lng: number, lat: number) => void;
  workspaceCommands?: WorkspaceCommandActions;
}

export function AppShell({
  children,
  leftRail,
  leftRailAlign = 'center',
  floatingToolbar,
  statusBar,
  headerCenter,
  headerExtras,
  onFlyTo,
  workspaceCommands,
}: AppShellProps) {
  useCalibJobStream();
  const workspaceSave = useWorkspaceSave();
  const { t } = useTranslation();

  const dispatch = useAppDispatch();
  const navigate = useWorkspaceNavigate();
  const location = useLocation();
  const dualMapActive = useAppSelector((s) => s.autocalib.absmap.dualMapActive);
  const hasSlots = useAppSelector(
    (s) =>
      s.autocalib.absmap.slots.length > 0
      || s.autocalib.absmap.baselineSlots.length > 0
      || s.autocalib.absmap.b2bSnapshotAtLoad.length > 0,
  );

  const [pickerMode, setPickerMode] = useState<'client' | 'device' | null>(null);
  const [shortcutOverlayOpen, setShortcutOverlayOpen] = useState(false);

  const prefersDevicePicker =
    location.pathname.startsWith('/calib') || location.pathname.startsWith('/pairing');

  const openClientPicker = useCallback(() => setPickerMode('client'), []);
  const openDevicePicker = useCallback(() => setPickerMode('device'), []);

  const commands = useMemo(
    () =>
      createAllCommands(
        navigate,
        {
          toggleDualMap: () => dispatch(toggleDualMap()),
          toggleSidebar: () => dispatch(toggleSidebar()),
          openClientPicker,
          openDevicePicker,
          openShortcuts: () => setShortcutOverlayOpen(true),
          onSave: workspaceSave.canSave ? workspaceSave.save : undefined,
        },
        t,
        location.pathname,
        workspaceCommands,
      ),
    [navigate, dispatch, t, openClientPicker, openDevicePicker, workspaceSave.canSave, workspaceSave.save, location.pathname, workspaceCommands],
  );

  const {
    isOpen: isCommandPaletteOpen,
    query,
    selectedIndex,
    filteredCommands,
    openPalette,
    closePalette,
    updateQuery,
    moveSelection,
    executeSelected,
    executeAtIndex,
  } = useCommandPalette(commands);

  const globalShortcutHandler = useCallback(
    (event: KeyboardEvent) => {
      if (isCommandPaletteOpen) return false;

      if (eventMatchesDisplay(event, '⌘K')) {
        event.preventDefault();
        openPalette();
        return true;
      }
      if (eventMatchesDisplay(event, '⌘B')) {
        event.preventDefault();
        dispatch(toggleSidebar());
        return true;
      }
      if (eventMatchesDisplay(event, '⌘D')) {
        event.preventDefault();
        setPickerMode((p) => (p ? null : prefersDevicePicker ? 'device' : 'client'));
        return true;
      }
      if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        setShortcutOverlayOpen((p) => !p);
        return true;
      }
      if (eventMatchesDisplay(event, '⌘1')) {
        event.preventDefault();
        navigate('/absmap');
        return true;
      }
      if (eventMatchesDisplay(event, '⌘2')) {
        event.preventDefault();
        navigate('/calib');
        return true;
      }
      if (eventMatchesDisplay(event, '⌘3')) {
        event.preventDefault();
        navigate('/pairing');
        return true;
      }
      if (eventMatchesDisplay(event, '⌘H')) {
        event.preventDefault();
        navigate('/');
        return true;
      }
      if (eventMatchesDisplay(event, '⌘⇧M') && location.pathname === '/absmap') {
        event.preventDefault();
        if (hasSlots) dispatch(toggleDualMap());
        return true;
      }
      if (eventMatchesDisplay(event, '⌘S') && workspaceSave.canSave) {
        event.preventDefault();
        workspaceSave.save();
        return true;
      }
      if (event.key === 'Escape') {
        if (shortcutOverlayOpen) {
          setShortcutOverlayOpen(false);
          event.preventDefault();
          return true;
        }
        if (pickerMode) {
          setPickerMode(null);
          event.preventDefault();
          return true;
        }
      }
      return false;
    },
    [
      isCommandPaletteOpen,
      openPalette,
      dispatch,
      navigate,
      prefersDevicePicker,
      location.pathname,
      hasSlots,
      workspaceSave,
      shortcutOverlayOpen,
      pickerMode,
    ],
  );

  useKeyboardShortcuts([
    {
      priority: SHORTCUT_PRIORITY.global,
      handler: globalShortcutHandler,
    },
  ]);

  useEffect(() => {
    const onDevice = () => setPickerMode('device');
    const onClient = () => setPickerMode('client');
    window.addEventListener('autocalib:open-device-picker', onDevice);
    window.addEventListener('autocalib:open-client-picker', onClient);
    return () => {
      window.removeEventListener('autocalib:open-device-picker', onDevice);
      window.removeEventListener('autocalib:open-client-picker', onClient);
    };
  }, []);

  useEffect(() => {
    closePalette();
  }, [closePalette, location.pathname]);

  const rightSlot = (
    <div className={styles.headerActions}>
      {headerExtras ? (
        <div className={styles.headerExtras}>{headerExtras}</div>
      ) : null}
      {onFlyTo ? (
        <div className={styles.headerSearch}>
          <SearchBar onFlyTo={onFlyTo} />
        </div>
      ) : null}
      {location.pathname === '/absmap' && (
        <div className={styles.headerViewTools}>
          <button
            className={`${styles.dualBtn} ${dualMapActive ? styles.active : ''}`}
            disabled={!hasSlots}
            onClick={() => dispatch(toggleDualMap())}
            title={hasSlots ? t('appShell.dualMapTitleOn') : t('appShell.dualMapTitleWait')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="2" width="6" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
              <rect x="9" y="2" width="6" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {t('appShell.dualMap')}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <CommandPaletteVisibilityContext.Provider value={isCommandPaletteOpen}>
      <div className={styles.shell}>
        <WorkspaceSidebar
          onOpenShortcuts={() => setShortcutOverlayOpen(true)}
        />

        <div className={styles.main}>
          <ContextHeader
            onOpenClientPicker={openClientPicker}
            onOpenDevicePicker={openDevicePicker}
            centerSlot={headerCenter}
            rightSlot={rightSlot}
          />

          <div className={styles.content}>
            <div className={styles.canvasStage}>
              <div className={styles.stageBody}>{children}</div>
              {leftRail && (
                <div
                  className={
                    leftRailAlign === 'top'
                      ? `${styles.leftRailAnchor} ${styles.leftRailAnchorTop}`
                      : styles.leftRailAnchor
                  }
                >
                  {leftRail}
                </div>
              )}
              {floatingToolbar && (
                <div className={styles.floatingToolbar}>{floatingToolbar}</div>
              )}
              {statusBar && <div className={styles.statusBarAnchor}>{statusBar}</div>}
            </div>
          </div>
        </div>
      </div>

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        query={query}
        selectedIndex={selectedIndex}
        commands={filteredCommands}
        onClose={closePalette}
        onQueryChange={updateQuery}
        onMoveSelection={moveSelection}
        onExecuteSelected={executeSelected}
        onExecuteAtIndex={executeAtIndex}
      />

      {shortcutOverlayOpen && (
        <ShortcutOverlay onClose={() => setShortcutOverlayOpen(false)} />
      )}

      {pickerMode === 'client' && (
        <ClientPicker onClose={() => setPickerMode(null)} />
      )}
      {pickerMode === 'device' && (
        <DevicePicker onClose={() => setPickerMode(null)} />
      )}
    </CommandPaletteVisibilityContext.Provider>
  );
}
