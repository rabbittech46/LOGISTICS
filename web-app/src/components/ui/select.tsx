'use client';

import { clsx } from 'clsx';
import { forwardRef, useId, type SelectHTMLAttributes } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, id, ...props }, ref) => {
    const generatedId = useId().replace(/:/g, '');
    const selectId = id ?? (label ? `${label.toLowerCase().replace(/\s+/g, '-')}-${generatedId}` : generatedId);
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-gray-300 mb-1.5">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${selectId}-error` : undefined}
          className={clsx(
            'w-full rounded-lg border bg-gray-800/50 text-gray-100 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500',
            error
              ? 'border-red-500/50 focus:ring-red-500/50 focus:border-red-500'
              : 'border-gray-700 hover:border-gray-600',
            'px-3 py-2 text-sm',
            className,
          )}
          {...props}
        >
          {placeholder && (
            <option value="" className="bg-gray-800 text-gray-500">
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-gray-800">
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p id={`${selectId}-error`} className="mt-1 text-xs text-red-400" role="alert">{error}</p>}
      </div>
    );
  },
);
Select.displayName = 'Select';
