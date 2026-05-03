'use client';

import { useState } from 'react';
import { useTrucks } from '../../../hooks/queries';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';

const statusColors: Record<string, { variant: 'success' | 'info' | 'warning' | 'danger' | 'default' }> = {
  AVAILABLE: { variant: 'success' },
  BUSY: { variant: 'info' },
  MAINTENANCE: { variant: 'warning' },
  INACTIVE: { variant: 'danger' },
};

export default function CarrierFleetPage() {
  const [filter, setFilter] = useState<string>('');
  const { data, isLoading, error, refetch } = useTrucks(filter ? { status: filter } : undefined);

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const trucks = data?.data ?? [];

  const stats = {
    total: trucks.length,
    available: trucks.filter((t) => t.status === 'AVAILABLE').length,
    onTrip: trucks.filter((t) => t.status === 'BUSY').length,
    maintenance: trucks.filter((t) => t.status === 'MAINTENANCE').length,
  };

  return (
    <div className="animate-in">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Fleet Management</h1>
          <p className="text-sm text-gray-400 mt-1">Trucks registered in your organization</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="Available" value={stats.available} />
        <StatCard label="On Trip" value={stats.onTrip} />
        <StatCard label="Maintenance" value={stats.maintenance} />
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {['', 'AVAILABLE', 'BUSY', 'MAINTENANCE'].map((s) => (
          <Button
            key={s}
            size="sm"
            variant={filter === s ? 'primary' : 'ghost'}
            onClick={() => setFilter(s)}
          >
            {s || 'All'}
          </Button>
        ))}
      </div>

      {trucks.length === 0 ? (
        <EmptyState
          title="No trucks found"
          description={filter ? 'Try a different filter' : 'No trucks registered yet'}
        />
      ) : (
        <div className="space-y-2">
          {trucks.map((truck) => (
            <Card key={truck.id} className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-sm text-white">{truck.plate_number}</p>
                  <Badge {...(statusColors[truck.status] ?? { variant: 'default' })}>
                    {truck.status?.replace('_', ' ')}
                  </Badge>
                </div>
                <p className="text-xs text-gray-400">
                  {truck.make} {truck.model} {truck.year ?? ''} &bull; {truck.cargo_type?.replace('_', ' ')}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Capacity: {truck.payload_capacity_lbs?.toLocaleString() ?? '—'} lbs
                  {truck.vin ? ` · VIN: ${truck.vin}` : ''}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
