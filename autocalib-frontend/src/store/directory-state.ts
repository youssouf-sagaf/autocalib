import type { ClientLocation, ClientSummary, DeviceSummary } from '../types';
import { mergeDirectoryCache } from '../utils/directoryCache';

export type DirectoryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DirectoryState {
  clients: ClientSummary[];
  clientsStatus: DirectoryStatus;
  clientsError: string | null;
  devicesByClient: Record<string, DeviceSummary[]>;
  devicesStatus: Record<string, DirectoryStatus>;
  devicesError: Record<string, string | null>;
  clientLocations: Record<string, ClientLocation | null>;
  clientLocationStatus: Record<string, DirectoryStatus>;
}

export const directoryInitial: DirectoryState = {
  clients: [],
  clientsStatus: 'idle',
  clientsError: null,
  devicesByClient: {},
  devicesStatus: {},
  devicesError: {},
  clientLocations: {},
  clientLocationStatus: {},
};

/** Clients + devices lists restored from localStorage when fresh (see `directoryCache.ts`). */
export function getInitialDirectoryState(): DirectoryState {
  return mergeDirectoryCache(directoryInitial);
}
