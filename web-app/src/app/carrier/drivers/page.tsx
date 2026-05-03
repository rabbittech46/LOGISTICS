'use client';

import { useDrivers } from '../../../hooks/queries';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';

export default function CarrierDriversPage() {
  const { data, isLoading, error, refetch } = useDrivers();

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const drivers = data?.data ?? [];

  const available = drivers.filter((d) => d.is_available);

  return (
    <div className="animate-in">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">Drivers</h1>
        <p className="text-sm text-gray-400 mt-1">Driver profiles in your organization</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <StatCard label="Total" value={drivers.length} />
        <StatCard label="Available" value={available.length} />
        <StatCard label="Unavailable" value={drivers.length - available.length} />
      </div>

      {drivers.length === 0 ? (
        <EmptyState title="No drivers" description="No driver profiles found" />
      ) : (
        <div className="space-y-2">
          {drivers.map((driver) => (
            <Card key={driver.id} className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-sm text-white">
                    Driver {driver.cdl_number}
                  </p>
                  <Badge variant={driver.is_available ? 'success' : 'default'}>
                    {driver.is_available ? 'Available' : 'Unavailable'}
                  </Badge>
                </div>
                <p className="text-xs text-gray-400">
                  CDL: {driver.cdl_number ?? '—'} &bull; Class: {driver.cdl_class ?? '—'}
                  {driver.hazmat_endorsed && ' · HAZMAT'}
                </p>
                {driver.cdl_expiry && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    CDL Expires: {new Date(driver.cdl_expiry).toLocaleDateString()}
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
