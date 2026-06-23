import { useTranslation } from 'react-i18next';
import cocoLogo from '../../assets/logos/coco-logo.png';
import { useAuth } from '../../auth/AuthProvider';
import styles from './AccessDeniedPage.module.css';

export function AccessDeniedPage() {
  const { t } = useTranslation();
  const { logout } = useAuth();

  return (
    <div className={styles.page}>
      <div className={styles.stack}>
        <img className={styles.logo} src={cocoLogo} alt="Cocoparks" />
        <div className={styles.card}>
          <h1 className={styles.title}>{t('auth.accessDeniedTitle')}</h1>
          <p className={styles.message}>{t('auth.accessDeniedMessage')}</p>
          <button type="button" className={styles.button} onClick={() => void logout()}>
            {t('nav.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}
