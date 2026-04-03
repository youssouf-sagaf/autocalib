import { useCallback, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { saveSession } from "../../store/absmap-slice";
import { DifficultyPicker } from "./DifficultyPicker";
import type { DifficultyTag } from "../../types";

export function SavePanel() {
  const dispatch = useAppDispatch();
  const isDirty = useAppSelector((s) => s.absmap.isDirty);
  const slotCount = useAppSelector((s) => s.absmap.slots.length);
  const job = useAppSelector((s) => s.absmap.job);

  const [tags, setTags] = useState<DifficultyTag[]>([]);
  const [otherNote, setOtherNote] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleTag = useCallback((tag: DifficultyTag) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await dispatch(
        saveSession({ difficultyTags: tags, otherNote: otherNote || undefined }),
      ).unwrap();
    } finally {
      setSaving(false);
    }
  }, [dispatch, tags, otherNote]);

  const canSave = job?.status === "done" && slotCount > 0;

  return (
    <div className="panel save-panel">
      <h3>Save session</h3>
      <DifficultyPicker
        selected={tags}
        otherNote={otherNote}
        onToggle={toggleTag}
        onOtherNote={setOtherNote}
      />
      <button
        className="btn btn-accent"
        onClick={handleSave}
        disabled={!canSave || saving}
      >
        {saving ? "Saving..." : `Save ${slotCount} slots`}
      </button>
      {!isDirty && job?.status === "done" && (
        <span className="saved-label">All changes saved</span>
      )}
    </div>
  );
}
