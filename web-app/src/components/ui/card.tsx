'use client';

import { clsx } from 'clsx';
import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg' | 'none';
  hover?: boolean;
  onClick?: () => void;
}

export function Card({ children, className, padding = 'md', hover = false, onClick }: CardProps) {
  const paddings = {
    none: '',
    sm: 'p-3',
    md: 'p-4 sm:p-5',
    lg: 'p-6 sm:p-8',
  };

  return (
    <div
      className={clsx(
        'surface-elevated rounded-[28px] text-slate-50',
        paddings[padding],
        hover && 'cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:border-white/18 hover:shadow-[0_26px_50px_rgba(2,7,18,0.5)]',
        className,
      )}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </div>
  );
}

// ── Stat Card ───────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: ReactNode;
}

export function StatCard({ label, value, change, trend, icon }: StatCardProps) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-black text-white">{value}</p>
          {change && (
            <p
              className={clsx(
                'mt-2 text-xs font-semibold',
                trend === 'up' && 'text-emerald-400',
                trend === 'down' && 'text-red-400',
                trend === 'neutral' && 'text-slate-400',
              )}
            >
              {change}
            </p>
          )}
        </div>
        {icon && (
          <div className="rounded-[20px] bg-white/6 p-3 text-slate-300 shadow-[0_14px_30px_rgba(2,7,18,0.22)]">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
