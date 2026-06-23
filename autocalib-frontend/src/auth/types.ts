/** Subset of Cocopilot `UserInfoT` used by Autocalib Tools. */
export type UserProfile = {
  user_id: string;
  email: string;
  display_name: string;
  client: string;
  client_display_name: string;
  photo_url?: string;
  is_staff: boolean;
  is_integrator?: boolean;
  clients?: { client_id: string; client_display_name: string }[];
};

export type UserSessionRecord = {
  id: string;
};
