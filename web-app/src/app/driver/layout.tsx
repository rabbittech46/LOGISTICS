'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/layout/app-shell';
import { useAuthStore, selectIsDriver } from '../../stores/auth-store';

export default function DriverLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isDriverUser = useAuthStore(selectIsDriver);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (isAuthenticated && !isDriverUser) {
      router.replace('/');
    }
  }, [isAuthenticated, isDriverUser, router]);

  if (!isDriverUser) return null;
  return <AppShell>{children}</AppShell>;
}
