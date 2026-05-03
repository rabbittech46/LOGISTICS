import { Capacitor } from '@capacitor/core';

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isAndroidApp(): boolean {
  return isNativeApp() && Capacitor.getPlatform() === 'android';
}

export function getClientPlatform(): 'native' | 'web' {
  return isNativeApp() ? 'native' : 'web';
}