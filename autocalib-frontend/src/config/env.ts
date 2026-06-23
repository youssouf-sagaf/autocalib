/** Vite env — same Firebase project and B2B API as Cocopilot-FE. */
export const env = {
  firebaseApiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string) ?? '',
  authDomain: (import.meta.env.VITE_AUTH_DOMAIN as string) ?? '',
  databaseUrl: (import.meta.env.VITE_DATABASE_URL as string) ?? '',
  projectId: (import.meta.env.VITE_PROJECT_ID as string) ?? '',
  storageBucket: (import.meta.env.VITE_STORAGE_BUCKET as string) ?? '',
  messagingSenderId: (import.meta.env.VITE_MESSAGING_SENDER_ID as string) ?? '',
  appId: (import.meta.env.VITE_ID as string) ?? '',
  measurementId: (import.meta.env.VITE_MEASUREMENT_ID as string) ?? '',
  b2bBaseUrl:
    (import.meta.env.VITE_B2B_BASE_URL as string) ??
    'https://backend-b2b.prod.cocoparks.io/api/v1',
  firebaseBucketLink: (import.meta.env.VITE_FIREBASE_BUCKET_LINK as string) ?? '',
} as const;

export function isFirebaseConfigured(): boolean {
  return Boolean(env.firebaseApiKey && env.authDomain && env.projectId && env.appId);
}
