import axios from 'axios';
import { env } from '../config/env';
import { syncFirebaseIdToken } from '../auth/token';

export const b2bClient = axios.create({
  baseURL: env.b2bBaseUrl,
  headers: { 'Content-Type': 'application/json' },
});

b2bClient.interceptors.request.use(async (config) => {
  const token = localStorage.getItem('token') ?? (await syncFirebaseIdToken());
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
