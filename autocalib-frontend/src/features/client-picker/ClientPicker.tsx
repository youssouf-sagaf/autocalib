import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  setActiveClient,
  fetchClients,
  invalidateDirectoryListing,
} from '../../store/autocalib-slice';
import {
  activeClientDirectoryKey,
  clientDirectoryKeyFromSummary,
  findClientInDirectory,
  resolveClientFromDirectoryKey,
} from '../../utils/clientContext';
import { Kbd } from '../../ui/Kbd';
import styles from './ClientPicker.module.css';

interface ClientPickerProps {
  onClose: () => void;
}

export function ClientPicker({ onClose }: ClientPickerProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const context = useAppSelector((s) => s.autocalib.context);
  const directory = useAppSelector((s) => s.autocalib.directory);

  const activeKey = activeClientDirectoryKey(context);
  const [selectedKey, setSelectedKey] = useState(activeKey);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (directory.clientsStatus === 'idle') {
      dispatch(fetchClients());
    }
  }, [dispatch, directory.clientsStatus]);

  const filteredRecent = useMemo(() => {
    const recent = context.recentClients ?? [];
    const q = search.toLowerCase().trim();
    if (!q) return recent;
    return recent.filter((key) => {
      const resolved = resolveClientFromDirectoryKey(key, directory.clients);
      const name = resolved.clientName || resolved.clientId || key;
      return name.toLowerCase().includes(q) || key.toLowerCase().includes(q);
    });
  }, [context.recentClients, search, directory.clients]);

  const selectionFromKey = useCallback(
    (key: string) => {
      const match = findClientInDirectory(key, directory.clients);
      if (match) {
        return { clientId: match.client_id, clientName: match.display_name };
      }
      return resolveClientFromDirectoryKey(key, directory.clients);
    },
    [directory.clients],
  );

  const handleConfirm = useCallback(() => {
    if (!selectedKey) return;
    dispatch(setActiveClient(selectionFromKey(selectedKey)));
    onClose();
  }, [dispatch, selectedKey, selectionFromKey, onClose]);

  const handleSelectRecent = useCallback(
    (key: string) => {
      dispatch(setActiveClient(selectionFromKey(key)));
      onClose();
    },
    [dispatch, selectionFromKey, onClose],
  );

  const handleRefreshListing = useCallback(() => {
    dispatch(invalidateDirectoryListing());
    dispatch(fetchClients(true));
  }, [dispatch]);

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

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2 className={styles.title}>{t('clientPicker.title')}</h2>
          <div className={styles.headerRight}>
            <button
              type="button"
              className={styles.toolbarBtn}
              onClick={handleRefreshListing}
              disabled={clientsLoading}
              title={t('clientPicker.refreshListingTitle')}
            >
              {t('common.refresh')}
            </button>
            <Kbd size="sm">⌘D</Kbd>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label={t('clientPicker.closeAria')}
              title={t('clientPicker.closeTitle')}
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
              {t('clientPicker.client')}
              {clientsLoading && <span className={styles.helper}> · {t('clientPicker.loadingClientsShort')}</span>}
              {directory.clients.length > 0 && (
                <span className={styles.helper}> · {t('clientPicker.availableClients', { count: directory.clients.length })}</span>
              )}
            </label>
            <select
              className={styles.select}
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              disabled={clientsLoading}
            >
              <option value="">
                {clientsLoading ? t('clientPicker.loadingClients') : t('clientPicker.selectClient')}
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
            <p className={styles.hint}>{t('clientPicker.hint')}</p>
          </div>

          <button
            className={styles.confirmBtn}
            onClick={handleConfirm}
            disabled={!selectedKey}
          >
            {t('common.confirm')}
          </button>
        </div>

        {filteredRecent.length > 0 && (
          <div className={styles.recentSection}>
            <div className={styles.recentHeader}>
              <span className={styles.recentTitle}>{t('clientPicker.recent')}</span>
              <input
                className={styles.searchInput}
                type="text"
                placeholder={t('clientPicker.filterPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <ul className={styles.recentList}>
              {filteredRecent.map((key) => {
                const resolved = resolveClientFromDirectoryKey(key, directory.clients);
                const label = resolved.clientName || resolved.clientId || key;
                return (
                  <li key={key}>
                    <button className={styles.recentItem} onClick={() => handleSelectRecent(key)}>
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
                        <path d="M7 16h6" />
                      </svg>
                      <span className={styles.recentClientName}>{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}