export interface ParsedShortcut {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Parse display strings like "⌘⇧Z", "Del", "⌘1" into match rules. */
export function parseShortcutDisplay(display: string): ParsedShortcut[] {
  const parts = display.trim().split(/\s+/).filter(Boolean);
  return parts.map((part) => {
    const s: ParsedShortcut = { key: '' };
    let remaining = part;
    if (remaining.includes('⌘') || remaining.toLowerCase().includes('cmd')) {
      s.meta = true;
      remaining = remaining.replace(/⌘|cmd/gi, '');
    }
    if (remaining.includes('⇧') || remaining.toLowerCase().includes('shift')) {
      s.shift = true;
      remaining = remaining.replace(/⇧|shift/gi, '');
    }
    if (remaining.includes('⌥') || remaining.toLowerCase().includes('alt')) {
      s.alt = true;
      remaining = remaining.replace(/⌥|alt/gi, '');
    }
    if (remaining.includes('⌃') || remaining.toLowerCase().includes('ctrl')) {
      s.ctrl = true;
      remaining = remaining.replace(/⌃|ctrl/gi, '');
    }
    const key = remaining.trim();
    if (key.toLowerCase() === 'del') s.key = 'delete';
    else if (key === '−' || key === '-') s.key = '-';
    else if (key === '+') s.key = '+';
    else if (key.length === 1) s.key = key.toLowerCase();
    else s.key = key.toLowerCase();
    return s;
  });
}

export function eventMatchesShortcut(event: KeyboardEvent, shortcut: ParsedShortcut): boolean {
  const key = event.key.toLowerCase();
  const wantKey = shortcut.key;
  const keyMatch =
    wantKey === key ||
    (wantKey === 'delete' && (key === 'delete' || key === 'backspace')) ||
    (wantKey === '+' && (key === '+' || key === '='));
  if (!keyMatch) return false;
  const meta = event.metaKey || event.ctrlKey;
  if (Boolean(shortcut.meta || shortcut.ctrl) !== meta) return false;
  if (Boolean(shortcut.shift) !== event.shiftKey) return false;
  if (Boolean(shortcut.alt) !== event.altKey) return false;
  return true;
}

export function eventMatchesDisplay(event: KeyboardEvent, display: string): boolean {
  const parts = parseShortcutDisplay(display);
  if (parts.length === 1) return eventMatchesShortcut(event, parts[0]!);
  return false;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  if (target.closest('[data-command-palette="true"]')) return true;
  return false;
}
