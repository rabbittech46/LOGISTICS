'use client';

import { useLoads } from '../../../hooks/queries';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { PageLoader } from '../../../components/ui/feedback';
import Link from 'next/link';

export default function ShipperDashboardPage() {
  const { data, isLoading } = useLoads();
  const loads = data?.data ?? [];

  if (isLoading) return <PageLoader />;

  const draft = loads.filter((l) => l.status === 'DRAFT');
  const posted = loads.filter((l) => l.status === 'POSTED');
  const inTransit = loads.filter((l) => l.status === 'IN_TRANSIT');
  const delivered = loads.filter((l) => l.status === 'DELIVERED' || l.status === 'COMPLETED');
  const totalSpend = loads
    .filter((l) => l.status === 'COMPLETED' || l.status === 'DELIVERED')
    .reduce((sum, l) => sum + (l.offered_rate_usd ?? 0), 0);

  return (
    <div className="animate-in">
      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/70">Shipper control tower</p>
            <h1 className="mt-2 text-3xl font-black text-white">Freight operations at a glance</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-300">Monitor posted lanes, watch in-transit freight, and keep escrow funding ahead of dispatch demand.</p>
          </div>
          <Link
            href="/shipper/loads/new"
            className="inline-flex h-12 items-center justify-center rounded-[20px] bg-gradient-to-r from-sky-400 to-blue-600 px-5 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(31,134,255,0.3)]"
          >
            Create new load
          </Link>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Loads" value={loads.length} />
        <StatCard label="Drafts" value={draft.length} />
        <StatCard label="Posted" value={posted.length} />
        <StatCard label="In Transit" value={inTransit.length} />
        <StatCard label="Delivered" value={delivered.length} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Active Loads */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Active Loads</h2>
            <Link href="/shipper/loads" className="text-xs text-blue-400 hover:text-blue-300">
              View all &rarr;
            </Link>
          </div>
          <div className="space-y-2">
            {[...posted, ...inTransit].slice(0, 6).map((load) => (
              <Link
                key={load.id}
                href={`/shipper/loads/${load.id}`}
                className="flex items-center justify-between rounded-[22px] border border-white/8 bg-white/4 px-4 py-3 transition-colors hover:bg-white/7"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{load.reference_number}</p>
                  <p className="text-xs text-slate-400">
                    {load.pickup_city}, {load.pickup_state} &rarr; {load.dropoff_city}, {load.dropoff_state}
                  </p>
                </div>
                <Badge
                  variant={load.status === 'IN_TRANSIT' ? 'info' : load.status === 'POSTED' ? 'warning' : 'default'}
                >
                  {load.status.replace('_', ' ')}
                </Badge>
              </Link>
            ))}
            {posted.length + inTransit.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">
                No active loads.{' '}
                <Link href="/shipper/loads/new" className="text-sky-300 hover:underline">Create one</Link>
              </p>
            )}
          </div>
        </Card>

        {/* Quick Stats */}
        <Card>
          <h2 className="font-semibold text-white mb-4">Summary</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/8 py-3">
              <span className="text-sm text-slate-400">Total Spend</span>
              <span className="text-lg font-bold text-emerald-400">${totalSpend.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between border-b border-white/8 py-3">
              <span className="text-sm text-slate-400">Avg. Rate per Load</span>
              <span className="text-lg font-bold text-white">
                ${delivered.length > 0 ? Math.round(totalSpend / delivered.length).toLocaleString() : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between py-3">
              <span className="text-sm text-slate-400">Completion Rate</span>
              <span className="text-lg font-bold text-white">
                {loads.length > 0
                  ? `${Math.round((delivered.length / loads.length) * 100)}%`
                  : '—'}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
