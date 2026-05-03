'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/layout/app-shell';
import { useAuthStore, selectIsShipperUser } from '../../stores/auth-store';

export default function ShipperLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isShipperUser = useAuthStore(selectIsShipperUser);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (isAuthenticated && !isShipperUser) {
      router.replace('/');
    }
  }, [isAuthenticated, isShipperUser, router]);

  if (!isShipperUser) return null;
  return <AppShell>{children}</AppShell>;
}
