/**
 * Generate a UUID v4. Falls back to a manual implementation
 * when crypto.randomUUID is unavailable (non-HTTPS contexts).
 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => {
    const n = Number(c);
    return (n ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (n / 4)))).toString(16);
  });
}
