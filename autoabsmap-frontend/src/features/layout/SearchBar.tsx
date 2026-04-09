import { useState, useCallback, useRef, useEffect } from 'react';
import styles from './SearchBar.module.css';

interface Suggestion {
  place_name: string;
  center: [number, number];
}

interface SearchBarProps {
  onFlyTo: (lng: number, lat: number) => void;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export function SearchBar({ onFlyTo }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const geocode = useCallback(async (text: string) => {
    if (text.length < 3 || !MAPBOX_TOKEN) {
      setSuggestions([]);
      return;
    }
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json?access_token=${MAPBOX_TOKEN}&limit=5&language=fr`;
      const res = await fetch(url);
      const data = await res.json();
      setSuggestions(
        (data.features ?? []).map((f: { place_name: string; center: [number, number] }) => ({
          place_name: f.place_name,
          center: f.center,
        })),
      );
      setOpen(true);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => geocode(value), 300);
    },
    [geocode],
  );

  const handleSelect = useCallback(
    (s: Suggestion) => {
      setQuery(s.place_name);
      setOpen(false);
      setSuggestions([]);
      onFlyTo(s.center[0], s.center[1]);
    },
    [onFlyTo],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && suggestions.length > 0) {
        const first = suggestions[0];
        if (first) handleSelect(first);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    },
    [suggestions, handleSelect],
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <svg className={styles.icon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        className={styles.input}
        type="text"
        placeholder="Search address…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
      />
      {open && suggestions.length > 0 && (
        <ul className={styles.dropdown}>
          {suggestions.map((s, i) => (
            <li key={i} className={styles.item} onClick={() => handleSelect(s)}>
              {s.place_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
