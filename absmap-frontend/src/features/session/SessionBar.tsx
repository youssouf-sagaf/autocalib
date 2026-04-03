import { useEditHistory } from "./useEditHistory";

export function SessionBar() {
  const { canUndo, canRedo, handleUndo, handleRedo, isDirty, editCount } = useEditHistory();

  return (
    <div className="session-bar">
      <button className="btn btn-sm" onClick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        Undo
      </button>
      <button className="btn btn-sm" onClick={handleRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        Redo
      </button>
      <span className="session-info">
        {editCount} edit{editCount !== 1 ? "s" : ""}
        {isDirty && <span className="dirty-badge"> (unsaved)</span>}
      </span>
    </div>
  );
}
