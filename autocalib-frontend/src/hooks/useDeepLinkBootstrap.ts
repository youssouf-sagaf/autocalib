/**
 * Apply Cocopilot deep-link query params once per URL search string.
 *
 * Contract: docs/cocopilot-integration-plan.md — Phase A (phasage « 1 »).
 * Params: workspace, device, client.
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  fetchDevicesForClient,
  setActiveClient,
  setDeviceContext,
  setDeviceId,
  setWorkspaceMode,
} from '../store/autocalib-slice';
import {
  devicesFetchArg,
  findClientInDirectory,
  resolveClientFromDirectoryKey,
} from '../utils/clientContext';
import { createLogger } from '../utils/logger';

const log = createLogger('deepLink');

const VALID_WORKSPACES = ['absmap', 'calib', 'pairing'] as const;
type AutocalibWorkspace = (typeof VALID_WORKSPACES)[number];

function parseWorkspaceParam(raw: string | null): AutocalibWorkspace | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if ((VALID_WORKSPACES as readonly string[]).includes(value)) {
    return value as AutocalibWorkspace;
  }
  log.warn(`Invalid workspace=${raw} — fallback absmap`);
  return 'absmap';
}

function workspaceFromPath(pathname: string): AutocalibWorkspace | null {
  if (pathname === '/calib') return 'calib';
  if (pathname === '/pairing') return 'pairing';
  if (pathname === '/absmap') return 'absmap';
  return null;
}

/** Workspace to open — only when path or `workspace` query explicitly requests one. */
function resolveTargetWorkspace(
  search: URLSearchParams,
  pathname: string,
): AutocalibWorkspace | null {
  return parseWorkspaceParam(search.get('workspace')) ?? workspaceFromPath(pathname);
}

function workspacePath(workspace: AutocalibWorkspace): string {
  return `/${workspace}`;
}

/** Strip `workspace` from query after it has been applied to the route path. */
function searchWithoutWorkspace(search: URLSearchParams): string {
  const next = new URLSearchParams(search);
  next.delete('workspace');
  const serialized = next.toString();
  return serialized ? `?${serialized}` : '';
}

function useDeepLinkBootstrap(): void {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const clientsStatus = useAppSelector((s) => s.autocalib.directory.clientsStatus);
  const clients = useAppSelector((s) => s.autocalib.directory.clients);
  const appliedSearchRef = useRef<string | null>(null);

  useEffect(() => {
    const searchKey = `${location.pathname}${location.search}`;
    if (appliedSearchRef.current === searchKey) {
      return;
    }

    const params = new URLSearchParams(location.search);
    const deviceParam = params.get('device')?.trim() ?? '';
    const clientParam = params.get('client')?.trim() ?? '';
    const hasDeepLinkParams = Boolean(deviceParam || clientParam || params.get('workspace')?.trim());

    if (!hasDeepLinkParams) {
      appliedSearchRef.current = searchKey;
      return;
    }

    if (clientParam && clientsStatus === 'loading') {
      return;
    }
    if (clientParam && clientsStatus === 'idle') {
      return;
    }

    const workspace = resolveTargetWorkspace(params, location.pathname);

    if (workspace) {
      const targetPath = workspacePath(workspace);
      const targetSearch = searchWithoutWorkspace(params);
      const targetUrl = `${targetPath}${targetSearch}`;

      if (`${location.pathname}${location.search}` !== targetUrl) {
        navigate(targetUrl, { replace: true });
        return;
      }

      dispatch(setWorkspaceMode(workspace));
    }

    if (clientParam) {
      const rosterMatch = findClientInDirectory(clientParam, clients);
      if (rosterMatch) {
        dispatch(setActiveClient({ clientId: rosterMatch.client_id, clientName: rosterMatch.display_name }));
        dispatch(fetchDevicesForClient(devicesFetchArg(rosterMatch)));
      } else {
        dispatch(setActiveClient(clientParam));
      }
    }

    if (deviceParam) {
      if (clientParam) {
        const resolved = resolveClientFromDirectoryKey(clientParam, clients);
        dispatch(
          setDeviceContext({
            clientId: resolved.clientId,
            clientName: resolved.clientName,
            deviceId: deviceParam,
          }),
        );
      } else {
        dispatch(setDeviceId(deviceParam));
      }
    }

    log.info(
      `Deep link applied — workspace=${workspace ?? 'dashboard'}${deviceParam ? ` device=${deviceParam}` : ''}${clientParam ? ` client=${clientParam}` : ''}`,
    );
    appliedSearchRef.current = searchKey;
  }, [clients, clientsStatus, dispatch, location.pathname, location.search, navigate]);
}

/** Mount inside `<BrowserRouter>` (returns no UI). */
export function DeepLinkBootstrap(): null {
  useDeepLinkBootstrap();
  return null;
}
