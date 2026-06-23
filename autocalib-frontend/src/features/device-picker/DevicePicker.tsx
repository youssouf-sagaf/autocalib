import { useState, useCallback, useEffect, useMemo } from 'react';
import { useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  setDeviceContext,
  removeRecentDevice,
  fetchClients,
  fetchDevicesForClient,
  directorySeedStaleDevices,
  invalidateDirectoryListing,
} from '../../store/autocalib-slice';
import type { RecentDevice } from '../../types';
import {
  activeClientDirectoryKey,
  clientDirectoryKeyFromSummary,
  devicesFetchArg,
  resolveClientFromDirectoryKey,
} from '../../utils/clientContext';
import { getRecentDeviceDisplayName } from '../../utils/recentDeviceDisplay';
import { readStaleDevicesFromSnapshot } from '../../utils/directoryCache';
import { scheduleDirectoryDevicePrefetch } from '../../utils/deviceDirectoryPrefetch';
import type { RootState } from '../../store/store';
import { Kbd } from '../../ui/Kbd';
import styles from './DevicePicker.module.css';

interface DevicePickerProps {
  onClose: () => void;
}

export function DevicePicker({ onClose }: DevicePickerProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const store = useStore();
  const context = useAppSelector((s) => s.autocalib.context);
  const directory = useAppSelector((s) => s.autocalib.directory);

  const [clientKey, setClientKey] = useState(activeClientDirectoryKey(context));
  const [deviceId, setDeviceId] = useState(context.deviceId);
  const [search, setSearch] = useState('');

  const clientsStableKey = useMemo(
    () => directory.clients.map((c) => c.client_id).join('|'),
    [directory.clients],
  );
  const prefetchRecentClients = useMemo(
    () => context.recentDevices.map((d) => d.client).filter(Boolean),
    [context.recentDevices],
  );

  useEffect(() => {
    if (directory.clientsStatus !== 'ready' || directory.clients.length === 0) return;
    scheduleDirectoryDevicePrefetch(
      dispatch,
      (store.getState() as RootState).autocalib.directory,
      activeClientDirectoryKey(context),
      prefetchRecentClients,
    );
  }, [
    dispatch,
    store,
    directory.clientsStatus,
    directory.clients.length,
    clientsStableKey,
    context.clientId,
    context.clientName,
    prefetchRecentClients,
  ]);

  useEffect(() => {
    if (directory.clientsStatus === 'idle') {
      dispatch(fetchClients());
    }
  }, [dispatch, directory.clientsStatus]);

  useEffect(() => {
    if (!clientKey) return;
    const status = directory.devicesStatus[clientKey];
    if (!status || status === 'idle') {
      const match = directory.clients.find((c) => clientDirectoryKeyFromSummary(c) === clientKey);
      if (match) dispatch(fetchDevicesForClient(devicesFetchArg(match)));
    }
  }, [dispatch, clientKey, directory.devicesStatus, directory.clients]);

  useEffect(() => {
    const clients = new Set(context.recentDevices.map((d) => d.client).filter(Boolean));
    clients.forEach((key) => {
      const st = directory.devicesStatus[key];
      if (!st || st === 'idle') {
        const match = directory.clients.find((c) => clientDirectoryKeyFromSummary(c) === key);
        if (match) dispatch(fetchDevicesForClient(devicesFetchArg(match)));
      }
    });
  }, [dispatch, context.recentDevices, directory.devicesStatus]);

  const devicesForClient = useMemo(
    () => (clientKey ? directory.devicesByClient[clientKey] ?? [] : []),
    [clientKey, directory.devicesByClient],
  );

  const devicesStatus = clientKey ? directory.devicesStatus[clientKey] ?? 'idle' : 'idle';
  const devicesError = clientKey ? directory.devicesError[clientKey] ?? null : null;

  const hasDeviceList = devicesForClient.length > 0;
  const deviceLoadingBlock = !hasDeviceList && devicesStatus === 'loading';

  const filteredRecent = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return context.recentDevices;
    return context.recentDevices.filter((d) => {
      const display = getRecentDeviceDisplayName(d, directory.devicesByClient).toLowerCase();
      return (
        display.includes(q) ||
        d.deviceId.toLowerCase().includes(q) ||
        d.client.toLowerCase().includes(q) ||
        Boolean(d.label?.toLowerCase().includes(q))
      );
    });
  }, [context.recentDevices, directory.devicesByClient, search]);

  const handleConfirm = useCallback(() => {
    if (clientKey && deviceId) {
      const device = devicesForClient.find((d) => d.device_id === deviceId);
      const resolved = resolveClientFromDirectoryKey(clientKey, directory.clients);
      dispatch(
        setDeviceContext({
          clientId: resolved.clientId,
          clientName: resolved.clientName,
          deviceId,
          label: device?.display_name,
        }),
      );
      onClose();
    }
  }, [dispatch, clientKey, deviceId, devicesForClient, directory.clients, onClose]);

  const handleSelectRecent = useCallback(
    (entry: RecentDevice) => {
      const devices = directory.devicesByClient[entry.client] ?? [];
      const match = devices.find((dev) => dev.device_id === entry.deviceId);
      const resolved = resolveClientFromDirectoryKey(entry.client, directory.clients);
      dispatch(
        setDeviceContext({
          clientId: resolved.clientId,
          clientName: resolved.clientName,
          deviceId: entry.deviceId,
          label: match?.display_name ?? entry.label,
        }),
      );
      onClose();
    },
    [dispatch, directory.devicesByClient, onClose],
  );

  const handleRemoveRecent = useCallback(
    (e: React.MouseEvent, c: string, d: string) => {
      e.stopPropagation();
      dispatch(removeRecentDevice({ client: c, deviceId: d }));
    },
    [dispatch],
  );

  const handleRefreshListing = useCallback(() => {
    dispatch(invalidateDirectoryListing());
    dispatch(fetchClients(true));
  }, [dispatch]);

  const handleRefreshDevices = useCallback(() => {
    if (!clientKey) return;
    const match = directory.clients.find((c) => clientDirectoryKeyFromSummary(c) === clientKey);
    if (match) dispatch(fetchDevicesForClient(devicesFetchArg(match, true)));
  }, [dispatch, clientKey, directory.clients]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [handleConfirm, onClose],
  );

  const clientsLoading = directory.clientsStatus === 'loading';
  const clientsError = directory.clientsError;

  const devicePlaceholder = !clientKey
    ? t('devicePicker.pickClientFirst')
    : deviceLoadingBlock
      ? t('devicePicker.loadingDevicesEllipsis')
      : devicesForClient.length === 0
        ? t('devicePicker.noDevicesForClient')
        : t('devicePicker.selectDevice');

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t('devicePicker.title')}</h2>
          <div className={styles.headerRight}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={handleRefreshListing}
              disabled={clientsLoading}
              title={t('devicePicker.refreshListingTitle')}
            >
              {t('common.refresh')}
            </button>
            <Kbd size="sm">⌘D</Kbd>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label={t('devicePicker.closeAria')}
              title={t('devicePicker.closeTitle')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>
              {t('devicePicker.client')}
              {clientsLoading && <span className={styles.helper}> · {t('devicePicker.loadingClientsShort')}</span>}
              {directory.clients.length > 0 && (
                <span className={styles.helper}> · {t('devicePicker.availableClients', { count: directory.clients.length })}</span>
              )}
            </label>
            <select
              className={styles.select}
              value={clientKey}
              onChange={(e) => {
                const key = e.target.value;
                setClientKey(key);
                setDeviceId('');
                if (key) {
                  const stale = readStaleDevicesFromSnapshot(key);
                  if (stale.length) {
                    dispatch(directorySeedStaleDevices({ clientId: key, devices: stale }));
                  }
                }
              }}
              disabled={clientsLoading}
            >
              <option value="">
                {clientsLoading ? t('devicePicker.loadingClients') : t('devicePicker.selectClient')}
              </option>
              {directory.clients.map((c) => (
                <option key={clientDirectoryKeyFromSummary(c)} value={clientDirectoryKeyFromSummary(c)}>
                  {c.device_count > 0
                    ? `${c.display_name} (${c.device_count})`
                    : c.display_name}
                </option>
              ))}
            </select>
            {clientsError && <span className={styles.errorText}>{clientsError}</span>}
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <span className={styles.label}>
                {t('devicePicker.device')}
                {clientKey && deviceLoadingBlock && <span className={styles.helper}> · {t('devicePicker.loadingDevices')}</span>}
                {clientKey && devicesStatus === 'loading' && hasDeviceList && (
                  <span className={styles.helper}> · {t('devicePicker.updatingDevices')}</span>
                )}
                {clientKey && devicesStatus === 'ready' && (
                  <span className={styles.helper}> · {t('devicePicker.devicesCount', { count: devicesForClient.length })}</span>
                )}
                {clientKey && devicesStatus === 'idle' && hasDeviceList && (
                  <span className={styles.helper}> · {t('devicePicker.devicesCache', { count: devicesForClient.length })}</span>
                )}
              </span>
              {clientKey && (
                <button
                  type="button"
                  className={styles.toolbarBtnCompact}
                  onClick={handleRefreshDevices}
                  disabled={devicesStatus === 'loading'}
                  title={t('devicePicker.reloadDevicesTitle')}
                >
                  {t('devicePicker.reloadDevices')}
                </button>
              )}
            </div>
            <select
              className={styles.select}
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={!clientKey || deviceLoadingBlock}
            >
              <option value="">{devicePlaceholder}</option>
              {devicesForClient.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.display_name} — {d.device_id}
                </option>
              ))}
            </select>
            {devicesError && <span className={styles.errorText}>{devicesError}</span>}
          </div>

          <button
            className={styles.confirmBtn}
            onClick={handleConfirm}
            disabled={!clientKey || !deviceId}
          >
            {t('common.confirm')}
          </button>
        </div>

        {context.recentDevices.length > 0 && (
          <div className={styles.recentSection}>
            <div className={styles.recentHeader}>
              <span className={styles.recentTitle}>{t('devicePicker.recent')}</span>
              <input
                className={styles.searchInput}
                type="text"
                placeholder={t('devicePicker.filterPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <ul className={styles.recentList}>
              {filteredRecent.map((d) => (
                <li key={`${d.client}-${d.deviceId}`} className={styles.recentItem}>
                  <button
                    type="button"
                    className={styles.recentItemBtn}
                    onClick={() => handleSelectRecent(d)}
                  >
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="2" width="14" height="12" rx="2" />
                      <path d="M7 17h6" />
                      <path d="M10 14v3" />
                    </svg>
                    <span className={styles.recentDeviceId} title={d.deviceId}>
                      {getRecentDeviceDisplayName(d, directory.devicesByClient)}
                    </span>
                    <span className={styles.recentClient}>{d.client}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={(e) => handleRemoveRecent(e, d.client, d.deviceId)}
                    title={t('devicePicker.removeRecentTitle')}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </li>
              ))}
              {filteredRecent.length === 0 && (
                <li className={styles.emptyRecent}>{t('devicePicker.noMatchingDevices')}</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
