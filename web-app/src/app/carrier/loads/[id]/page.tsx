'use client';

import { use, useState } from 'react';
import {
  useLoad,
  useLoadSlots,
  useLoadBids,
  useTrucks,
} from '../../../../hooks/queries';
import { api } from '../../../../lib/api-client';
import { Card } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Select } from '../../../../components/ui/select';
import { Input } from '../../../../components/ui/input';
import { PageLoader, ErrorDisplay } from '../../../../components/ui/feedback';
import { SlotGrid } from '../../../../components/ui/slot-grid';
import {
  formatUSD,
  formatDistance,
  formatWeight,
  loadStatusColors,
  cargoTypeLabels,
  generateIdempotencyKey,
} from '../../../../lib/utils';
import { useUIStore } from '../../../../stores/ui-store';
import { ApiRequestError } from '../../../../lib/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../../hooks/queries';
import { format } from 'date-fns';

export default function CarrierLoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: loadId } = use(params);
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const [bidAmount, setBidAmount] = useState('');
  const [bidNotes, setBidNotes] = useState('');
  const [selectedTruckId, setSelectedTruckId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: loadData, isLoading, error, refetch } = useLoad(loadId);
  const { data: slotData } = useLoadSlots(loadId);
  const { data: bidsData, refetch: refetchBids } = useLoadBids(loadId);
  const { data: trucksData } = useTrucks({ status: 'AVAILABLE' });

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const load = loadData?.data;
  if (!load) return <ErrorDisplay error={new Error('Load not found')} />;

  const slots = slotData?.data;
  const bids = bidsData?.data ?? [];
  const trucks = trucksData?.data ?? [];

  const truckOptions = trucks.map((t) => ({
    value: t.id,
    label: `${t.make} ${t.model} (${t.plate_number}) — ${cargoTypeLabels[t.cargo_type] ?? t.cargo_type}`,
  }));

  const handlePlaceBid = async () => {
    if (!bidAmount || !selectedTruckId) {
      addToast({ type: 'warning', title: 'Missing fields', message: 'Select a truck and enter a bid amount' });
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/v1/bids`, {
        loadId,
        truckId: selectedTruckId,
        bidAmountUsd: parseFloat(bidAmount),
        notes: bidNotes || undefined,
        idempotencyKey: generateIdempotencyKey(),
      });
      addToast({ type: 'success', title: 'Bid placed!', message: 'Your bid has been submitted' });
      setBidAmount('');
      setBidNotes('');
      setSelectedTruckId('');
      await refetchBids();
      queryClient.invalidateQueries({ queryKey: queryKeys.bids });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        addToast({ type: 'error', title: 'Bid failed', message: err.message });
      } else {
        addToast({ type: 'error', title: 'Network error', message: 'Please try again' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const bidStatusColors: Record<string, string> = {
    PENDING: 'bg-amber-500/20 text-amber-400',
    ACCEPTED: 'bg-emerald-500/20 text-emerald-400',
    REJECTED: 'bg-red-500/20 text-red-400',
    COUNTERED: 'bg-purple-500/20 text-purple-400',
    WITHDRAWN: 'bg-gray-500/20 text-gray-400',
    EXPIRED: 'bg-gray-500/20 text-gray-500',
  };

  return (
    <div className="animate-in max-w-2xl mx-auto">
      {/* Route header */}
      <div className="mb-5">
        <p className="text-xs text-gray-500 font-mono">{load.reference_number}</p>
        <h1 className="text-xl sm:text-2xl font-bold text-white mt-1">
          {load.pickup_city}, {load.pickup_state} → {load.dropoff_city}, {load.dropoff_state}
        </h1>
        <div className="flex items-center gap-2 mt-2">
          <Badge className={loadStatusColors[load.status]}>{load.status}</Badge>
          <Badge variant="info">{cargoTypeLabels[load.cargo_type]}</Badge>
          {load.is_hazmat && <Badge variant="danger">Hazmat</Badge>}
        </div>
      </div>

      {/* Rate banner */}
      <Card className="mb-4 bg-gradient-to-r from-emerald-900/20 to-blue-900/20 border-emerald-800/30">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-400">Offered Rate</p>
            <p className="text-3xl font-bold text-emerald-400">{formatUSD(load.offered_rate_usd)}</p>
          </div>
          <div className="text-right text-sm text-gray-400">
            <p>{formatDistance(load.distance_miles)}</p>
            <p>{formatWeight(load.weight_lbs)}</p>
          </div>
        </div>
      </Card>

      {/* Slot summary */}
      {slots && (
        <Card className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-white">Slot Availability</h2>
            <span className="text-sm text-gray-400">
              {slots.availableSlots}/{slots.totalSlots} open
            </span>
          </div>
          <SlotGrid
            totalSlots={slots.totalSlots}
            availableSlots={slots.availableSlots}
            reservedSlots={slots.reservedSlots}
            bookedSlots={slots.bookedSlots}
          />
        </Card>
      )}

      {/* Place Bid */}
      {(load.status === 'POSTED' || load.status === 'BIDDING') && (
        <Card className="mb-4">
          <h2 className="font-semibold text-white mb-4">Place a Bid</h2>
          <div className="space-y-3">
            <Select
              data-testid="carrier-truck-select"
              label="Truck"
              options={truckOptions}
              placeholder="Select a truck..."
              value={selectedTruckId}
              onChange={(e) => setSelectedTruckId(e.target.value)}
            />
            <Input
              data-testid="carrier-bid-amount"
              label="Bid Amount (USD)"
              type="number"
              placeholder={load.offered_rate_usd?.toString() ?? '0'}
              value={bidAmount}
              onChange={(e) => setBidAmount(e.target.value)}
            />
            <Input
              data-testid="carrier-bid-notes"
              label="Notes (optional)"
              placeholder="Equipment details, ETA..."
              value={bidNotes}
              onChange={(e) => setBidNotes(e.target.value)}
            />
            <Button
              data-testid="submit-bid-button"
              onClick={handlePlaceBid}
              loading={submitting}
              size="lg"
              className="w-full"
            >
              Submit Bid
            </Button>
          </div>
        </Card>
      )}

      {/* Existing bids from our org */}
      {bids.length > 0 && (
        <Card className="mb-4">
          <h2 className="font-semibold text-white mb-3">Your Bids</h2>
          <div className="space-y-2">
            {bids.map((bid) => (
              <div key={bid.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50">
                <div>
                  <p className="text-lg font-bold text-white">{formatUSD(bid.bid_amount_usd)}</p>
                  {bid.notes && <p className="text-xs text-gray-400">{bid.notes}</p>}
                  <p className="text-xs text-gray-500 mt-1">
                    {format(new Date(bid.created_at), 'MMM d, h:mm a')}
                  </p>
                </div>
                <Badge className={bidStatusColors[bid.status] ?? 'bg-gray-500/20 text-gray-400'}>
                  {bid.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Route details */}
      <div className="grid grid-cols-1 gap-3">
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <h3 className="font-medium text-white text-sm">Pickup</h3>
          </div>
          <p className="text-sm text-gray-200">{load.pickup_address}</p>
          <p className="text-xs text-gray-400">
            {load.pickup_city}, {load.pickup_state} {load.pickup_zip}
          </p>
          <p className="text-xs text-gray-500 mt-1.5">
            {format(new Date(load.pickup_earliest), 'MMM d, h:mm a')} – {format(new Date(load.pickup_latest), 'h:mm a')}
          </p>
          {load.pickup_instructions && (
            <p className="text-xs text-gray-400 mt-1 italic">{load.pickup_instructions}</p>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <h3 className="font-medium text-white text-sm">Dropoff</h3>
          </div>
          <p className="text-sm text-gray-200">{load.dropoff_address}</p>
          <p className="text-xs text-gray-400">
            {load.dropoff_city}, {load.dropoff_state} {load.dropoff_zip}
          </p>
          <p className="text-xs text-gray-500 mt-1.5">
            {format(new Date(load.dropoff_earliest), 'MMM d, h:mm a')} – {format(new Date(load.dropoff_latest), 'h:mm a')}
          </p>
          {load.dropoff_instructions && (
            <p className="text-xs text-gray-400 mt-1 italic">{load.dropoff_instructions}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
