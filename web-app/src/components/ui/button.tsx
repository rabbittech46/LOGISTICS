'use client';

import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center rounded-[20px] font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#081121] disabled:cursor-not-allowed disabled:opacity-50';

  const variants = {
    primary:
      'bg-gradient-to-r from-sky-400 to-blue-600 text-white shadow-[0_18px_34px_rgba(31,134,255,0.3)] hover:brightness-110 focus:ring-sky-400 active:scale-[0.99]',
    secondary:
      'border border-white/10 bg-white/6 text-slate-100 hover:bg-white/10 focus:ring-slate-400',
    danger:
      'bg-gradient-to-r from-rose-500 to-red-600 text-white hover:brightness-110 focus:ring-red-400 active:scale-[0.99]',
    ghost:
      'bg-transparent text-slate-300 hover:bg-white/6 hover:text-white focus:ring-slate-400',
  };

  const sizes = {
    sm: 'h-10 gap-1.5 px-3.5 text-xs',
    md: 'h-12 gap-2 px-4.5 text-sm',
    lg: 'h-14 gap-2.5 px-6 text-base',
  };

  return (
    <button
      type={props.type ?? 'button'}
      className={clsx(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <svg
          className="animate-spin h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
