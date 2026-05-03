'use client';

import { useAllBids } from '../../../hooks/queries';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';
import { Button } from '../../../components/ui/button';
import { formatUSD } from '../../../lib/utils';
import { format } from 'date-fns';

import Link from 'next/link';

const bidStatusColors: Record<string, string> = {
  PENDING: 'bg-amber-500/20 text-amber-400',
  ACCEPTED: 'bg-emerald-500/20 text-emerald-400',
  REJECTED: 'bg-red-500/20 text-red-400',
  COUNTERED: 'bg-purple-500/20 text-purple-400',
  WITHDRAWN: 'bg-gray-500/20 text-gray-400',
  EXPIRED: 'bg-gray-500/20 text-gray-500',
};

export default function CarrierBidsPage() {
  const { data, isLoading, error, refetch } = useAllBids();

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const bids = data?.data ?? [];
  const pending = bids.filter((b) => b.status === 'PENDING').length;
  const accepted = bids.filter((b) => b.status === 'ACCEPTED').length;
  const totalValue = bids.reduce((s, b) => s + b.bid_amount_usd, 0);

  return (
    <div className="animate-in">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">Bid Management</h1>
        <p className="text-sm text-gray-400 mt-1">Track all bids placed by your organization</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total Bids" value={bids.length} />
        <StatCard label="Pending" value={pending} />
        <StatCard label="Accepted" value={accepted} />
        <StatCard label="Total Value" value={formatUSD(totalValue)} />
      </div>

      {bids.length === 0 ? (
        <EmptyState
          title="No bids yet"
          description="Browse the load board to place your first bid"
          action={<Link href="/carrier/loads"><Button size="sm">Load Board</Button></Link>}
        />
      ) : (
        <div className="space-y-3">
          {bids.map((bid) => (
            <Card key={bid.id} hover>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-mono text-gray-500">Load: {bid.load_id.slice(0, 8)}...</p>
                    <Badge className={bidStatusColors[bid.status] ?? 'bg-gray-500/20 text-gray-400'}>
                      {bid.status}
                    </Badge>
                  </div>
                  <p className="text-lg font-bold text-white">{formatUSD(bid.bid_amount_usd)}</p>
                  {bid.rate_per_mile_usd && (
                    <p className="text-xs text-gray-400">${bid.rate_per_mile_usd.toFixed(2)}/mi</p>
                  )}
                  {bid.notes && (
                    <p className="text-xs text-gray-500 mt-1 italic">{bid.notes}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-500">
                    {format(new Date(bid.created_at), 'MMM d, h:mm a')}
                  </p>
                  {bid.counter_offer_usd && (
                    <div className="mt-1">
                      <p className="text-xs text-gray-400">Counter offer</p>
                      <p className="text-sm font-semibold text-purple-400">{formatUSD(bid.counter_offer_usd)}</p>
                    </div>
                  )}
                  {bid.expires_at && (
                    <p className="text-xs text-gray-500 mt-1">
                      Expires: {format(new Date(bid.expires_at), 'MMM d')}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
