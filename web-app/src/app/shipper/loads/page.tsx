'use client';

import { useLoads } from '../../../hooks/queries';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { PageLoader, EmptyState, ErrorDisplay } from '../../../components/ui/feedback';
import { formatUSD, formatDistance, formatWeight, loadStatusColors, cargoTypeLabels } from '../../../lib/utils';
import Link from 'next/link';
import { format } from 'date-fns';
import type { Load } from '../../../lib/types';

function LoadCard({ load }: { load: Load }) {
  return (
    <Link href={`/shipper/loads/${load.id}`}>
      <Card hover>
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs text-gray-500 font-mono">{load.reference_number}</p>
            <h3 className="text-lg font-semibold text-white mt-0.5">
              {load.pickup_city}, {load.pickup_state} → {load.dropoff_city}, {load.dropoff_state}
            </h3>
          </div>
          <Badge className={loadStatusColors[load.status]}>{load.status}</Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-gray-500">Cargo</p>
            <p className="text-gray-200">{cargoTypeLabels[load.cargo_type] ?? load.cargo_type}</p>
          </div>
          <div>
            <p className="text-gray-500">Weight</p>
            <p className="text-gray-200">{formatWeight(load.weight_lbs)}</p>
          </div>
          <div>
            <p className="text-gray-500">Distance</p>
            <p className="text-gray-200">{formatDistance(load.distance_miles)}</p>
          </div>
          <div>
            <p className="text-gray-500">Rate</p>
            <p className="text-gray-200 font-semibold">{formatUSD(load.offered_rate_usd)}</p>
          </div>
        </div>

        {load.total_trucks_required > 1 && (
          <div className="mt-3 pt-3 border-t border-gray-700/50">
            <p className="text-xs text-gray-400 mb-1.5">
              Multi-truck: {load.total_trucks_required} trucks needed
            </p>
          </div>
        )}

        <div className="mt-3 text-xs text-gray-500">
          Pickup: {format(new Date(load.pickup_earliest), 'MMM d, yyyy h:mm a')}
        </div>
      </Card>
    </Link>
  );
}

export default function ShipperLoadsPage() {
  const { data, isLoading, error, refetch } = useLoads();

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const loads = data?.data ?? [];
  const activeLoads = loads.filter((l) => !['DELIVERED', 'CANCELLED'].includes(l.status));
  const deliveredCount = loads.filter((l) => l.status === 'DELIVERED').length;

  return (
    <div className="animate-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">My Loads</h1>
          <p className="text-sm text-gray-400 mt-1">Manage your freight shipments</p>
        </div>
        <Link href="/shipper/loads/new">
          <Button>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Load
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Loads" value={loads.length} />
        <StatCard label="Active" value={activeLoads.length} />
        <StatCard label="Delivered" value={deliveredCount} />
        <StatCard label="Revenue" value={formatUSD(loads.reduce((s, l) => s + (l.offered_rate_usd ?? 0), 0))} />
      </div>

      {/* Load list */}
      {loads.length === 0 ? (
        <EmptyState
          title="No loads yet"
          description="Create your first load to get started"
          action={
            <Link href="/shipper/loads/new">
              <Button>Create Load</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4">
          {loads.map((load) => (
            <LoadCard key={load.id} load={load} />
          ))}
        </div>
      )}
    </div>
  );
}
