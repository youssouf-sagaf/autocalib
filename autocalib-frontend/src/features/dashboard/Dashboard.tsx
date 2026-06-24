import { useCallback, useEffect } from 'react';
import { useWorkspaceNavigate } from '../../hooks/useWorkspaceNavigate';
import { Trans, useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import { fetchDevicesForClient, setActiveClient, setDeviceContext } from '../../store/autocalib-slice';
import {
  clientDisplayName,
  devicesFetchArg,
  resolveClientFromDirectoryKey,
} from '../../utils/clientContext';
import { pathForLastCompletedStep } from '../../utils/workspaceFlow';
import { getRecentDeviceDisplayName } from '../../utils/recentDeviceDisplay';
import { usePrefetchReferenceSlots } from '../../hooks/usePrefetchReferenceSlots';
import { AppShell } from '../layout/AppShell';
import { Kbd } from '../../ui/Kbd';
import type { WorkspaceStep } from '../../types';
import styles from './Dashboard.module.css';

const STEPS: { key: WorkspaceStep; labelKey: string }[] = [
  { key: 'absmap', labelKey: 'nav.absmapShort' },
  { key: 'calib', labelKey: 'nav.calibration' },
  { key: 'pairing', labelKey: 'nav.pairing' },
];

const WORKFLOW_CARDS = [
  {
    key: 'absmap',
    titleKey: 'dashboard.cards.absmap.title',
    descriptionKey: 'dashboard.cards.absmap.description',
    path: '/absmap',
    shortcut: 'G 1',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="26" height="22" rx="3" />
        <path d="M3 13h26" />
        <path d="M13 13v14" />
      </svg>
    ),
  },
  {
    key: 'calib',
    titleKey: 'dashboard.cards.calib.title',
    descriptionKey: 'dashboard.cards.calib.description',
    path: '/calib',
    shortcut: 'G 2',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="10" height="10" rx="2" />
        <rect x="18" y="4" width="10" height="10" rx="2" />
        <rect x="4" y="18" width="10" height="10" rx="2" />
        <rect x="18" y="18" width="10" height="10" rx="2" />
      </svg>
    ),
  },
  {
    key: 'pairing',
    titleKey: 'dashboard.cards.pairing.title',
    descriptionKey: 'dashboard.cards.pairing.description',
    path: '/pairing',
    shortcut: 'G 3',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="16" r="5" />
        <circle cx="23" cy="16" r="5" />
        <path d="M14 16h4" />
      </svg>
    ),
  },
] as const;

export function Dashboard() {
  const navigate = useWorkspaceNavigate();
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const recentDevices = useAppSelector((s) => s.autocalib.context.recentDevices);
  const recentClients = useAppSelector((s) => s.autocalib.context.recentClients ?? []);
  const devicesByClient = useAppSelector((s) => s.autocalib.directory.devicesByClient);
  const devicesStatus = useAppSelector((s) => s.autocalib.directory.devicesStatus);
  const directoryClients = useAppSelector((s) => s.autocalib.directory.clients);
  const currentClientLabel = useAppSelector((s) =>
    clientDisplayName(
      s.autocalib.context.clientId,
      s.autocalib.context.clientName,
      s.autocalib.directory.clients,
    ),
  );
  const currentDeviceId = useAppSelector((s) => s.autocalib.context.deviceId);
  const hasClient = Boolean(currentClientLabel);

  usePrefetchReferenceSlots();

  useEffect(() => {
    const keys = new Set(recentDevices.slice(0, 8).map((d) => d.client).filter(Boolean));
    keys.forEach((key) => {
      const st = devicesStatus[key];
      if (!st || st === 'idle') {
        const match = directoryClients.find(
          (c) => c.client_id === key || c.display_name === key || (!c.client_id && c.display_name === key),
        );
        if (match) dispatch(fetchDevicesForClient(devicesFetchArg(match)));
      }
    });
  }, [dispatch, recentDevices, devicesStatus, directoryClients]);

  const handleCardClick = useCallback(
    (path: string) => navigate(path),
    [navigate],
  );

  const handleOpenClientPicker = useCallback(
    () => window.dispatchEvent(new Event('autocalib:open-client-picker')),
    [],
  );

  return (
    <AppShell>
      <div className={styles.dashboard}>
        <div className={styles.hero}>
          <h1 className={styles.heading}>{t('dashboard.title')}</h1>
          <p className={styles.subtitle}>{t('dashboard.subtitle')}</p>

          {hasClient ? (
            <button
              type="button"
              className={styles.deviceChip}
              onClick={handleOpenClientPicker}
              title={t('dashboard.switchClientTitle')}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
                <path d="M7 16h6" />
              </svg>
              <span className={styles.deviceChipClient}>{currentClientLabel}</span>
              {currentDeviceId && (
                <>
                  <span className={styles.deviceChipSep}>/</span>
                  <span className={styles.deviceChipDevice}>{currentDeviceId}</span>
                </>
              )}
              <span className={styles.deviceChipAction}>{t('common.switch')}</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.devicePrimary}
              onClick={handleOpenClientPicker}
              autoFocus
            >
              <span>{t('dashboard.selectClient')}</span>
              <Kbd size="md" tone="accent">⌘D</Kbd>
            </button>
          )}
        </div>

        <div className={styles.cards}>
          {WORKFLOW_CARDS.map((card, i) => (
            <button
              key={card.key}
              className={styles.card}
              onClick={() => handleCardClick(card.path)}
              autoFocus={hasClient && i === 0}
            >
              <div className={styles.cardIcon}>{card.icon}</div>
              <div className={styles.cardBody}>
                <h2 className={styles.cardTitle}>{t(card.titleKey)}</h2>
                <p className={styles.cardDesc}>{t(card.descriptionKey)}</p>
              </div>
              <div className={styles.cardFooter}>
                <Kbd size="sm">{card.shortcut}</Kbd>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 4l4 4-4 4" />
                </svg>
              </div>
            </button>
          ))}
        </div>

        {recentClients.length > 0 && (
          <div className={styles.recent}>
            <h3 className={styles.recentTitle}>{t('dashboard.recentClients')}</h3>
            <div className={styles.recentList}>
              {recentClients.slice(0, 8).map((key) => {
                const resolved = resolveClientFromDirectoryKey(key, directoryClients);
                const label = resolved.clientName || resolved.clientId || key;
                return (
                  <button
                    key={key}
                    className={styles.recentItem}
                    onClick={() => {
                      dispatch(setActiveClient(resolved));
                      navigate('/absmap');
                    }}
                  >
                    <div className={styles.recentTop}>
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
                        <path d="M7 16h6" />
                      </svg>
                      <span className={styles.recentDevice}>{label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {recentDevices.length > 0 && (
          <div className={styles.recent}>
            <h3 className={styles.recentTitle}>{t('dashboard.recentDevices')}</h3>
            <div className={styles.recentList}>
              {recentDevices.slice(0, 8).map((d) => {
                const done = new Set(d.completedSteps ?? []);
                return (
                  <button
                    key={`${d.client}-${d.deviceId}`}
                    className={styles.recentItem}
                    onClick={() => {
                      const resolved = resolveClientFromDirectoryKey(d.client, directoryClients);
                      dispatch(
                        setDeviceContext({
                          clientId: resolved.clientId,
                          clientName: resolved.clientName,
                          deviceId: d.deviceId,
                          label: d.label,
                        }),
                      );
                      navigate(pathForLastCompletedStep(d.completedSteps));
                    }}
                  >
                    <div className={styles.recentTop}>
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="2" width="14" height="12" rx="2" />
                        <path d="M7 17h6" />
                        <path d="M10 14v3" />
                      </svg>
                      <span className={styles.recentDevice} title={d.deviceId}>
                        {getRecentDeviceDisplayName(d, devicesByClient)}
                      </span>
                      <span className={styles.recentClient}>{d.client}</span>
                    </div>
                    <div className={styles.stepBadges}>
                      {STEPS.map(({ key, labelKey }) => (
                        <span
                          key={key}
                          className={`${styles.stepBadge} ${done.has(key) ? styles.stepDone : styles.stepPending}`}
                        >
                          {done.has(key) ? '✓' : '·'} {t(labelKey)}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={styles.footer}>
          <span>
            <Trans
              i18nKey="dashboard.footerPalette"
              components={{ kbdCmdK: <Kbd size="sm">⌘K</Kbd> }}
            />
          </span>
          <span className={styles.footerSep}>·</span>
          <span>
            <Trans
              i18nKey="dashboard.footerShortcuts"
              components={{ kbdQ: <Kbd size="sm">?</Kbd> }}
            />
          </span>
        </div>
      </div>
    </AppShell>
  );
}
