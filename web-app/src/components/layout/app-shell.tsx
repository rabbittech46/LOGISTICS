'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import { api } from '../../lib/api-client';
import { triggerTapHaptic } from '../../lib/native-feedback';
import { getStoredRefreshToken } from '../../lib/native-session';
import {
  useAuthStore,
  selectIsCarrierManager,
  selectIsPlatformAdmin,
  selectIsShipperUser,
} from '../../stores/auth-store';
import { useUIStore } from '../../stores/ui-store';

interface NavItem {
  label: string;
  shortLabel: string;
  description: string;
  href: string;
  icon: ReactNode;
}

function TruckIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25H7.5V6.375a1.125 1.125 0 011.125-1.125h6.75a1.125 1.125 0 011.125 1.125v1.5m0 0h2.25l2.625 3.75v4.5" />
    </svg>
  );
}

const DashboardIcon = () => (
  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
  </svg>
);

const platformAdminNav: NavItem[] = [
  { label: 'Dashboard', shortLabel: 'Home', description: 'Platform performance and system health', href: '/admin/dashboard', icon: <DashboardIcon /> },
  { label: 'All Loads', shortLabel: 'Loads', description: 'Audit and inspect freight activity', href: '/admin/loads', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg> },
  { label: 'Bookings Audit', shortLabel: 'Audit', description: 'Investigate bookings and slot activity', href: '/admin/bookings', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg> },
  { label: 'Organizations', shortLabel: 'Orgs', description: 'Manage tenant entities and compliance', href: '/admin/orgs', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" /></svg> },
];

const shipperNav: NavItem[] = [
  { label: 'Dashboard', shortLabel: 'Home', description: 'Monitor active freight and spend', href: '/shipper/dashboard', icon: <DashboardIcon /> },
  { label: 'My Loads', shortLabel: 'Loads', description: 'See and manage all shipper loads', href: '/shipper/loads', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg> },
  { label: 'Live Tracking', shortLabel: 'Track', description: 'Watch dispatch execution in real time', href: '/shipper/tracking', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg> },
  { label: 'Payments', shortLabel: 'Pay', description: 'Authorize escrow and track releases', href: '/shipper/payments', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5m-18 0v7.125c0 .621.504 1.125 1.125 1.125h14.25c.621 0 1.125-.504 1.125-1.125V8.25m-18 0V6.375c0-.621.504-1.125 1.125-1.125h14.25c.621 0 1.125.504 1.125 1.125V8.25m-12 5.25h3" /></svg> },
  { label: 'Pricing', shortLabel: 'Rate', description: 'Review lane pricing and guidance', href: '/shipper/pricing', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m0 0l-3.75-3.75M12 18l3.75-3.75M3.75 12h16.5" /></svg> },
  { label: 'Create Load', shortLabel: 'New', description: 'Post a new lane to the marketplace', href: '/shipper/loads/new', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg> },
];

const carrierNav: NavItem[] = [
  { label: 'Dashboard', shortLabel: 'Home', description: 'Operational snapshot for your fleet', href: '/carrier/dashboard', icon: <DashboardIcon /> },
  { label: 'Load Board', shortLabel: 'Board', description: 'Find lanes and evaluate opportunities', href: '/carrier/loads', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg> },
  { label: 'Fleet', shortLabel: 'Fleet', description: 'Trucks and availability across the org', href: '/carrier/fleet', icon: <TruckIcon /> },
  { label: 'Trips', shortLabel: 'Trips', description: 'Monitor active assignments and execution', href: '/carrier/trips', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" /></svg> },
  { label: 'Live Tracking', shortLabel: 'Track', description: 'Watch assets move in real time', href: '/carrier/tracking', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75c-4.556 0-8.25 3.19-8.25 7.125 0 5.805 7.16 9.954 7.465 10.127a1.5 1.5 0 001.57 0c.305-.173 7.465-4.322 7.465-10.127 0-3.935-3.694-7.125-8.25-7.125zm0 9.75a2.625 2.625 0 110-5.25 2.625 2.625 0 010 5.25z" /></svg> },
  { label: 'Bids', shortLabel: 'Bids', description: 'Track pending and historical bids', href: '/carrier/bids', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg> },
  { label: 'Drivers', shortLabel: 'Crew', description: 'Manage driver roster and staffing', href: '/carrier/drivers', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg> },
];

const driverNav: NavItem[] = [
  { label: 'Load Board', shortLabel: 'Loads', description: 'Browse live opportunities near you', href: '/driver/loads', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg> },
  { label: 'My Trips', shortLabel: 'Trips', description: 'Milestones, POD, and trip execution', href: '/driver/trips', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" /></svg> },
  { label: 'Live Tracking', shortLabel: 'Track', description: 'Share and view assignment telemetry', href: '/driver/tracking', icon: <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75c-4.556 0-8.25 3.19-8.25 7.125 0 5.805 7.16 9.954 7.465 10.127a1.5 1.5 0 001.57 0c.305-.173 7.465-4.322 7.465-10.127 0-3.935-3.694-7.125-8.25-7.125zm0 9.75a2.625 2.625 0 110-5.25 2.625 2.625 0 010 5.25z" /></svg> },
  { label: 'My Bookings', shortLabel: 'Booked', description: 'Reserved and confirmed slots', href: '/driver/bookings', icon: <TruckIcon /> },
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getPageTitle(pathname: string, navItems: NavItem[]) {
  const matched = navItems.find((item) => isActivePath(pathname, item.href));
  if (matched) {
    return matched.label;
  }

  if (pathname.endsWith('/new')) return 'Create Load';
  if (pathname.includes('/tracking')) return 'Live Tracking';
  if (pathname.includes('/dashboard')) return 'Dashboard';
  if (pathname.includes('/payments')) return 'Payments';
  if (pathname.includes('/loads/')) return 'Load Detail';
  return 'RabbitTech';
}

function getQuickAction(pathname: string, isShipperUser: boolean, isCarrierManager: boolean) {
  if (isShipperUser && pathname !== '/shipper/loads/new') {
    return {
      href: '/shipper/loads/new',
      label: 'New Load',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      ),
    };
  }

  if (isCarrierManager && pathname !== '/carrier/loads') {
    return {
      href: '/carrier/loads',
      label: 'Load Board',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
        </svg>
      ),
    };
  }

  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, activeOrg, isAuthenticated, logout } = useAuthStore();
  const navigationOpen = useUIStore((state) => state.navigationOpen);
  const setNavigationOpen = useUIStore((state) => state.setNavigationOpen);
  const toggleNavigation = useUIStore((state) => state.toggleNavigation);
  const accountSheetOpen = useUIStore((state) => state.accountSheetOpen);
  const setAccountSheetOpen = useUIStore((state) => state.setAccountSheetOpen);
  const toggleAccountSheet = useUIStore((state) => state.toggleAccountSheet);
  const isPlatformAdmin = useAuthStore(selectIsPlatformAdmin);
  const isShipperUser = useAuthStore(selectIsShipperUser);
  const isCarrierManager = useAuthStore(selectIsCarrierManager);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    setNavigationOpen(false);
    setAccountSheetOpen(false);
  }, [pathname, setAccountSheetOpen, setNavigationOpen]);

  if (!isAuthenticated) {
    return null;
  }

  const navItems = isPlatformAdmin
    ? platformAdminNav
    : isShipperUser
      ? shipperNav
      : isCarrierManager
        ? carrierNav
        : driverNav;

  const mobileTabs = navItems.slice(0, isPlatformAdmin ? 4 : 5);
  const pageTitle = getPageTitle(pathname, navItems);
  const quickAction = getQuickAction(pathname, isShipperUser, isCarrierManager);
  const activeItem = navItems.find((item) => isActivePath(pathname, item.href));
  const userInitials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`.trim() || 'RT';
  const overlayVisible = navigationOpen || accountSheetOpen;

  const closeSheets = () => {
    setNavigationOpen(false);
    setAccountSheetOpen(false);
  };

  const handleLogout = async () => {
    closeSheets();

    try {
      const refreshToken = await getStoredRefreshToken();
      await api.post('/api/v1/auth/logout', refreshToken ? { refreshToken } : undefined, {
        retries: 0,
      });
    } catch {
      // Local session clear still guarantees the user is signed out in the shell.
    }

    logout();
    router.push('/login');
  };

  return (
    <div className="relative min-h-screen xl:flex">
      {overlayVisible && (
        <button
          aria-label="Close panels"
          className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm xl:hidden"
          onClick={closeSheets}
        />
      )}

      <aside className="hidden xl:flex xl:w-28 xl:flex-col xl:items-center xl:gap-5 xl:px-4 xl:py-6">
        <div className="surface-glass flex h-16 w-16 items-center justify-center rounded-[24px] border border-white/10 text-lg font-black text-white">
          RT
        </div>
        <nav className="surface-glass flex w-full flex-1 flex-col items-center gap-2 rounded-[28px] p-3">
          {navItems.map((item) => {
            const isActive = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={clsx(
                  'flex h-14 w-14 items-center justify-center rounded-[20px] transition-all duration-200',
                  isActive
                    ? 'bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-[0_16px_32px_rgba(31,134,255,0.35)]'
                    : 'text-slate-400 hover:bg-white/6 hover:text-white',
                )}
              >
                {item.icon}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="relative flex min-h-screen flex-1 flex-col overflow-x-hidden">
        <header className="app-topbar sticky top-0 z-30">
          <div className="surface-glass mx-auto flex max-w-6xl items-center gap-3 rounded-[30px] px-4 py-3 sm:px-5">
            <button
              data-testid="sidebar-toggle-mobile"
              onClick={() => {
                void triggerTapHaptic();
                toggleNavigation();
              }}
              className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-white/6 text-slate-200 transition hover:bg-white/10 xl:hidden"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-sky-200/72">
                <span>{activeOrg?.orgName ?? 'RabbitTech'}</span>
                <span className="h-1 w-1 rounded-full bg-sky-300/60" />
                <span>{activeOrg?.role?.replace('_', ' ')}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <h1 className="truncate text-lg font-extrabold text-white sm:text-xl">{pageTitle}</h1>
                {activeItem && (
                  <span className="hidden rounded-full border border-white/10 bg-white/6 px-2.5 py-1 text-[0.72rem] text-slate-300 sm:inline-flex">
                    {activeItem.description}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                void triggerTapHaptic();
                toggleAccountSheet();
              }}
              className="flex h-12 min-w-12 items-center justify-center rounded-[18px] bg-gradient-to-br from-slate-200/18 to-slate-100/8 px-3 text-sm font-bold text-white shadow-[0_14px_28px_rgba(2,7,18,0.22)]"
            >
              {userInitials}
            </button>
          </div>
        </header>

        <main className="app-main flex-1 pt-4">
          <div className="mobile-screen">{children}</div>
        </main>

        {quickAction && (
          <Link
            href={quickAction.href}
            className="fixed bottom-[calc(var(--safe-bottom)+5.75rem)] right-[calc(var(--safe-right)+1rem)] z-30 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-sky-400 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_45px_rgba(31,134,255,0.38)] transition hover:scale-[1.02] xl:hidden"
          >
            {quickAction.icon}
            <span>{quickAction.label}</span>
          </Link>
        )}

        <nav className="app-bottom-tabs fixed inset-x-0 bottom-0 z-30 xl:hidden">
          <div className="surface-glass mx-auto flex max-w-3xl items-center justify-between rounded-[30px] px-2 py-2 transition duration-200">
            {mobileTabs.map((item) => {
              const isActive = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    'flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[22px] px-2 py-3 text-[0.72rem] font-semibold transition-all duration-200',
                    isActive
                      ? 'bg-gradient-to-b from-sky-400/24 to-blue-600/28 text-white'
                      : 'text-slate-400 hover:text-white',
                  )}
                >
                  <span className={clsx(isActive && 'text-sky-200')}>{item.icon}</span>
                  <span className="truncate">{item.shortLabel}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      <div
        className={clsx(
          'app-sheet fixed inset-x-0 bottom-0 z-50 rounded-t-[32px] border border-white/10 bg-[#0a1324]/96 px-5 pt-4 backdrop-blur-2xl transition-transform duration-300 xl:hidden',
          navigationOpen ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-white/12" />
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/70">Navigate</p>
            <h2 className="mt-2 text-lg font-bold text-white">All sections</h2>
          </div>
          <button
            onClick={closeSheets}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/7 text-slate-300"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-2">
          {navItems.map((item) => {
            const isActive = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-4 rounded-[24px] px-4 py-4 transition-all',
                  isActive ? 'bg-sky-400/14 text-white' : 'bg-white/4 text-slate-200 hover:bg-white/8',
                )}
              >
                <span className={clsx('flex h-12 w-12 items-center justify-center rounded-[18px]', isActive ? 'bg-sky-400/18 text-sky-200' : 'bg-white/6 text-slate-300')}>
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-400">{item.description}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <div
        className={clsx(
          'app-sheet fixed inset-x-0 bottom-0 z-50 rounded-t-[32px] border border-white/10 bg-[#0a1324]/96 px-5 pt-4 backdrop-blur-2xl transition-transform duration-300 xl:hidden',
          accountSheetOpen ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-white/12" />
        <div className="surface-glass rounded-[28px] p-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-gradient-to-br from-sky-400/35 to-blue-600/35 text-lg font-bold text-white">
              {userInitials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold text-white">{user?.firstName} {user?.lastName}</p>
              <p className="truncate text-sm text-slate-400">{user?.email}</p>
            </div>
          </div>

          {user && user.organizations.length > 1 && (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200/70">Switch organization</p>
              <div className="mt-3 grid gap-2">
                {user.organizations.map((org) => {
                  const active = org.orgId === activeOrg?.orgId;
                  return (
                    <button
                      key={org.orgId}
                      onClick={() => {
                        useAuthStore.getState().switchOrg(org.orgId);
                        closeSheets();
                      }}
                      className={clsx(
                        'rounded-[20px] border px-4 py-3 text-left transition-colors',
                        active ? 'border-sky-400/35 bg-sky-400/12 text-white' : 'border-white/8 bg-white/4 text-slate-200',
                      )}
                    >
                      <span className="block text-sm font-semibold">{org.orgName}</span>
                      <span className="mt-1 block text-xs text-slate-400">{org.role.replace('_', ' ')} • {org.orgType}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-5 flex gap-3">
            <button
              onClick={closeSheets}
              className="flex-1 rounded-[20px] border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200"
            >
              Close
            </button>
            <button
              data-testid="logout-button"
              onClick={handleLogout}
              className="flex-1 rounded-[20px] bg-gradient-to-r from-rose-500 to-red-600 px-4 py-3 text-sm font-semibold text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
