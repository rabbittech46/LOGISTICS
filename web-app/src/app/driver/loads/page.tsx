'use client';

import { useState } from 'react';
import { useLoadBoard } from '../../../hooks/queries';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { PageLoader, EmptyState, ErrorDisplay } from '../../../components/ui/feedback';
import { formatUSD, formatDistance, formatWeight, cargoTypeLabels } from '../../../lib/utils';
import { cargoTypes } from '../../../lib/validations';
import Link from 'next/link';
import { format } from 'date-fns';
import type { Load } from '../../../lib/types';

function DriverLoadCard({ load }: { load: Load }) {
  return (
    <Link href={`/driver/loads/${load.id}`}>
      <Card hover className="active:scale-[0.98] transition-transform">
        {/* Route header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-center mr-1">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <div className="w-0.5 h-8 bg-gray-700" />
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">
                  {load.pickup_city}, {load.pickup_state}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {format(new Date(load.pickup_earliest), 'MMM d, h:mm a')}
                </p>
                <p className="text-sm font-semibold text-white mt-2">
                  {load.dropoff_city}, {load.dropoff_state}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {format(new Date(load.dropoff_earliest), 'MMM d, h:mm a')}
                </p>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-emerald-400">
              {formatUSD(load.offered_rate_usd)}
            </p>
            <p className="text-xs text-gray-500">{formatDistance(load.distance_miles)}</p>
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-700/50 text-xs text-gray-400">
          <Badge size="sm" variant="info">{cargoTypeLabels[load.cargo_type] ?? load.cargo_type}</Badge>
          <span>{formatWeight(load.weight_lbs)}</span>
          {load.total_trucks_required > 1 && (
            <Badge size="sm" variant="warning">{load.total_trucks_required} trucks</Badge>
          )}
          {load.is_hazmat && <Badge size="sm" variant="danger">Hazmat</Badge>}
        </div>
      </Card>
    </Link>
  );
}

export default function DriverLoadBoardPage() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const { data, isLoading, error, refetch } = useLoadBoard(filters);

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const loads = data?.data ?? [];

  const cargoOptions = [
    { value: '', label: 'All types' },
    ...cargoTypes.map((ct) => ({ value: ct, label: cargoTypeLabels[ct] ?? ct })),
  ];

  return (
    <div className="animate-in">
      <div className="grid gap-4">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/70">Driver lane feed</p>
              <h1 className="mt-2 text-3xl font-black text-white">Load Board</h1>
              <p className="mt-2 text-sm text-slate-300">{loads.length} live loads available. This feed auto-refreshes every 10 seconds.</p>
            </div>
            <div className="grid grid-cols-3 gap-3 lg:w-[24rem]">
              <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-400">Total</p>
                <p className="mt-2 text-2xl font-black text-white">{loads.length}</p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-400">Multi</p>
                <p className="mt-2 text-2xl font-black text-white">{loads.filter((load) => load.total_trucks_required > 1).length}</p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-400">Hazmat</p>
                <p className="mt-2 text-2xl font-black text-white">{loads.filter((load) => load.is_hazmat).length}</p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Input
                data-testid="driver-state-filter"
                label="Pickup state"
                placeholder="IL, TX, CA"
                onChange={(e) =>
                  setFilters((f) => {
                    const next = { ...f };
                    if (e.target.value) next.pickupState = e.target.value.toUpperCase();
                    else delete next.pickupState;
                    return next;
                  })
                }
              />
            </div>
            <div className="sm:w-56">
              <Select
                data-testid="driver-cargo-filter"
                options={cargoOptions}
                onChange={(e) =>
                  setFilters((f) => {
                    const next = { ...f };
                    if (e.target.value) next.cargoType = e.target.value;
                    else delete next.cargoType;
                    return next;
                  })
                }
                className="sm:mt-[1.9rem]"
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Load list */}
      {loads.length === 0 ? (
        <EmptyState
          title="No loads available"
          description="Check back soon — new loads are posted every few minutes"
          action={<Button variant="secondary" onClick={() => refetch()}>Refresh</Button>}
        />
      ) : (
        <div className="mt-4 grid gap-4">
          {loads.map((load) => (
            <DriverLoadCard key={load.id} load={load} />
          ))}
        </div>
      )}
    </div>
  );
}
