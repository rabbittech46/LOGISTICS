'use client';

import { useAllBids } from '../../../hooks/queries';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';
import { formatUSD } from '../../../lib/utils';
import { format } from 'date-fns';

const bidStatusColors: Record<string, string> = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  ACCEPTED: 'bg-emerald-500/20 text-emerald-400',
  REJECTED: 'bg-red-500/20 text-red-400',
  WITHDRAWN: 'bg-gray-600/30 text-gray-400',
  EXPIRED: 'bg-gray-600/30 text-gray-400',
};

export default function AdminBookingsPage() {
  const { data, isLoading, error, refetch } = useAllBids();

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const bids = data?.data ?? [];

  const stats = {
    total: bids.length,
    accepted: bids.filter((b) => b.status === 'ACCEPTED').length,
    pending: bids.filter((b) => b.status === 'PENDING').length,
    rejected: bids.filter((b) => b.status === 'REJECTED').length,
  };

  return (
    <div className="animate-in">
      <h1 className="text-xl font-bold text-white mb-5">Bookings Audit</h1>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total Bids" value={stats.total} />
        <StatCard label="Accepted" value={stats.accepted} />
        <StatCard label="Pending" value={stats.pending} />
        <StatCard label="Rejected" value={stats.rejected} />
      </div>

      {bids.length === 0 ? (
        <EmptyState title="No bids recorded" description="Bids will appear here as carriers respond to loads" />
      ) : (
        <div className="space-y-2">
          {bids.map((bid) => (
            <Card key={bid.id} className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-mono text-gray-500 truncate">{bid.id.slice(0, 12)}</p>
                  <Badge className={bidStatusColors[bid.status] ?? 'bg-gray-700 text-gray-300'}>
                    {bid.status}
                  </Badge>
                </div>
                <p className="text-sm text-gray-200 truncate">
                  Load: {bid.load_id.slice(0, 10)} • Org: {bid.carrier_org_id.slice(0, 10)}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {format(new Date(bid.created_at), 'MMM d, yyyy h:mm a')}
                </p>
              </div>
              <div className="text-right ml-3 flex-shrink-0">
                <p className="text-lg font-bold text-emerald-400">{formatUSD(bid.bid_amount_usd)}</p>
                {bid.notes && <p className="text-xs text-gray-500 max-w-[120px] truncate">{bid.notes}</p>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
