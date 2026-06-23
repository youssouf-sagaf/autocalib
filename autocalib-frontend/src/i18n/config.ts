import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fr from './locales/fr.json';
import en from './locales/en.json';

const STORAGE_KEY = 'autocalib-lang';

export type AppLocale = 'fr' | 'en';

function readStoredLocale(): AppLocale | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'fr' || raw === 'en') return raw;
  } catch {
    /* ignore */
  }
  return null;
}

/** Persist choice and switch UI language (default UI is French). */
export function setAppLocale(locale: AppLocale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  void i18n.changeLanguage(locale);
}

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: readStoredLocale() ?? 'fr',
  fallbackLng: 'en',
  supportedLngs: ['fr', 'en'],
  interpolation: { escapeValue: false },
});

function syncDocumentLang(lng: string) {
  document.documentElement.lang = lng.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

syncDocumentLang(i18n.language);
i18n.on('languageChanged', (lng) => {
  syncDocumentLang(lng);
});

export default i18n;
