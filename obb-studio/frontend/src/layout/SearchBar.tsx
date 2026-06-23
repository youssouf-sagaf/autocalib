import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseGpsCoordinates } from '../utils/parseGpsCoordinates';
import styles from './SearchBar.module.css';

interface Suggestion {
  place_name: string;
  center: [number, number];
  inputLabel?: string;
}

interface SearchBarProps {
  onFlyTo: (lng: number, lat: number, label?: string) => void;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? '';

function normalizeLocale(raw: string | undefined): 'en' | 'fr' {
  return raw?.startsWith('en') ? 'en' : 'fr';
}

export function SearchBar({ onFlyTo }: SearchBarProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const coordSuggestion = useCallback(
    (parsed: NonNullable<ReturnType<typeof parseGpsCoordinates>>): Suggestion => ({
      place_name: t('search.coordsSuggestion', {
        lat: parsed.lat.toFixed(6),
        lng: parsed.lng.toFixed(6),
      }),
      center: [parsed.lng, parsed.lat],
      inputLabel: parsed.label,
    }),
    [t],
  );

  const geocode = useCallback(
    async (text: string) => {
      const coords = parseGpsCoordinates(text);
      if (coords) {
        setSuggestions([coordSuggestion(coords)]);
        setOpen(true);
        return;
      }

      if (text.length < 3 || !MAPBOX_TOKEN) {
        setSuggestions([]);
        return;
      }
      const lang = normalizeLocale(i18n.language);
      try {
        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(text)}.json` +
          `?access_token=${MAPBOX_TOKEN}&limit=5&language=${lang}&types=place,locality,neighborhood,address,poi`;
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
    },
    [coordSuggestion, i18n.language],
  );

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void geocode(value), 300);
    },
    [geocode],
  );

  const handleSelect = useCallback(
    (s: Suggestion) => {
      setQuery(s.inputLabel ?? s.place_name);
      setOpen(false);
      setSuggestions([]);
      onFlyTo(s.center[0], s.center[1], s.place_name);
    },
    [onFlyTo],
  );

  const flyToParsedCoords = useCallback(
    (text: string): boolean => {
      const coords = parseGpsCoordinates(text);
      if (!coords) return false;
      setQuery(coords.label);
      setOpen(false);
      setSuggestions([]);
      onFlyTo(coords.lng, coords.lat, coords.label);
      return true;
    },
    [onFlyTo],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (flyToParsedCoords(query)) return;
        const first = suggestions[0];
        if (first) handleSelect(first);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    },
    [query, suggestions, handleSelect, flyToParsedCoords],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const pasted = e.clipboardData.getData('text');
      const coords = parseGpsCoordinates(pasted);
      if (!coords) return;
      e.preventDefault();
      setQuery(coords.label);
      clearTimeout(timerRef.current);
      setSuggestions([coordSuggestion(coords)]);
      setOpen(true);
      onFlyTo(coords.lng, coords.lat, coords.label);
    },
    [coordSuggestion, onFlyTo],
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
      <svg
        className={styles.icon}
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        className={styles.input}
        type="search"
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        aria-label={t('search.placeholder')}
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
