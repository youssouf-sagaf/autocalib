import { useState } from "react";
import type { DifficultyTag } from "../../types";

const TAGS: { value: DifficultyTag; label: string }[] = [
  { value: "occlusion", label: "Occlusion" },
  { value: "shadow", label: "Shadow" },
  { value: "weak_ground_markings", label: "Weak markings" },
  { value: "visual_clutter", label: "Visual clutter" },
  { value: "other", label: "Other" },
];

interface DifficultyPickerProps {
  selected: DifficultyTag[];
  otherNote: string;
  onToggle: (tag: DifficultyTag) => void;
  onOtherNote: (note: string) => void;
}

export function DifficultyPicker({
  selected,
  otherNote,
  onToggle,
  onOtherNote,
}: DifficultyPickerProps) {
  return (
    <div className="difficulty-picker">
      <label className="label">Difficulty tags</label>
      <div className="tag-grid">
        {TAGS.map((tag) => (
          <button
            key={tag.value}
            className={`tag-btn ${selected.includes(tag.value) ? "active" : ""}`}
            onClick={() => onToggle(tag.value)}
          >
            {tag.label}
          </button>
        ))}
      </div>
      {selected.includes("other") && (
        <input
          className="input"
          placeholder="Describe the difficulty..."
          value={otherNote}
          onChange={(e) => onOtherNote(e.target.value)}
        />
      )}
    </div>
  );
}
