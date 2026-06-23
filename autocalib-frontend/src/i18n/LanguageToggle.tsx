import { useTranslation } from 'react-i18next';
import frFlag from '../assets/flags/fr.svg';
import gbFlag from '../assets/flags/gb.svg';
import type { AppLocale } from './config';
import { setAppLocale } from './config';
import styles from './LanguageToggle.module.css';

const LANGUAGES: { code: AppLocale; flag: string; label: string }[] = [
  { code: 'fr', flag: frFlag, label: 'FR' },
  { code: 'en', flag: gbFlag, label: 'EN' },
];

interface LanguageToggleProps {
  /** When true, renders the Cocopilot-style row for the account dropdown menu. */
  variant?: 'header' | 'menu';
}

export function LanguageToggle({ variant = 'header' }: LanguageToggleProps) {
  const { i18n, t } = useTranslation();
  const lng = normalizeLocale(i18n.resolvedLanguage ?? i18n.language);

  if (variant === 'menu') {
    return (
      <div className={styles.langBox} role="group" aria-label={t('language.switchAria')}>
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            type="button"
            className={lng === lang.code ? styles.flagBoxActive : styles.flagBox}
            onClick={() => setAppLocale(lang.code)}
            title={lang.label}
            aria-pressed={lng === lang.code}
          >
            <img className={styles.flag} src={lang.flag} alt="" aria-hidden />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.wrap} role="group" aria-label={t('language.switchAria')}>
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          type="button"
          className={`${styles.btn} ${lng === lang.code ? styles.active : ''}`}
          onClick={() => setAppLocale(lang.code)}
          title={lang.label}
          aria-pressed={lng === lang.code}
        >
          <img className={styles.flagInline} src={lang.flag} alt="" aria-hidden />
        </button>
      ))}
    </div>
  );
}

export function normalizeLocale(raw: string | undefined): AppLocale {
  return raw?.toLowerCase().startsWith('en') ? 'en' : 'fr';
}
