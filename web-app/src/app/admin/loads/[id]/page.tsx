'use client';

import { use } from 'react';
import { useLoad, useLoadSlots, useCancelLoad } from '../../../../hooks/queries';
import { Card } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { PageLoader, ErrorDisplay } from '../../../../components/ui/feedback';
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

export default function AdminLoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: loadId } = use(params);
  const addToast = useUIStore((s) => s.addToast);
  const { data, isLoading, error, refetch } = useLoad(loadId);
  const { data: slotData } = useLoadSlots(loadId);
  const cancelLoad = useCancelLoad();

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const load = data?.data;
  if (!load) return <ErrorDisplay error={new Error('Load not found')} />;

  const slots = slotData?.data;

  const handleCancel = async () => {
    try {
      await cancelLoad.mutateAsync({ loadId, reason: 'Cancelled by admin' });
      addToast({ type: 'success', title: 'Load cancelled' });
    } catch {
      addToast({ type: 'error', title: 'Failed to cancel load' });
    }
  };

  return (
    <div className="animate-in max-w-3xl mx-auto">
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500 font-mono">{load.reference_number}</p>
          {!['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(load.status) && (
            <Button data-testid="admin-cancel-load-button" variant="danger" size="sm" onClick={handleCancel} loading={cancelLoad.isPending}>
              Cancel Load
            </Button>
          )}
        </div>
        <h1 className="text-xl font-bold text-white mt-1">
          {load.pickup_city}, {load.pickup_state} → {load.dropoff_city}, {load.dropoff_state}
        </h1>
        <div className="flex items-center gap-2 mt-2">
          <Badge className={loadStatusColors[load.status]}>{load.status}</Badge>
          <Badge variant="info">{cargoTypeLabels[load.cargo_type]}</Badge>
          {load.is_hazmat && <Badge variant="danger">Hazmat</Badge>}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card>
          <p className="text-xs text-gray-400">Rate</p>
          <p className="text-lg font-bold text-emerald-400">{formatUSD(load.offered_rate_usd)}</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-400">Distance</p>
          <p className="text-lg font-bold text-white">{formatDistance(load.distance_miles)}</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-400">Weight</p>
          <p className="text-lg font-bold text-white">{formatWeight(load.weight_lbs)}</p>
        </Card>
      </div>

      {/* Slots */}
      {slots && (
        <Card className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-white">Slot Allocation</h2>
            <span className="text-sm text-gray-400">
              {slots.bookedSlots}/{slots.totalSlots} booked &bull; {slots.reservedSlots} reserved &bull;{' '}
              {slots.availableSlots} open
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

      {/* Details grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <h3 className="font-medium text-white text-sm">Pickup</h3>
          </div>
          <p className="text-sm text-gray-200">{load.pickup_address}</p>
          <p className="text-xs text-gray-400">
            {load.pickup_city}, {load.pickup_state} {load.pickup_zip}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {format(new Date(load.pickup_earliest), 'MMM d, h:mm a')} –{' '}
            {format(new Date(load.pickup_latest), 'h:mm a')}
          </p>
          {load.pickup_contact_name && (
            <p className="text-xs text-gray-400 mt-1">
              Contact: {load.pickup_contact_name} {load.pickup_contact_phone}
            </p>
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
          <p className="text-xs text-gray-500 mt-1">
            {format(new Date(load.dropoff_earliest), 'MMM d, h:mm a')} –{' '}
            {format(new Date(load.dropoff_latest), 'h:mm a')}
          </p>
          {load.dropoff_contact_name && (
            <p className="text-xs text-gray-400 mt-1">
              Contact: {load.dropoff_contact_name} {load.dropoff_contact_phone}
            </p>
          )}
        </Card>
      </div>

      {/* Additional info */}
      <Card>
        <h3 className="font-medium text-white text-sm mb-2">Additional Details</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <dt className="text-gray-400">Commodity</dt>
          <dd className="text-gray-200">{load.commodity ?? '—'}</dd>
          <dt className="text-gray-400">Trucks Required</dt>
          <dd className="text-gray-200">{load.total_trucks_required}</dd>
          <dt className="text-gray-400">Equipment</dt>
          <dd className="text-gray-200">{load.cargo_type}</dd>
          <dt className="text-gray-400">Created</dt>
          <dd className="text-gray-200">{format(new Date(load.created_at), 'MMM d, yyyy h:mm a')}</dd>
          {load.special_requirements && load.special_requirements.length > 0 && (
            <>
              <dt className="text-gray-400">Special Requirements</dt>
              <dd className="text-gray-200">{load.special_requirements.join(', ')}</dd>
            </>
          )}
        </dl>
      </Card>
    </div>
  );
}
