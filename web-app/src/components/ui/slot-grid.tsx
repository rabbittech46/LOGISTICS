'use client';

import { clsx } from 'clsx';
import type { SlotStatus } from '../../lib/types';

interface SlotGridProps {
  totalSlots: number;
  availableSlots: number;
  reservedSlots: number;
  bookedSlots: number;
  compact?: boolean;
}

const statusColors: Record<SlotStatus, string> = {
  AVAILABLE: 'bg-emerald-500',
  RESERVED: 'bg-amber-500',
  BOOKED: 'bg-blue-500',
};

export function SlotGrid({ totalSlots, availableSlots, reservedSlots, bookedSlots, compact = false }: SlotGridProps) {
  // Build an array representing each slot's status
  const slots: SlotStatus[] = [
    ...Array(bookedSlots).fill('BOOKED' as const),
    ...Array(reservedSlots).fill('RESERVED' as const),
    ...Array(availableSlots).fill('AVAILABLE' as const),
  ].slice(0, totalSlots);

  // Fill remainder with AVAILABLE if math doesn't add up
  while (slots.length < totalSlots) {
    slots.push('AVAILABLE');
  }

  return (
    <div>
      <div className={clsx('flex flex-wrap gap-1', compact && 'gap-0.5')}>
        {slots.map((status, i) => (
          <div
            key={i}
            className={clsx(
              'rounded-sm transition-colors',
              compact ? 'w-3 h-3' : 'w-5 h-5',
              statusColors[status],
              status === 'AVAILABLE' && 'opacity-30',
              status === 'RESERVED' && 'opacity-70 animate-pulse',
            )}
            title={`Slot ${i + 1}: ${status}`}
          />
        ))}
      </div>
      {!compact && (
        <div className="flex gap-4 mt-2 text-xs text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 opacity-30" /> Available ({availableSlots})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500 opacity-70" /> Reserved ({reservedSlots})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Booked ({bookedSlots})
          </span>
        </div>
      )}
    </div>
  );
}

// ── Countdown Timer ─────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react';

export function ReservationTimer({ expiresAt, onExpire }: { expiresAt: string; onExpire?: () => void }) {
  const [remaining, setRemaining] = useState<number>(0);
  const expiredRef = useRef(false);

  useEffect(() => {
    expiredRef.current = false;
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      const secs = Math.max(0, Math.floor(diff / 1000));
      setRemaining(secs);
      if (secs <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const isUrgent = remaining < 60;

  if (remaining <= 0) {
    return <span className="text-red-400 text-sm font-medium">Expired</span>;
  }

  return (
    <span
      className={clsx(
        'text-sm font-mono font-bold tabular-nums',
        isUrgent ? 'text-red-400 animate-pulse' : 'text-amber-400',
      )}
    >
      {mins}:{secs.toString().padStart(2, '0')}
    </span>
  );
}
