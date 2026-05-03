'use client';

import { clsx } from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
  pulse?: boolean;
}

export function Badge({
  children,
  className,
  variant = 'default',
  size = 'sm',
  pulse = false,
}: BadgeProps) {
  const variants = {
    default: 'border-white/10 bg-white/8 text-slate-300',
    success: 'border-emerald-400/20 bg-emerald-500/18 text-emerald-200',
    warning: 'border-amber-400/22 bg-amber-500/18 text-amber-100',
    danger: 'border-red-400/22 bg-red-500/18 text-red-100',
    info: 'border-sky-400/22 bg-sky-500/18 text-sky-100',
  };

  const sizes = {
    sm: 'px-2.5 py-1 text-[0.7rem]',
    md: 'px-3 py-1.5 text-sm',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}
