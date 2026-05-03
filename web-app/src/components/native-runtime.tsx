'use client';

import { onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isNativeApp } from '../lib/native';

export function NativeRuntime() {
  useEffect(() => {
    if (!isNativeApp()) {
      return;
    }

    let teardown: Array<() => void> = [];

    void (async () => {
      const [
        { StatusBar, Style },
        { SplashScreen },
        { App },
        { Keyboard },
        { Network },
      ] = await Promise.all([
        import('@capacitor/status-bar'),
        import('@capacitor/splash-screen'),
        import('@capacitor/app'),
        import('@capacitor/keyboard'),
        import('@capacitor/network'),
      ]);

      document.body.dataset.nativeShell = 'true';

      await SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => {});
      await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      await StatusBar.setBackgroundColor({ color: '#081121' }).catch(() => {});

      const appListener = await App.addListener('appStateChange', ({ isActive }) => {
        document.body.dataset.appState = isActive ? 'active' : 'background';
      });

      const keyboardOpenListener = await Keyboard.addListener('keyboardWillShow', () => {
        document.body.classList.add('native-keyboard-open');
      });

      const keyboardCloseListener = await Keyboard.addListener('keyboardWillHide', () => {
        document.body.classList.remove('native-keyboard-open');
      });

      const networkListener = await Network.addListener('networkStatusChange', (status) => {
        onlineManager.setOnline(status.connected);
      });

      const networkStatus = await Network.getStatus();
      onlineManager.setOnline(networkStatus.connected);

      teardown = [
        () => appListener.remove(),
        () => keyboardOpenListener.remove(),
        () => keyboardCloseListener.remove(),
        () => networkListener.remove(),
      ];
    })();

    return () => {
      document.body.classList.remove('native-keyboard-open');
      delete document.body.dataset.nativeShell;
      teardown.forEach((fn) => fn());
    };
  }, []);

  return null;
}