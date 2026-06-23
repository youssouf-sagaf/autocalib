import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppSelector } from '../../store/hooks';
import {
  activeClientDirectoryKey,
  clientDisplayName,
} from '../../utils/clientContext';
import type { WorkspaceStep } from '../../types';
import { UserAccountMenu } from './UserAccountMenu';
import { WorkspaceSaveButton } from './WorkspaceSaveButton';
import styles from './ContextHeader.module.css';

const STEPS: { key: WorkspaceStep; labelKey: string; path: string }[] = [
  { key: 'absmap', labelKey: 'nav.absmapShort', path: '/absmap' },
  { key: 'calib', labelKey: 'nav.calibration', path: '/calib' },
  { key: 'pairing', labelKey: 'nav.pairing', path: '/pairing' },
];

interface ContextHeaderProps {
  onOpenClientPicker?: () => void;
  onOpenDevicePicker?: () => void;
  /** Optional strip centered in the header (e.g. calib confidence). */
  centerSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

export function ContextHeader({
  onOpenClientPicker,
  onOpenDevicePicker,
  centerSlot,
  rightSlot,
}: ContextHeaderProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const context = useAppSelector((s) => s.autocalib.context);
  const clients = useAppSelector((s) => s.autocalib.directory.clients);
  const clientLabel = clientDisplayName(
    context.clientId,
    context.clientName,
    clients,
  );
  const deviceId = useAppSelector((s) => s.autocalib.context.deviceId);
  const deviceName = useAppSelector((s) => {
    const { deviceId: d, recentDevices } = s.autocalib.context;
    const key = activeClientDirectoryKey(s.autocalib.context);
    const fromDirectory = s.autocalib.directory.devicesByClient[key]
      ?.find((dev) => dev.device_id === d)?.display_name;
    if (fromDirectory) return fromDirectory;
    return recentDevices.find((r) => r.client === key && r.deviceId === d)?.label;
  });

  const isWorkspaceHome = location.pathname === '/';
  const activeStep = STEPS.find((s) => location.pathname.startsWith(s.path))?.key ?? 'absmap';
  const stepLabelKey = STEPS.find((s) => s.key === activeStep)?.labelKey;
  const showDeviceInBreadcrumb = !isWorkspaceHome && (activeStep === 'calib' || activeStep === 'pairing');
  const showSave = !isWorkspaceHome;

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <nav className={styles.breadcrumb}>
          {clientLabel ? (
            <>
              <button
                className={styles.crumbBtn}
                onClick={onOpenClientPicker}
                title={t('contextHeader.switchClientTitle')}
              >
                {clientLabel}
              </button>
              <span className={styles.crumbSep}>/</span>
            </>
          ) : (
            <>
              <button
                className={styles.crumbBtn}
                onClick={onOpenClientPicker}
                title={t('contextHeader.selectClientTitle')}
              >
                {t('contextHeader.selectClient')}
              </button>
              <span className={styles.crumbSep}>/</span>
            </>
          )}
          {showDeviceInBreadcrumb && (
            deviceId ? (
              <>
                <button
                  className={styles.crumbBtn}
                  onClick={onOpenDevicePicker}
                  title={t('contextHeader.switchDeviceTitle')}
                >
                  {deviceName ?? deviceId}
                </button>
                <span className={styles.crumbSep}>/</span>
              </>
            ) : (
              <>
                <button
                  className={`${styles.crumbBtn} ${styles.crumbMuted}`}
                  onClick={onOpenDevicePicker}
                  title={t('contextHeader.selectDeviceTitle')}
                >
                  {t('contextHeader.selectDevice')}
                </button>
                <span className={styles.crumbSep}>/</span>
              </>
            )
          )}
          <span className={styles.crumbCurrent}>
            {isWorkspaceHome
              ? t('nav.dashboard')
              : stepLabelKey
                ? t(stepLabelKey)
                : t('nav.dashboard')}
          </span>
        </nav>
      </div>

      <div className={styles.centerStrip}>
        {centerSlot}
        {showSave ? <WorkspaceSaveButton /> : null}
      </div>

      <div className={styles.right}>
        {rightSlot}
        <UserAccountMenu />
      </div>
    </header>
  );
}
