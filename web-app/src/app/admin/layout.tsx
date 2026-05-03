'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/layout/app-shell';
import { useAuthStore, selectIsPlatformAdmin } from '../../stores/auth-store';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isPlatformAdmin = useAuthStore(selectIsPlatformAdmin);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (isAuthenticated && !isPlatformAdmin) {
      router.replace('/');
    }
  }, [isAuthenticated, isPlatformAdmin, router]);

  if (!isPlatformAdmin) return null;
  return <AppShell>{children}</AppShell>;
}
