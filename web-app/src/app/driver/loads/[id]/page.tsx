'use client';

import { use, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  useLoad,
  useLoadSlots,
  useMySlot,
  useReserveSlot,
  useConfirmBooking,
  useCancelReservation,
  useTrucks,
} from '../../../../hooks/queries';
import { Card } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Select } from '../../../../components/ui/select';
import { Input } from '../../../../components/ui/input';
import { PageLoader, ErrorDisplay } from '../../../../components/ui/feedback';
import { SlotGrid, ReservationTimer } from '../../../../components/ui/slot-grid';
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
import { format } from 'date-fns';

interface ConfirmBookingValues {
  agreedRateUsd?: number;
}

export default function DriverLoadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: loadId } = use(params);
  const addToast = useUIStore((state) => state.addToast);
  const [bookingStep, setBookingStep] = useState<'idle' | 'reserved' | 'confirming' | 'booked'>('idle');
  const [selectedTruckId, setSelectedTruckId] = useState('');
  const [truckError, setTruckError] = useState<string | undefined>();
  const reserveInFlightRef = useRef(false);

  const { data: loadData, isLoading, error, refetch } = useLoad(loadId);
  const { data: slotData } = useLoadSlots(loadId);
  const { data: mySlotData, refetch: refetchMySlot } = useMySlot(loadId);
  const { data: trucksData } = useTrucks({ status: 'AVAILABLE' });

  const reserveSlot = useReserveSlot();
  const confirmBooking = useConfirmBooking();
  const cancelReservation = useCancelReservation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ConfirmBookingValues>({
    defaultValues: {
      agreedRateUsd: undefined,
    },
  });

  const rawMySlot = mySlotData?.data;
  const snakeMySlot = rawMySlot as {
    id: string;
    load_id: string;
    slot_number: number;
    status: 'AVAILABLE' | 'RESERVED' | 'BOOKED';
    reservation_expires_at?: string;
  } | null;
  const mySlot = rawMySlot
    ? ('slotId' in rawMySlot
      ? rawMySlot
      : {
          slotId: snakeMySlot!.id,
          loadId: snakeMySlot!.load_id,
          slotNumber: snakeMySlot!.slot_number,
          status: snakeMySlot!.status,
          reservationExpiresAt: snakeMySlot!.reservation_expires_at,
        })
    : null;

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const load = loadData?.data;
  if (!load) return <ErrorDisplay error={new Error('Load not found')} />;

  const slots = slotData?.data;
  const trucks = trucksData?.data ?? [];

  const currentStep = mySlot
    ? mySlot.status === 'BOOKED'
      ? 'booked'
      : mySlot.status === 'RESERVED'
        ? 'reserved'
        : bookingStep
    : bookingStep;

  const handleReserve = async () => {
    if (reserveInFlightRef.current || bookingStep !== 'idle') {
      return;
    }

    reserveInFlightRef.current = true;
    const idempotencyKey = generateIdempotencyKey();
    try {
      await reserveSlot.mutateAsync({ loadId, idempotencyKey });
      setBookingStep('reserved');
      addToast({ type: 'success', title: 'Slot reserved!', message: 'You have 5 minutes to confirm' });
      await refetchMySlot();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.statusCode === 409) {
          addToast({ type: 'warning', title: 'No slots available', message: 'All trucks have been reserved or booked' });
        } else if (err.statusCode === 429) {
          addToast({ type: 'warning', title: 'Reservation limit reached', message: 'You have too many active reservations' });
        } else {
          addToast({ type: 'error', title: 'Reservation failed', message: err.message });
        }
      } else {
        addToast({ type: 'error', title: 'Network error', message: 'Please try again' });
      }
    } finally {
      reserveInFlightRef.current = false;
    }
  };

  const handleConfirm = async (data: ConfirmBookingValues) => {
    if (!mySlot?.slotId) {
      addToast({ type: 'error', title: 'Confirmation failed', message: 'Reserved slot not found. Try reserving again.' });
      return;
    }

    if (!selectedTruckId) {
      setTruckError('Select a truck');
      return;
    }

    const idempotencyKey = generateIdempotencyKey();
    try {
      await confirmBooking.mutateAsync({
        slotId: mySlot.slotId,
        truckId: selectedTruckId,
        agreedRateUsd: data.agreedRateUsd,
        loadId,
        idempotencyKey,
      });
      setBookingStep('booked');
      addToast({ type: 'success', title: 'Booking confirmed!', message: 'You are assigned to this load' });
      await refetchMySlot();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.statusCode === 410) {
          addToast({ type: 'error', title: 'Reservation expired', message: 'Your 5-minute window has passed. Try reserving again.' });
          setBookingStep('idle');
        } else {
          addToast({ type: 'error', title: 'Confirmation failed', message: err.message });
        }
      } else {
        addToast({ type: 'error', title: 'Network error', message: 'Please try again' });
      }
    }
  };

  const handleCancel = async () => {
    if (!mySlot) return;
    const idempotencyKey = generateIdempotencyKey();
    try {
      await cancelReservation.mutateAsync({ loadId, slotId: mySlot.slotId, idempotencyKey });
      setBookingStep('idle');
      addToast({ type: 'info', title: 'Reservation cancelled' });
      await refetchMySlot();
    } catch (err) {
      addToast({ type: 'error', title: 'Cancel failed', message: err instanceof Error ? err.message : 'Unknown error' });
    }
  };

  const truckOptions = trucks.map((truck) => ({
    value: truck.id,
    label: `${truck.make} ${truck.model} (${truck.plate_number}) — ${cargoTypeLabels[truck.cargo_type]}`,
  }));

  return (
    <div className="animate-in max-w-2xl mx-auto">
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

      {slots && (
        <Card className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-white">Available Slots</h2>
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

      <Card className="mb-4">
        <h2 className="font-semibold text-white mb-4">
          {currentStep === 'booked'
            ? '✓ Booking Confirmed'
            : currentStep === 'reserved'
              ? 'Complete Your Booking'
              : 'Book This Load'}
        </h2>

        {currentStep === 'idle' && (
          <div>
            {slots && slots.availableSlots === 0 ? (
              <div className="text-center py-4">
                <p className="text-gray-400">All slots are taken</p>
                <p className="text-xs text-gray-500 mt-1">
                  Check back — reservations may expire
                </p>
              </div>
            ) : (
              <Button
                data-testid="reserve-slot-button"
                onClick={handleReserve}
                loading={reserveSlot.isPending}
                size="lg"
                className="w-full"
              >
                Reserve a Slot
              </Button>
            )}
          </div>
        )}

        {currentStep === 'reserved' && mySlot && (
          <div>
            <div className="flex items-center justify-between mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div>
                <p className="text-sm font-medium text-amber-400">Slot #{mySlot.slotNumber} reserved</p>
                <p className="text-xs text-gray-400">Expires in:</p>
              </div>
              {mySlot.reservationExpiresAt && (
                <ReservationTimer
                  expiresAt={mySlot.reservationExpiresAt}
                  onExpire={() => {
                    setBookingStep('idle');
                    addToast({ type: 'warning', title: 'Reservation expired', message: 'Your 5-minute window has passed. Reserve again to continue.' });
                    refetchMySlot();
                  }}
                />
              )}
            </div>

            <form onSubmit={handleSubmit(handleConfirm as never)} className="space-y-4">
              <Select
                data-testid="driver-truck-select"
                label="Select Truck"
                options={truckOptions}
                placeholder="Choose a truck..."
                value={selectedTruckId}
                onChange={(event) => {
                  setSelectedTruckId(event.target.value);
                  setTruckError(undefined);
                }}
                error={truckError}
              />

              <Input
                data-testid="driver-agreed-rate"
                label="Agreed Rate (USD)"
                type="number"
                placeholder={load.offered_rate_usd?.toString() ?? ''}
                error={errors.agreedRateUsd?.message}
                {...register('agreedRateUsd', {
                  setValueAs: (value) => (value === '' ? undefined : Number(value)),
                  validate: (value) => value === undefined || (Number.isFinite(value) && value > 0 && value <= 500000) || 'Enter a valid rate',
                })}
              />

              <div className="flex gap-3">
                <Button
                  data-testid="release-slot-button"
                  type="button"
                  variant="secondary"
                  onClick={handleCancel}
                  loading={cancelReservation.isPending}
                  className="flex-1"
                >
                  Release Slot
                </Button>
                <Button
                  data-testid="confirm-booking-button"
                  type="submit"
                  loading={confirmBooking.isPending}
                  size="lg"
                  className="flex-1"
                >
                  Confirm Booking
                </Button>
              </div>
            </form>
          </div>
        )}

        {currentStep === 'booked' && (
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
              <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-emerald-400">You&apos;re booked!</p>
            <p className="text-sm text-gray-400 mt-1">
              Slot #{mySlot?.slotNumber} is confirmed for this load
            </p>
          </div>
        )}
      </Card>

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
