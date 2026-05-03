'use client';

import { useUIStore, type Toast as ToastType } from '../../stores/ui-store';
import { clsx } from 'clsx';

const icons: Record<ToastType['type'], string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const styles: Record<ToastType['type'], string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10',
  error: 'border-red-500/30 bg-red-500/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
  info: 'border-blue-500/30 bg-blue-500/10',
};

const iconColors: Record<ToastType['type'], string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-blue-400',
};

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-[calc(var(--safe-bottom)+5.4rem)] left-1/2 z-50 flex w-[min(92vw,28rem)] -translate-x-1/2 flex-col gap-2 lg:bottom-auto lg:left-auto lg:right-6 lg:top-6 lg:translate-x-0" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            'animate-in flex items-start gap-3 rounded-[24px] border p-3.5 shadow-[0_24px_50px_rgba(2,7,18,0.4)] backdrop-blur-xl slide-in-from-right',
            styles[toast.type],
          )}
        >
          <span className={clsx('text-lg font-bold mt-0.5', iconColors[toast.type])}>
            {icons[toast.type]}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-100">{toast.title}</p>
            {toast.message && (
              <p className="mt-0.5 text-xs text-gray-300/85">{toast.message}</p>
            )}
          </div>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-sm text-gray-500 hover:text-gray-200"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
