import { useTranslation } from 'react-i18next';
import { useWorkspaceSave } from '../../hooks/useWorkspaceSave';
import { IconLoader, IconSave } from '../../ui/ToolbarIcons';
import styles from '../toolbar/AbsmapSessionHeader.module.css';

/** Save control — same slot in the header center strip on every workspace. */
export function WorkspaceSaveButton() {
  const { t } = useTranslation();
  const { kind, visible, canSave, isSaving, isDirty, saveError, title, labelKey, save } =
    useWorkspaceSave();

  if (!kind || !visible) return null;

  const label = isSaving
    ? t(kind === 'calib' ? 'calib.savingCalib' : 'absmapSession.saving')
    : t(labelKey);

  return (
    <div className={styles.saveBlock}>
      <div className={styles.saveRow}>
        <button
          type="button"
          className={`${styles.btn} ${isDirty ? styles.dirty : ''} ${isDirty ? styles.dirtyFilled : ''} ${isSaving ? styles.btnBusy : ''}`}
          disabled={!canSave || isSaving}
          onClick={save}
          title={title ? t(title) : undefined}
          aria-busy={isSaving}
        >
          {isSaving ? <IconLoader /> : <IconSave />}
          <span>{label}</span>
        </button>
      </div>
      {kind === 'absmap' && saveError && (
        <div className={styles.saveErrorRow}>
          <span className={styles.saveError} title={saveError}>
            {saveError.length > 72 ? `${saveError.slice(0, 72)}…` : saveError}
          </span>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={save}
            disabled={isSaving || !canSave}
          >
            {t('absmapSession.retrySave')}
          </button>
        </div>
      )}
    </div>
  );
}
