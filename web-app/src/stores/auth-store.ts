// ─────────────────────────────────────────────────────────────────────────────
// Zustand auth store — JWT token + user state + role-based routing
// ─────────────────────────────────────────────────────────────────────────────
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { setAccessToken } from '../lib/api-client';
import { setStoredRefreshToken } from '../lib/native-session';
import type { User, UserOrg, UserRole } from '../lib/types';

interface AuthState {
  user: User | null;
  activeOrg: UserOrg | null;
  isAuthenticated: boolean;
  /** True once post-hydration token check has completed */
  hydrated: boolean;

  login: (user: User, accessToken: string, refreshToken?: string) => void;
  logout: () => void;
  switchOrg: (orgId: string) => void;
  setUser: (user: User) => void;
  setHydrated: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      activeOrg: null,
      isAuthenticated: false,
      hydrated: false,

      login: (user, accessToken, refreshToken) => {
        setAccessToken(accessToken);
        if (refreshToken) {
          void setStoredRefreshToken(refreshToken);
        }
        const activeOrg = user.organizations[0] ?? null;
        set({ user, activeOrg, isAuthenticated: true });
      },

      logout: () => {
        setAccessToken(null);
        void setStoredRefreshToken(null);
        set({ user: null, activeOrg: null, isAuthenticated: false });
      },

      switchOrg: (orgId) => {
        const { user } = get();
        if (!user) return;
        const org = user.organizations.find((o) => o.orgId === orgId);
        if (org) set({ activeOrg: org });
      },

      setUser: (user) => {
        const { activeOrg } = get();
        const newActiveOrg = activeOrg
          ? user.organizations.find((o) => o.orgId === activeOrg.orgId) ?? user.organizations[0]
          : user.organizations[0];
        set({ user, activeOrg: newActiveOrg ?? null });
      },

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'logistics-auth',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? localStorage : {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        }
      ),
      partialize: (state) => ({
        user: state.user,
        activeOrg: state.activeOrg,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        // After hydration from localStorage, reconcile auth state:
        // If persisted isAuthenticated=true but there's no in-memory token,
        // attempt a silent refresh. The Providers component will handle this.
        if (state) {
          state.setHydrated();
        }
      },
    }
  )
);

// ── Selectors ───────────────────────────────────────────────────────────────
export const selectRole = (state: AuthState): UserRole | null =>
  state.activeOrg?.role ?? null;

export const selectOrgType = (state: AuthState): 'SHIPPER' | 'CARRIER' | null =>
  state.activeOrg?.orgType ?? null;

export const selectIsShipper = (state: AuthState): boolean =>
  state.activeOrg?.orgType === 'SHIPPER';

export const selectIsCarrier = (state: AuthState): boolean =>
  state.activeOrg?.orgType === 'CARRIER';

export const selectIsDriver = (state: AuthState): boolean =>
  state.activeOrg?.role === 'DRIVER';

export const selectIsDispatcher = (state: AuthState): boolean =>
  state.activeOrg?.role === 'DISPATCHER';

/** Only true for the global platform admin — NOT carrier/shipper ORG_ADMINs */
export const selectIsPlatformAdmin = (state: AuthState): boolean =>
  state.activeOrg?.role === 'PLATFORM_ADMIN';

/** Carrier ORG_ADMIN or DISPATCHER — the people who manage a carrier org */
export const selectIsCarrierManager = (state: AuthState): boolean =>
  state.activeOrg?.orgType === 'CARRIER' &&
  (state.activeOrg?.role === 'ORG_ADMIN' || state.activeOrg?.role === 'DISPATCHER');

/** Shipper ORG_ADMIN or SHIPPER_STAFF */
export const selectIsShipperUser = (state: AuthState): boolean =>
  state.activeOrg?.orgType === 'SHIPPER' &&
  (state.activeOrg?.role === 'ORG_ADMIN' || state.activeOrg?.role === 'SHIPPER_STAFF');

/** Legacy: true for PLATFORM_ADMIN or any ORG_ADMIN */
export const selectIsAdmin = (state: AuthState): boolean =>
  state.activeOrg?.role === 'PLATFORM_ADMIN' || state.activeOrg?.role === 'ORG_ADMIN';
