import { Trans, useTranslation } from 'react-i18next';
import { IconLoader } from '../../ui/ToolbarIcons';
import { Kbd } from '../../ui/Kbd';
import styles from './CalibEmptyStatePanel.module.css';

interface DeviceContextProps {
  cocospotLabel: string | null;
  client: string | null;
  deviceId: string | null;
}

function DeviceChip({ cocospotLabel, client, deviceId }: DeviceContextProps) {
  const { t } = useTranslation();
  if (!deviceId || !client) return null;
  return (
    <div className={styles.deviceChip}>
      <span className={styles.deviceName}>{cocospotLabel ?? deviceId}</span>
      <span className={styles.deviceMeta}>
        {client}
        {cocospotLabel && cocospotLabel !== deviceId ? (
          <span title={deviceId}> · {t('calib.deviceIdLine', { id: deviceId })}</span>
        ) : null}
      </span>
    </div>
  );
}

interface CalibProdExistsPanelProps extends DeviceContextProps {
  bboxCount: number;
  onEdit: () => void;
  onGenerate: () => void;
  generateDisabled?: boolean;
}

export function CalibProdExistsPanel({
  cocospotLabel,
  client,
  deviceId,
  bboxCount,
  onEdit,
  onGenerate,
  generateDisabled,
}: CalibProdExistsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.panel}>
      <div className={`${styles.card} ${styles.cardWide}`}>
        <DeviceChip cocospotLabel={cocospotLabel} client={client} deviceId={deviceId} />

        <span className={styles.badge}>{t('calib.prodExists.badge')}</span>

        <p className={styles.lead}>{t('calib.prodExists.lead', { count: bboxCount })}</p>
        <p className={styles.hint}>{t('calib.prodExists.hint')}</p>

        <div className={styles.actions}>
          <div className={`${styles.actionCard} ${styles.actionCardPrimary}`}>
            <p className={styles.actionTitle}>{t('calib.goToProductionTab')}</p>
            <p className={styles.actionDesc}>{t('calib.prodExists.editDesc')}</p>
            <button type="button" className={`${styles.actionBtn} ${styles.actionBtnPrimary}`} onClick={onEdit}>
              {t('calib.prodExists.editCta')}
            </button>
          </div>

          <div className={styles.actionCard}>
            <p className={styles.actionTitle}>{t('calib.tabs.generate')}</p>
            <p className={styles.actionDesc}>{t('calib.prodExists.buildDesc')}</p>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
              onClick={onGenerate}
              disabled={generateDisabled}
            >
              {t('calib.generate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface CalibNoDataPanelProps extends DeviceContextProps {
  onGenerate: () => void;
  onPickDevice?: () => void;
  generateDisabled?: boolean;
  generateLabel: string;
}

export function CalibNoDataPanel({
  cocospotLabel,
  client,
  deviceId,
  onGenerate,
  onPickDevice,
  generateDisabled,
  generateLabel,
}: CalibNoDataPanelProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.panel}>
      <div className={styles.card}>
        {deviceId && client ? (
          <DeviceChip cocospotLabel={cocospotLabel} client={client} deviceId={deviceId} />
        ) : client ? (
          <div className={styles.deviceChip}>
            <span className={styles.deviceName}>{client}</span>
          </div>
        ) : null}

        <span className={`${styles.badge} ${styles.badgeNew}`}>{t('calib.noData.badge')}</span>

        <p className={styles.lead}>
          {deviceId && client
            ? t('calib.noDataTitle')
            : client && !deviceId
              ? t('calib.selectDeviceTitle')
              : t('calib.pickCocospotTitle')}
        </p>
        <p className={styles.hint}>{t('calib.noData.hint')}</p>

        {client && !deviceId ? (
          <button type="button" className={`${styles.actionBtn} ${styles.actionBtnPrimary}`} onClick={onPickDevice}>
            {t('calib.selectDeviceCta')}
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
            onClick={onGenerate}
            disabled={generateDisabled}
          >
            {generateLabel}
          </button>
        )}

        <p className={styles.footer}>
          {deviceId && client ? (
            t('calib.deviceIdLine', { id: deviceId })
          ) : client ? (
            <Trans i18nKey="calib.selectDeviceCmd" components={{ kCmdD: <Kbd size="sm">⌘D</Kbd> }} />
          ) : (
            <Trans i18nKey="calib.pickCocospotCmd" components={{ kCmdD: <Kbd size="sm">⌘D</Kbd> }} />
          )}
        </p>
      </div>
    </div>
  );
}

export function CalibLoadingPanel() {
  const { t } = useTranslation();
  return (
    <div className={styles.panel}>
      <div className={styles.loadingWrap}>
        <IconLoader size={44} />
        <p>{t('calib.loadingFromProd')}</p>
      </div>
    </div>
  );
}
