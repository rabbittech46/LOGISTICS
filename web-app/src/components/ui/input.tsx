'use client';

import { clsx } from 'clsx';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, leftIcon, className, id, ...props }, ref) => {
    const generatedId = useId().replace(/:/g, '');
    const inputId = id ?? (label ? `${label.toLowerCase().replace(/\s+/g, '-')}-${generatedId}` : generatedId);
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-2 block text-sm font-semibold text-slate-200"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
            className={clsx(
              'w-full rounded-[22px] border bg-white/[0.045] text-slate-50 placeholder-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-sky-400/40 focus:border-sky-400',
              error
                ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/40'
                : 'border-white/10 hover:border-white/18',
              leftIcon ? 'pl-11' : 'pl-4',
              'pr-4 py-3.5 text-sm',
              className,
            )}
            {...props}
          />
        </div>
        {error && <p id={`${inputId}-error`} className="mt-2 text-xs text-red-300" role="alert">{error}</p>}
        {hint && !error && <p id={`${inputId}-hint`} className="mt-2 text-xs text-slate-400">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';
