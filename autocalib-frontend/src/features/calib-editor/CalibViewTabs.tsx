import { useTranslation } from 'react-i18next';
import type { CalibTab } from '../../types';
import styles from './CalibViewTabs.module.css';

interface CalibViewTabsProps {
  active: CalibTab;
  onChange: (tab: CalibTab) => void;
}

const TABS: CalibTab[] = ['production', 'generate'];

export function CalibViewTabs({ active, onChange }: CalibViewTabsProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.tabs} role="tablist" aria-label={t('calib.tabs.aria')}>
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={active === tab}
          className={active === tab ? styles.tabActive : styles.tab}
          title={t(`calib.tabs.${tab}Title`)}
          onClick={() => onChange(tab)}
        >
          {t(`calib.tabs.${tab}`)}
        </button>
      ))}
    </div>
  );
}
