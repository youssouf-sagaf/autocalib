import axios from 'axios';
import { resolveApiBaseUrl } from '../config/apiBaseUrl';

const client = axios.create({
  baseURL: resolveApiBaseUrl(),
});

/** Exchange a Cocopilot handoff code for a Firebase custom token. */
export async function exchangeAuthHandoff(code: string): Promise<string> {
  const { data } = await client.post<{ custom_token: string }>(
    '/api/v1/auth/handoff/exchange',
    { code: code.trim() },
  );
  const token = data.custom_token?.trim();
  if (!token) {
    throw new Error('Empty custom token');
  }
  return token;
}
