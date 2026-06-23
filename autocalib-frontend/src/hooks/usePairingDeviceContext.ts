import { useMemo } from 'react';
import { useAppSelector } from '../store/hooks';
import { getRecentDeviceDisplayName } from '../utils/recentDeviceDisplay';

/**
 * Resolved Cocospot (client + device) label for Pairing empty states — matches CalibWorkspace messaging.
 */
export function usePairingDeviceContext(): {
  hasClient: boolean;
  hasCocospot: boolean;
  client: string;
  deviceId: string;
  cocospotLabel: string;
} {
  const client = useAppSelector((s) =>
    s.autocalib.context.clientName || s.autocalib.context.clientId,
  );
  const deviceId = useAppSelector((s) => s.autocalib.context.deviceId);
  const recentDevices = useAppSelector((s) => s.autocalib.context.recentDevices);
  const devicesByClient = useAppSelector((s) => s.autocalib.directory.devicesByClient);

  return useMemo(() => {
    if (!client) {
      return { hasClient: false, hasCocospot: false, client: '', deviceId: '', cocospotLabel: '' };
    }
    if (!deviceId) {
      return { hasClient: true, hasCocospot: false, client, deviceId: '', cocospotLabel: '' };
    }
    const recent = recentDevices.find((d) => d.client === client && d.deviceId === deviceId);
    if (recent) {
      return {
        hasClient: true,
        hasCocospot: true,
        client,
        deviceId,
        cocospotLabel: getRecentDeviceDisplayName(recent, devicesByClient),
      };
    }
    const list = devicesByClient[client];
    const row = list?.find((d) => d.device_id === deviceId);
    const label =
      row?.display_name?.trim() || row?.short_name?.trim() || deviceId;
    return { hasClient: true, hasCocospot: true, client, deviceId, cocospotLabel: label };
  }, [client, deviceId, recentDevices, devicesByClient]);
}
