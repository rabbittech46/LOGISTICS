'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLoads } from '../../../hooks/queries';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';
import { formatUSD, loadStatusColors, cargoTypeLabels } from '../../../lib/utils';
import type { LoadStatus } from '../../../lib/types';
import { format } from 'date-fns';

const statusOptions = [
  { value: '', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'BIDDING', label: 'Bidding' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'IN_TRANSIT', label: 'In Transit' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'DISPUTED', label: 'Disputed' },
];

export default function AdminLoadsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { data, isLoading, error, refetch } = useLoads(
    statusFilter ? { status: statusFilter as LoadStatus } : {},
  );

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const loads = data?.data ?? [];

  const stats = {
    total: loads.length,
    active: loads.filter((l) => ['POSTED', 'ASSIGNED', 'IN_TRANSIT'].includes(l.status)).length,
    delivered: loads.filter((l) => l.status === 'DELIVERED' || l.status === 'COMPLETED').length,
    cancelled: loads.filter((l) => l.status === 'CANCELLED').length,
  };

  return (
    <div className="animate-in">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-white">All Loads</h1>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total Loads" value={stats.total} />
        <StatCard label="Active" value={stats.active} />
        <StatCard label="Delivered" value={stats.delivered} />
        <StatCard label="Cancelled" value={stats.cancelled} />
      </div>

      {/* Filter */}
      <div className="mb-4">
        <Select
          options={statusOptions}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          placeholder="Filter by status"
        />
      </div>

      {loads.length === 0 ? (
        <EmptyState title="No loads found" description="Adjust filters or wait for new loads" />
      ) : (
        <div className="space-y-2">
          {loads.map((load) => (
            <Link key={load.id} href={`/admin/loads/${load.id}`}>
              <Card className="hover:border-gray-600 transition-colors cursor-pointer">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-mono text-gray-500">{load.reference_number}</p>
                  <Badge className={loadStatusColors[load.status]}>{load.status}</Badge>
                </div>
                <p className="text-sm font-medium text-white">
                  {load.pickup_city}, {load.pickup_state} → {load.dropoff_city}, {load.dropoff_state}
                </p>
                <div className="flex items-center justify-between mt-1.5 text-xs text-gray-400">
                  <span>
                    {cargoTypeLabels[load.cargo_type]} • {load.total_trucks_required} truck
                    {load.total_trucks_required > 1 ? 's' : ''}
                  </span>
                  <span className="text-emerald-400 font-semibold">{formatUSD(load.offered_rate_usd)}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Created: {format(new Date(load.created_at), 'MMM d, yyyy h:mm a')}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
