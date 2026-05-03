'use client';

import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { useState, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { NativeRuntime } from '../components/native-runtime';
import { ServiceWorkerRegistration } from '../components/service-worker-registration';
import { ToastContainer } from '../components/ui/toast';
import { ErrorBoundary } from '../components/error-boundary';
import { useAuthStore } from '../stores/auth-store';
import { getAccessToken, apiClient } from '../lib/api-client';
import type { RefreshResponse } from '../lib/types';

// ── Online/Offline banner ──────────────────────────────────────────────────
function useIsOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true, // SSR assume online
  );
}

function OfflineBanner() {
  const isOnline = useIsOnline();
  if (isOnline) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-600 text-white text-center text-sm py-1.5 font-medium" role="alert">
      You are offline — some features may be unavailable
    </div>
  );
}

function AuthHydrationGuard({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, hydrated, login, logout } = useAuthStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hydrated) return;

    // If user was persisted as authenticated but there's no in-memory token,
    // attempt a silent refresh before rendering the app
    if (isAuthenticated && !getAccessToken()) {
      apiClient<RefreshResponse>('/api/v1/auth/refresh', {
        method: 'POST',
        retries: 0,
      })
        .then((res) => {
          if (!user) {
            throw new Error('Missing persisted user during auth hydration');
          }

          login(user, res.data.accessToken);
        })
        .catch(() => {
          // Refresh failed — session expired, force logout
          logout();
        })
        .finally(() => setReady(true));
    } else {
      setReady(true);
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 2,
            refetchOnWindowFocus: true,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  useEffect(() => {
    return onlineManager.setEventListener((setOnline) => {
      const handleOnline = () => setOnline(true);
      const handleOffline = () => setOnline(false);

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AuthHydrationGuard>
          {children}
        </AuthHydrationGuard>
      </ErrorBoundary>
      <NativeRuntime />
      <ServiceWorkerRegistration />
      <OfflineBanner />
      <ToastContainer />
    </QueryClientProvider>
  );
}
