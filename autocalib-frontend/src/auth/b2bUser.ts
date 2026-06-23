import { b2bClient } from '../api/b2b-api';
import type { UserProfile, UserSessionRecord } from './types';

export async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const { data } = await b2bClient.get<{ results: UserProfile }>(`/users/${userId}`);
  return data.results;
}

export async function createUserSession(body: {
  userId: string;
  clientId: string;
  userEmail: string;
  userDisplayName: string;
  clientDisplayName: string;
  sendSlackNotification?: boolean;
}): Promise<UserSessionRecord> {
  const { data } = await b2bClient.post<{ results: UserSessionRecord }>(
    `/users/${body.userId}/session`,
    {
      client_id: body.clientId,
      user_email: body.userEmail,
      user_display_name: body.userDisplayName,
      client_display_name: body.clientDisplayName,
      send_slack_notification: body.sendSlackNotification ?? false,
    },
  );
  return data.results;
}

export async function updateUserSessionActivity(body: {
  sessionId: string;
  userEmail?: string;
  userDisplayName?: string;
  clientDisplayName?: string;
  sendSlackNotification?: boolean;
}): Promise<{ new_session_id?: string } | undefined> {
  const { data } = await b2bClient.put<{ results?: { new_session_id?: string } }>(
    `/users/session/${body.sessionId}/activity`,
    {
      user_email: body.userEmail,
      user_display_name: body.userDisplayName,
      client_display_name: body.clientDisplayName,
      send_slack_notification: body.sendSlackNotification ?? true,
    },
  );
  return data.results;
}
