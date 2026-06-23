import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { env, isFirebaseConfigured } from '../config/env';

const firebaseConfig = {
  apiKey: env.firebaseApiKey,
  authDomain: env.authDomain,
  databaseURL: env.databaseUrl,
  projectId: env.projectId,
  storageBucket: env.storageBucket,
  messagingSenderId: env.messagingSenderId,
  appId: env.appId,
  measurementId: env.measurementId,
};

export const firebaseReady = isFirebaseConfigured();

export const app = firebaseReady ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
