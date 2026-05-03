'use client';

import { useState } from 'react';
import { useLoadBoard } from '../../../hooks/queries';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';
import Link from 'next/link';

const cargoTypeColors: Record<string, string> = {
  DRY_VAN: 'bg-blue-500/20 text-blue-400',
  REFRIGERATED: 'bg-cyan-500/20 text-cyan-400',
  FLATBED: 'bg-amber-500/20 text-amber-400',
  TANKER: 'bg-purple-500/20 text-purple-400',
  HAZMAT: 'bg-red-500/20 text-red-400',
  OVERSIZED: 'bg-orange-500/20 text-orange-400',
};

export default function CarrierLoadsPage() {
  const [stateFilter, setStateFilter] = useState('');
  const params: Record<string, string> = {};
  if (stateFilter) params.pickupState = stateFilter;

  const { data, isLoading, error, refetch } = useLoadBoard(Object.keys(params).length ? params : undefined);

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const loads = data?.data ?? [];

  return (
    <div className="animate-in">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">Available Loads</h1>
        <p className="text-sm text-gray-400 mt-1">
          Browse the load board and bid on jobs &bull; Auto-refreshes every 10s
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <StatCard label="Available" value={loads.length} />
        <StatCard
          label="Avg Rate"
          value={loads.length > 0
            ? `$${Math.round(loads.reduce((s, l) => s + (l.offered_rate_usd ?? 0), 0) / loads.length).toLocaleString()}`
            : '—'}
        />
        <StatCard
          label="Avg Distance"
          value={loads.length > 0
            ? `${Math.round(loads.reduce((s, l) => s + (l.distance_miles ?? 0), 0) / loads.length)} mi`
            : '—'}
        />
      </div>

      {/* State filter */}
      <div className="mb-4">
        <input
          data-testid="carrier-state-filter"
          type="text"
          placeholder="Filter by state (e.g. TX, CA)..."
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value.toUpperCase().slice(0, 2))}
          className="w-48 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {loads.length === 0 ? (
        <EmptyState
          title="No loads available"
          description={stateFilter ? 'Try a different state filter' : 'Check back soon for new loads'}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {loads.map((load) => (
            <Link key={load.id} href={`/carrier/loads/${load.id}`}>
              <Card hover className="h-full">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-mono text-gray-500">{load.reference_number}</p>
                  <Badge className={cargoTypeColors[load.cargo_type] ?? 'bg-gray-500/20 text-gray-300'}>
                    {load.cargo_type.replace('_', ' ')}
                  </Badge>
                </div>

                <div className="space-y-1 mb-3">
                  <div className="flex items-start gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <p className="text-sm text-white">{load.pickup_city}, {load.pickup_state}</p>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 mt-1.5 shrink-0" />
                    <p className="text-sm text-white">{load.dropoff_city}, {load.dropoff_state}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                  <div>
                    {load.offered_rate_usd && (
                      <p className="text-lg font-bold text-emerald-400">
                        ${load.offered_rate_usd.toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{load.distance_miles?.toFixed(0)} mi</p>
                    {load.weight_lbs && (
                      <p className="text-xs text-gray-500">{load.weight_lbs.toLocaleString()} lbs</p>
                    )}
                  </div>
                </div>

                {load.is_hazmat && (
                  <Badge variant="danger" size="sm" className="mt-2">⚠ HAZMAT</Badge>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
