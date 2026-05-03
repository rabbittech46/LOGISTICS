'use client';

import { ApiRequestError } from '../../lib/api-client';

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin text-sky-300 ${className}`}
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
  );
}

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="surface-elevated rounded-[32px] px-8 py-8 text-center">
        <Spinner className="mx-auto h-9 w-9" />
        <p className="mt-4 text-sm font-medium text-slate-300">Loading the control surface...</p>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="surface-elevated flex flex-col items-center justify-center rounded-[32px] px-5 py-12 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[24px] bg-white/6">
        <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <h3 className="text-lg font-bold text-white">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-sm text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorDisplay({
  error,
  onRetry,
}: {
  error: Error;
  onRetry?: () => void;
}) {
  // Only show safe user-facing messages; hide raw internal errors
  const safeMessage = error instanceof ApiRequestError
    ? error.errorBody.error || `Request failed (${error.statusCode})`
    : 'An unexpected error occurred. Please try again.';

  return (
    <div className="surface-elevated flex flex-col items-center justify-center rounded-[32px] px-5 py-12 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-[24px] bg-red-500/10">
        <svg className="h-8 w-8 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-1.5-1.732-1.5S10.038 3.167 9.268 4L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>
      <h3 className="text-lg font-bold text-white">Something went wrong</h3>
      <p className="mt-2 max-w-sm text-sm text-red-200" role="alert">{safeMessage}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 rounded-[20px] border border-white/10 bg-white/6 px-4 py-3 text-sm font-semibold text-slate-100 transition-colors hover:bg-white/10"
        >
          Try again
        </button>
      )}
    </div>
  );
}
