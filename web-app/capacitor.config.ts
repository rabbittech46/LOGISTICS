import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const parsedServerUrl = (() => {
  if (!serverUrl) {
    return null;
  }

  try {
    return new URL(serverUrl);
  } catch {
    throw new Error('CAPACITOR_SERVER_URL must be a valid absolute URL');
  }
})();

const config: CapacitorConfig = {
  appId: 'com.rabbittech.logistics',
  appName: 'RabbitTech Logistics',
  webDir: 'native-shell',
  server: parsedServerUrl
    ? {
        url: parsedServerUrl.toString(),
        cleartext: parsedServerUrl.protocol === 'http:',
        allowNavigation: [parsedServerUrl.host],
      }
    : undefined,
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#081121',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#081121',
    },
    Keyboard: {
      resize: KeyboardResize.Body,
      resizeOnFullScreen: true,
    },
  },
};

export default config;