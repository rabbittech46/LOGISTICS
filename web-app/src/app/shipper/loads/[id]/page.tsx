'use client';

import { use, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useLoad,
  useLoadSlots,
  useLoadBids,
  usePostLoad,
  useCancelLoad,
  queryKeys,
} from '../../../../hooks/queries';
import { api, ApiRequestError } from '../../../../lib/api-client';
import { Card, StatCard } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../../components/ui/feedback';
import { SlotGrid } from '../../../../components/ui/slot-grid';
import {
  formatUSD,
  formatDistance,
  formatWeight,
  loadStatusColors,
  cargoTypeLabels,
} from '../../../../lib/utils';
import { useUIStore } from '../../../../stores/ui-store';
import { format } from 'date-fns';

const bidStatusColors: Record<string, string> = {
  PENDING: 'bg-amber-500/20 text-amber-300',
  ACCEPTED: 'bg-emerald-500/20 text-emerald-300',
  REJECTED: 'bg-red-500/20 text-red-300',
  COUNTERED: 'bg-violet-500/20 text-violet-300',
  WITHDRAWN: 'bg-gray-500/20 text-gray-300',
  EXPIRED: 'bg-gray-600/20 text-gray-400',
};

export default function LoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const { data: loadData, isLoading, error, refetch } = useLoad(id);
  const { data: slotData } = useLoadSlots(id);
  const { data: bidsData, refetch: refetchBids } = useLoadBids(id);
  const postLoad = usePostLoad();
  const cancelLoad = useCancelLoad();
  const addToast = useUIStore((s) => s.addToast);
  const [awardingBidId, setAwardingBidId] = useState<string | null>(null);

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const load = loadData?.data;
  if (!load) return <ErrorDisplay error={new Error('Load not found')} />;

  const slots = slotData?.data;
  const bids = [...(bidsData?.data ?? [])].sort((left, right) => left.bid_amount_usd - right.bid_amount_usd);
  const acceptedBid = bids.find((bid) => bid.status === 'ACCEPTED');

  const handlePost = async () => {
    try {
      await postLoad.mutateAsync(id);
      addToast({ type: 'success', title: 'Load posted to board' });
    } catch (err: unknown) {
      addToast({ type: 'error', title: 'Failed to post load', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

  const handleCancel = async () => {
    try {
      await cancelLoad.mutateAsync({ loadId: id, reason: 'Cancelled by shipper' });
      addToast({ type: 'info', title: 'Load cancelled' });
    } catch (err: unknown) {
      addToast({ type: 'error', title: 'Failed to cancel', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

  const handleAward = async (bidId: string) => {
    setAwardingBidId(bidId);
    try {
      await api.post(`/api/v1/loads/${id}/award`, { bidId });
      addToast({ type: 'success', title: 'Bid awarded', message: 'The carrier can now dispatch and start execution.' });
      await Promise.all([refetch(), refetchBids()]);
      queryClient.invalidateQueries({ queryKey: queryKeys.loads });
      queryClient.invalidateQueries({ queryKey: queryKeys.loadBoard });
      queryClient.invalidateQueries({ queryKey: queryKeys.assignments });
      queryClient.invalidateQueries({ queryKey: queryKeys.bids });
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.errorBody.error : err instanceof Error ? err.message : 'Unknown error';
      addToast({ type: 'error', title: 'Failed to award bid', message });
    } finally {
      setAwardingBidId(null);
    }
  };

  return (
    <div className="animate-in max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-xs text-gray-500 font-mono">{load.reference_number}</p>
          <h1 className="text-2xl font-bold text-white">
            {load.pickup_city}, {load.pickup_state} → {load.dropoff_city}, {load.dropoff_state}
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge className={loadStatusColors[load.status]}>{load.status}</Badge>
            <span className="text-sm text-gray-400">
              {cargoTypeLabels[load.cargo_type]} • {formatWeight(load.weight_lbs)}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {load.status === 'DRAFT' && (
            <Button data-testid="post-load-button" onClick={handlePost} loading={postLoad.isPending}>
              Post to Board
            </Button>
          )}
          {!['DELIVERED', 'CANCELLED'].includes(load.status) && (
            <Button data-testid="cancel-load-button" variant="danger" onClick={handleCancel} loading={cancelLoad.isPending}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
        <StatCard label="Rate" value={formatUSD(load.offered_rate_usd)} />
        <StatCard label="Distance" value={formatDistance(load.distance_miles)} />
        <StatCard label="Trucks Required" value={load.total_trucks_required} />
        <StatCard label="Booked" value={slots ? `${slots.bookedSlots}/${slots.totalSlots}` : '—'} />
        <StatCard label="Carrier Bids" value={bids.length} />
      </div>

      <Card className="mb-6 border-sky-500/20 bg-gradient-to-br from-sky-950/40 via-gray-900 to-gray-900">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-sky-300/70">Bid Review</p>
            <h2 className="text-xl font-semibold text-white mt-1">Award the right carrier before dispatch starts</h2>
            <p className="text-sm text-gray-400 mt-2 max-w-2xl">
              Review competing offers, lock the winning carrier, then hand execution to carrier dispatch and the assigned driver.
            </p>
          </div>
          {acceptedBid && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm">
              <p className="text-emerald-300 font-medium">Award locked</p>
              <p className="text-gray-300 mt-1">Winning rate {formatUSD(acceptedBid.bid_amount_usd)}</p>
            </div>
          )}
        </div>

        <div className="mt-5">
          {bids.length === 0 ? (
            <EmptyState
              title="No carrier bids yet"
              description="As carriers respond on the load board, their offers will appear here for award review."
            />
          ) : (
            <div className="space-y-3">
              {bids.map((bid) => {
                const isAwardable = bid.status === 'PENDING' && ['POSTED', 'BIDDING'].includes(load.status);
                return (
                  <div
                    key={bid.id}
                    className="rounded-2xl border border-gray-700/60 bg-gray-900/70 p-4 shadow-[0_12px_32px_rgba(0,0,0,0.22)]"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-lg font-semibold text-white">{formatUSD(bid.bid_amount_usd)}</p>
                          <Badge className={bidStatusColors[bid.status] ?? 'bg-gray-600/20 text-gray-300'}>
                            {bid.status}
                          </Badge>
                          {bids[0]?.id === bid.id && bid.status === 'PENDING' && (
                            <Badge className="bg-sky-500/15 text-sky-200">Best price</Badge>
                          )}
                        </div>
                        <div className="mt-2 grid gap-1 text-sm text-gray-400 sm:grid-cols-2">
                          <p>Truck: {bid.truck_id ? `${bid.truck_id.slice(0, 8)}...` : 'Will be assigned on award'}</p>
                          <p>Driver: {bid.driver_id ? `${bid.driver_id.slice(0, 8)}...` : 'Carrier dispatch to confirm'}</p>
                          <p>Submitted: {format(new Date(bid.created_at), 'MMM d, h:mm a')}</p>
                          <p>Rate / mile: {bid.rate_per_mile_usd ? `$${bid.rate_per_mile_usd.toFixed(2)}` : '—'}</p>
                        </div>
                        {bid.notes && <p className="mt-3 text-sm text-gray-300">{bid.notes}</p>}
                      </div>
                      <div className="sm:pl-4 sm:min-w-[12rem]">
                        <Button
                          className="w-full"
                          disabled={!isAwardable}
                          loading={awardingBidId === bid.id}
                          onClick={() => handleAward(bid.id)}
                        >
                          {bid.status === 'ACCEPTED' ? 'Awarded' : 'Award Carrier'}
                        </Button>
                        {!isAwardable && bid.status === 'PENDING' && load.status !== 'POSTED' && load.status !== 'BIDDING' && (
                          <p className="mt-2 text-xs text-gray-500">Awarding is closed once the load leaves bidding.</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {slots && load.total_trucks_required > 1 && (
        <Card className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-3">Truck Slots</h2>
          <SlotGrid
            totalSlots={slots.totalSlots}
            availableSlots={slots.availableSlots}
            reservedSlots={slots.reservedSlots}
            bookedSlots={slots.bookedSlots}
          />
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-700/50">
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-400">{slots.availableSlots}</p>
              <p className="text-xs text-gray-500">Available</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-400">{slots.reservedSlots}</p>
              <p className="text-xs text-gray-500">Reserved</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-400">{slots.bookedSlots}</p>
              <p className="text-xs text-gray-500">Booked</p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <h2 className="text-lg font-semibold text-white">Pickup</h2>
          </div>
          <div className="space-y-2 text-sm">
            <p className="text-gray-200">{load.pickup_address}</p>
            <p className="text-gray-400">{load.pickup_city}, {load.pickup_state} {load.pickup_zip}</p>
            <div className="pt-2 border-t border-gray-700/50">
              <p className="text-gray-400">
                <span className="text-gray-500">Window:</span>{' '}
                {format(new Date(load.pickup_earliest), 'MMM d, h:mm a')} – {format(new Date(load.pickup_latest), 'h:mm a')}
              </p>
              {load.pickup_contact_name && (
                <p className="text-gray-400 mt-1">
                  <span className="text-gray-500">Contact:</span> {load.pickup_contact_name}
                  {load.pickup_contact_phone && ` • ${load.pickup_contact_phone}`}
                </p>
              )}
              {load.pickup_instructions && (
                <p className="text-gray-400 mt-1">
                  <span className="text-gray-500">Notes:</span> {load.pickup_instructions}
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <h2 className="text-lg font-semibold text-white">Dropoff</h2>
          </div>
          <div className="space-y-2 text-sm">
            <p className="text-gray-200">{load.dropoff_address}</p>
            <p className="text-gray-400">{load.dropoff_city}, {load.dropoff_state} {load.dropoff_zip}</p>
            <div className="pt-2 border-t border-gray-700/50">
              <p className="text-gray-400">
                <span className="text-gray-500">Window:</span>{' '}
                {format(new Date(load.dropoff_earliest), 'MMM d, h:mm a')} – {format(new Date(load.dropoff_latest), 'h:mm a')}
              </p>
              {load.dropoff_contact_name && (
                <p className="text-gray-400 mt-1">
                  <span className="text-gray-500">Contact:</span> {load.dropoff_contact_name}
                  {load.dropoff_contact_phone && ` • ${load.dropoff_contact_phone}`}
                </p>
              )}
              {load.dropoff_instructions && (
                <p className="text-gray-400 mt-1">
                  <span className="text-gray-500">Notes:</span> {load.dropoff_instructions}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="text-lg font-semibold text-white mb-3">Details</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Commodity</p>
            <p className="text-gray-200">{load.commodity}</p>
          </div>
          <div>
            <p className="text-gray-500">Hazmat</p>
            <p className="text-gray-200">{load.is_hazmat ? `Yes (${load.hazmat_class})` : 'No'}</p>
          </div>
          <div>
            <p className="text-gray-500">Rate/Mile</p>
            <p className="text-gray-200">{load.rate_per_mile_usd ? `$${load.rate_per_mile_usd.toFixed(2)}` : '—'}</p>
          </div>
          <div>
            <p className="text-gray-500">Created</p>
            <p className="text-gray-200">{format(new Date(load.created_at), 'MMM d, yyyy')}</p>
          </div>
        </div>
        {load.special_requirements && load.special_requirements.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-700/50">
            <p className="text-gray-500 text-sm mb-2">Special Requirements</p>
            <div className="flex flex-wrap gap-2">
              {load.special_requirements.map((requirement: string, index: number) => (
                <Badge key={`${requirement}-${index}`}>{requirement}</Badge>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
