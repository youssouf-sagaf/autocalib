/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN: string;
  readonly VITE_API_URL: string;
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_AUTH_DOMAIN: string;
  readonly VITE_DATABASE_URL: string;
  readonly VITE_PROJECT_ID: string;
  readonly VITE_STORAGE_BUCKET: string;
  readonly VITE_MESSAGING_SENDER_ID: string;
  readonly VITE_ID: string;
  readonly VITE_MEASUREMENT_ID: string;
  readonly VITE_B2B_BASE_URL: string;
  readonly VITE_FIREBASE_BUCKET_LINK: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
