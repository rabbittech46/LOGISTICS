'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/layout/app-shell';
import { useAuthStore, selectIsCarrierManager } from '../../stores/auth-store';

export default function CarrierLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const isCarrierManager = useAuthStore(selectIsCarrierManager);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (isAuthenticated && !isCarrierManager) {
      router.replace('/');
    }
  }, [isAuthenticated, isCarrierManager, router]);

  if (!isCarrierManager) return null;
  return <AppShell>{children}</AppShell>;
}
