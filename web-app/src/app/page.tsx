'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, selectIsPlatformAdmin, selectIsShipperUser, selectIsCarrierManager, selectIsDriver } from '../stores/auth-store';

export default function HomePage() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isPlatformAdmin = useAuthStore(selectIsPlatformAdmin);
  const isShipperUser = useAuthStore(selectIsShipperUser);
  const isCarrierManager = useAuthStore(selectIsCarrierManager);
  const isDriver = useAuthStore(selectIsDriver);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    if (isPlatformAdmin) router.replace('/admin/dashboard');
    else if (isShipperUser) router.replace('/shipper/dashboard');
    else if (isCarrierManager) router.replace('/carrier/dashboard');
    else if (isDriver) router.replace('/driver/loads');
    else router.replace('/driver/loads');
  }, [isAuthenticated, isPlatformAdmin, isShipperUser, isCarrierManager, isDriver, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );
}
