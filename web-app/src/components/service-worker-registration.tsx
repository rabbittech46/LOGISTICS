'use client';

import { useEffect } from 'react';
import { isNativeApp } from '../lib/native';
import { useUIStore } from '../stores/ui-store';

export function ServiceWorkerRegistration() {
  const addToast = useUIStore((state) => state.addToast);

  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production'
      || typeof window === 'undefined'
      || !('serviceWorker' in navigator)
      || isNativeApp()
    ) {
      return;
    }

    let mounted = true;

    navigator.serviceWorker.register('/sw.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) {
          return;
        }

        installingWorker.addEventListener('statechange', () => {
          if (!mounted) {
            return;
          }

          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            addToast({
              type: 'info',
              title: 'App update ready',
              message: 'Reload to use the latest offline cache and tracking UI.',
              duration: 7000,
            });
          }
        });
      });
    }).catch(() => {
      // Ignore registration errors and keep the app functional without offline caching.
    });

    return () => {
      mounted = false;
    };
  }, [addToast]);

  return null;
}