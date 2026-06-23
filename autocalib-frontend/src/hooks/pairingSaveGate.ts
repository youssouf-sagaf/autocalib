/** Pairing workspace registers a save handler (with confirm modal) for header ⌘S. */
let pairingSaveRequestHandler: (() => void) | null = null;

export function registerPairingSaveRequest(handler: (() => void) | null): void {
  pairingSaveRequestHandler = handler;
}

export function invokePairingSaveRequest(): boolean {
  if (!pairingSaveRequestHandler) return false;
  pairingSaveRequestHandler();
  return true;
}
