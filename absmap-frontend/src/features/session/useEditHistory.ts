import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { undo, redo } from "../../store/absmap-slice";

/**
 * Hook for undo/redo keyboard shortcuts and state access.
 *
 * Ctrl+Z → undo, Ctrl+Shift+Z or Ctrl+Y → redo.
 */
export function useEditHistory() {
  const dispatch = useAppDispatch();
  const editHistory = useAppSelector((s) => s.absmap.editHistory);
  const editIndex = useAppSelector((s) => s.absmap.editIndex);
  const isDirty = useAppSelector((s) => s.absmap.isDirty);

  const canUndo = editIndex >= 0;
  const canRedo = editIndex < editHistory.length - 1;

  const handleUndo = useCallback(() => dispatch(undo()), [dispatch]);
  const handleRedo = useCallback(() => dispatch(redo()), [dispatch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  return { canUndo, canRedo, handleUndo, handleRedo, isDirty, editCount: editHistory.length };
}
