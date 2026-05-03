import { Preferences } from '@capacitor/preferences';
import { isNativeApp } from './native';

const REFRESH_TOKEN_KEY = 'rabbittech.refresh-token';

export async function getStoredRefreshToken(): Promise<string | null> {
  if (!isNativeApp()) {
    return null;
  }

  const { value } = await Preferences.get({ key: REFRESH_TOKEN_KEY });
  return value ?? null;
}

export async function setStoredRefreshToken(token: string | null | undefined): Promise<void> {
  if (!isNativeApp()) {
    return;
  }

  if (!token) {
    await Preferences.remove({ key: REFRESH_TOKEN_KEY });
    return;
  }

  await Preferences.set({ key: REFRESH_TOKEN_KEY, value: token });
}