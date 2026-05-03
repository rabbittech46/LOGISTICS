'use client';

import { useOrganizations, useLoads, useAllBids } from '../../../hooks/queries';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { PageLoader } from '../../../components/ui/feedback';
import Link from 'next/link';

export default function AdminDashboardPage() {
  const orgs = useOrganizations();
  const loads = useLoads();
  const bids = useAllBids();

  if (orgs.isLoading || loads.isLoading) return <PageLoader />;

  const orgList = orgs.data?.data ?? [];
  const loadList = loads.data?.data ?? [];
  const bidList = bids.data?.data ?? [];

  const activeLoads = loadList.filter((l) => !['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(l.status));
  const inTransit = loadList.filter((l) => l.status === 'IN_TRANSIT');
  const carriers = orgList.filter((o) => o.org_type === 'CARRIER');
  const shippers = orgList.filter((o) => o.org_type === 'SHIPPER');
  const totalRevenue = loadList
    .filter((l) => l.status === 'COMPLETED' || l.status === 'DELIVERED')
    .reduce((sum, l) => sum + (l.offered_rate_usd ?? 0), 0);

  return (
    <div className="animate-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Platform Overview</h1>
        <p className="text-sm text-gray-400 mt-1">System-wide metrics and activity</p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="Organizations" value={orgList.length} />
        <StatCard label="Active Loads" value={activeLoads.length} />
        <StatCard label="In Transit" value={inTransit.length} />
        <StatCard label="Total Bids" value={bidList.length} />
        <StatCard label="Revenue" value={`$${(totalRevenue / 1000).toFixed(0)}k`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Recent Loads */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Recent Loads</h2>
            <Link href="/admin/loads" className="text-xs text-blue-400 hover:text-blue-300">
              View all &rarr;
            </Link>
          </div>
          <div className="space-y-2">
            {loadList.slice(0, 5).map((load) => (
              <Link
                key={load.id}
                href={`/admin/loads/${load.id}`}
                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-700/50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {load.reference_number}
                  </p>
                  <p className="text-xs text-gray-400">
                    {load.pickup_city}, {load.pickup_state} &rarr; {load.dropoff_city}, {load.dropoff_state}
                  </p>
                </div>
                <Badge
                  variant={
                    load.status === 'IN_TRANSIT' ? 'info' :
                    load.status === 'DELIVERED' ? 'success' :
                    load.status === 'CANCELLED' ? 'danger' :
                    load.status === 'POSTED' ? 'warning' : 'default'
                  }
                >
                  {load.status.replace('_', ' ')}
                </Badge>
              </Link>
            ))}
            {loadList.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No loads yet</p>
            )}
          </div>
        </Card>

        {/* Organizations */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Organizations</h2>
            <Link href="/admin/orgs" className="text-xs text-blue-400 hover:text-blue-300">
              Manage &rarr;
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-400">{carriers.length}</p>
              <p className="text-xs text-gray-400">Carriers</p>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-400">{shippers.length}</p>
              <p className="text-xs text-gray-400">Shippers</p>
            </div>
          </div>
          <div className="space-y-2">
            {orgList.slice(0, 5).map((org) => (
              <div key={org.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-700/20">
                <p className="text-sm font-medium text-white">{org.name}</p>
                <Badge className={org.org_type === 'CARRIER' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}>
                  {org.org_type}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
