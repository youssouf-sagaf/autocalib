import './App.css';
import './i18n/config';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthGate } from './features/auth/AuthGate';
import { store } from './store/store';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { fetchClients, setWorkspaceMode } from './store/autocalib-slice';
import { DeepLinkBootstrap } from './hooks/useDeepLinkBootstrap';
import { useEnsureActiveClientB2bId } from './hooks/useEnsureActiveClientB2bId';
import App from './App';
import { CalibWorkspace } from './features/calib-editor/CalibWorkspace';
import { PairingWorkspace } from './features/pairing/PairingWorkspace';
import { AlertModalHost } from './ui/AlertModal';
import { SaveFeedbackModal } from './ui/SaveFeedbackModal';
import { Dashboard } from './features/dashboard/Dashboard';
import './map/registerSlotPinImages';
/** Avoid a flash of unstyled content when the module script wins the race against the CSS link. */
function waitForAppStylesheets(): Promise<void> {
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).filter((link) => (link.getAttribute('href') ?? '').includes('/assets/'));

  if (links.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(
    links.map(
      (link) =>
        new Promise<void>((resolve) => {
          if (link.sheet) {
            resolve();
            return;
          }
          link.addEventListener('load', () => resolve(), { once: true });
          link.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
}

/** When `clientsStatus` is idle (cold start or stale localStorage), load the roster from the API. */
function ClientsDirectoryRefetchOnIdle() {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.autocalib.directory.clientsStatus);
  const { isStaff, profileLoading, user } = useAuth();

  useEffect(() => {
    if (!user || profileLoading || !isStaff) return;
    if (status !== 'idle') return;
    dispatch(fetchClients());
  }, [dispatch, status, user, profileLoading, isStaff]);

  return null;
}

function ActiveClientB2bIdSync() {
  useEnsureActiveClientB2bId();
  return null;
}

function WorkspaceModeSync() {
  const dispatch = useAppDispatch();
  const location = useLocation();

  useEffect(() => {
    const pathname = location.pathname;
    if (pathname === '/calib') {
      dispatch(setWorkspaceMode('calib'));
      return;
    }
    if (pathname === '/pairing') {
      dispatch(setWorkspaceMode('pairing'));
      return;
    }
    if (pathname === '/absmap') {
      dispatch(setWorkspaceMode('absmap'));
      return;
    }
  }, [dispatch, location.pathname]);

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/absmap" element={<App />} />
      <Route path="/calib" element={<CalibWorkspace />} />
      <Route path="/pairing" element={<PairingWorkspace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppRoot() {
  return (
    <AuthGate>
      <ClientsDirectoryRefetchOnIdle />
      <DeepLinkBootstrap />
      <ActiveClientB2bIdSync />
      <WorkspaceModeSync />
      <AlertModalHost />
      <SaveFeedbackModal />
    </AuthGate>
  );
}

void waitForAppStylesheets().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Provider store={store}>
        <BrowserRouter>
          <AuthProvider>
            <AppRoot />
          </AuthProvider>
        </BrowserRouter>
      </Provider>
    </StrictMode>,
  );
});
