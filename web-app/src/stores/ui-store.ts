// ─────────────────────────────────────────────────────────────────────────────
// Zustand UI store — sidebar state, modals, toasts
// ─────────────────────────────────────────────────────────────────────────────
import { create } from 'zustand';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  duration?: number;
}

const MAX_TOASTS = 5;

interface UIState {
  navigationOpen: boolean;
  toggleNavigation: () => void;
  setNavigationOpen: (open: boolean) => void;

  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  accountSheetOpen: boolean;
  toggleAccountSheet: () => void;
  setAccountSheetOpen: (open: boolean) => void;

  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

let toastCounter = 0;
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useUIStore = create<UIState>()((set) => ({
  navigationOpen: false,
  toggleNavigation: () =>
    set((state) => ({ navigationOpen: !state.navigationOpen, sidebarOpen: !state.navigationOpen })),
  setNavigationOpen: (open) => set({ navigationOpen: open, sidebarOpen: open }),

  sidebarOpen: true,
  toggleSidebar: () =>
    set((state) => ({ navigationOpen: !state.navigationOpen, sidebarOpen: !state.navigationOpen })),
  setSidebarOpen: (open) => set({ navigationOpen: open, sidebarOpen: open }),

  accountSheetOpen: false,
  toggleAccountSheet: () => set((state) => ({ accountSheetOpen: !state.accountSheetOpen })),
  setAccountSheetOpen: (open) => set({ accountSheetOpen: open }),

  toasts: [],
  addToast: (toast) => {
    const id = `toast-${++toastCounter}`;
    set((s) => {
      // Enforce max toast limit — drop oldest
      const existing = [...s.toasts, { ...toast, id }];
      if (existing.length > MAX_TOASTS) {
        const removed = existing.shift();
        if (removed) {
          const timer = dismissTimers.get(removed.id);
          if (timer) { clearTimeout(timer); dismissTimers.delete(removed.id); }
        }
      }
      return { toasts: existing };
    });
    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      const timer = setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
        dismissTimers.delete(id);
      }, duration);
      dismissTimers.set(id, timer);
    }
  },
  removeToast: (id) => {
    const timer = dismissTimers.get(id);
    if (timer) { clearTimeout(timer); dismissTimers.delete(id); }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
