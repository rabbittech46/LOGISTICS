'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { useAssignmentTracking, useLoads } from '../hooks/queries';
import { Card, StatCard } from './ui/card';
import { Badge } from './ui/badge';
import { PageLoader, EmptyState, ErrorDisplay } from './ui/feedback';
import { TrackingMap, type TrackingMapTrip } from './tracking-map';
import {
  getSocket,
  onTruckPosition,
  onTruckSignalStatus,
  subscribeTruck,
  unsubscribeTruck,
} from '../lib/ws-client';
import type {
  AssignmentTracking,
  Load,
  TruckSignalStatus,
  TruckTrackingPosition,
} from '../lib/types';
import {
  fetchOsrmRoute,
  geoPointToLatLng,
  haversineMiles,
  isWithinRadiusMiles,
  type Coordinate,
} from '../lib/tracking';
import { cargoTypeLabels, formatDistance, formatUSD, getAssignmentStage } from '../lib/utils';

type SignalState = TruckSignalStatus['status'];

interface TrackedTrip {
  tripId: string;
  load: Load;
  assignment: AssignmentTracking;
  position: TruckTrackingPosition | null;
  signalStatus: SignalState;
  pickupDistanceMiles: number | null;
  dropoffDistanceMiles: number | null;
  stage: string;
}

interface LiveTripTrackingViewProps {
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  feedTitle: string;
  feedDescription: string;
  activeCountLabel?: string;
  selectedItemLabel?: string;
  valueItemLabel?: string;
  summaryValueLabel: string;
  summaryValueMode: 'distance' | 'revenue';
  theme: 'carrier' | 'driver' | 'shipper';
  defaultSelectedTripId?: string | null;
}

const TRACKING_GEOFENCE_MILES = 0.35;

const themeClasses = {
  carrier: {
    header:
      'bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(251,191,36,0.16),_transparent_32%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(15,23,42,0.82))]',
    eyebrow: 'text-sky-300/70',
    selected:
      'border-sky-500/40 bg-sky-500/10 shadow-[0_16px_40px_rgba(14,165,233,0.12)]',
  },
  driver: {
    header:
      'bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(249,115,22,0.16),_transparent_32%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(15,23,42,0.82))]',
    eyebrow: 'text-emerald-300/70',
    selected:
      'border-emerald-500/40 bg-emerald-500/10 shadow-[0_16px_40px_rgba(16,185,129,0.12)]',
  },
  shipper: {
    header:
      'bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_36%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.18),_transparent_32%),linear-gradient(180deg,_rgba(15,23,42,0.98),_rgba(15,23,42,0.82))]',
    eyebrow: 'text-emerald-300/70',
    selected:
      'border-emerald-500/40 bg-emerald-500/10 shadow-[0_16px_40px_rgba(16,185,129,0.12)]',
  },
} as const;

function getSignalBadge(status: SignalState) {
  switch (status) {
    case 'ONLINE':
    case 'RECONNECTED':
      return { variant: 'success' as const, label: status === 'ONLINE' ? 'Live' : 'Reconnected' };
    case 'DEGRADED_SIGNAL':
    case 'RECONNECTING':
      return { variant: 'warning' as const, label: status === 'RECONNECTING' ? 'Reconnecting' : 'Weak signal' };
    case 'CRITICAL':
      return { variant: 'danger' as const, label: 'Critical' };
    default:
      return { variant: 'danger' as const, label: 'Offline' };
  }
}

function formatEta(seconds?: number | null) {
  if (!seconds || seconds <= 0) return '—';

  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${totalMinutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

export function LiveTripTrackingView({
  eyebrow,
  title,
  description,
  emptyTitle,
  emptyDescription,
  feedTitle,
  feedDescription,
  activeCountLabel = 'Active Trips',
  selectedItemLabel = 'Selected Trip',
  valueItemLabel = 'Trip value',
  summaryValueLabel,
  summaryValueMode,
  theme,
  defaultSelectedTripId,
}: LiveTripTrackingViewProps) {
  const loads = useLoads();
  const tracking = useAssignmentTracking({ status: 'ACTIVE' });
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [livePositions, setLivePositions] = useState<Record<string, TruckTrackingPosition>>({});
  const [signalStates, setSignalStates] = useState<Record<string, SignalState>>({});

  const loadRows = loads.data?.data ?? [];
  const trackingRows = tracking.data?.data ?? [];
  const truckIds = [...new Set(trackingRows.map((assignment) => assignment.truck_id))];
  const truckIdsKey = truckIds.join('|');
  const loadsById = new Map(loadRows.map((load) => [load.id, load]));
  const palette = themeClasses[theme];

  useEffect(() => {
    const stopPositionFeed = onTruckPosition((position) => {
      setLivePositions((prev) => ({
        ...prev,
        [position.truckId]: {
          ...prev[position.truckId],
          ...position,
          signal_status: 'ONLINE',
          last_seen_age_ms: 0,
          source: 'redis',
        },
      }));
      setSignalStates((prev) => ({ ...prev, [position.truckId]: 'ONLINE' }));
    });

    const stopSignalFeed = onTruckSignalStatus((signal) => {
      setSignalStates((prev) => ({ ...prev, [signal.truckId]: signal.status }));
      setLivePositions((prev) => {
        if (!prev[signal.truckId]) {
          return prev;
        }

        return {
          ...prev,
          [signal.truckId]: {
            ...prev[signal.truckId],
            signal_status: signal.status,
          },
        };
      });
    });

    getSocket();

    return () => {
      stopPositionFeed();
      stopSignalFeed();
    };
  }, []);

  useEffect(() => {
    const activeTruckIds = truckIdsKey ? truckIdsKey.split('|') : [];
    if (activeTruckIds.length === 0) {
      return;
    }

    getSocket();
    activeTruckIds.forEach(subscribeTruck);

    return () => {
      activeTruckIds.forEach(unsubscribeTruck);
    };
  }, [truckIdsKey]);

  const trips: TrackedTrip[] = trackingRows.flatMap((assignment) => {
    const load = loadsById.get(assignment.load_id);
    if (!load) {
      return [];
    }

    const position = livePositions[assignment.truck_id] ?? assignment.position;
    const pickup = geoPointToLatLng(load.pickup_location);
    const dropoff = geoPointToLatLng(load.dropoff_location);

    return [{
      tripId: assignment.id,
      load,
      assignment,
      position,
      signalStatus: signalStates[assignment.truck_id] ?? position?.signal_status ?? 'OFFLINE',
      pickupDistanceMiles: position ? haversineMiles(position, pickup) : null,
      dropoffDistanceMiles: position ? haversineMiles(position, dropoff) : null,
      stage: getAssignmentStage(assignment),
    }];
  });

  const effectiveSelectedTripId = selectedTripId && trips.some((trip) => trip.tripId === selectedTripId)
    ? selectedTripId
    : defaultSelectedTripId && trips.some((trip) => trip.tripId === defaultSelectedTripId)
      ? defaultSelectedTripId
      : trips[0]?.tripId ?? null;

  const selectedTrip = trips.find((trip) => trip.tripId === effectiveSelectedTripId) ?? trips[0] ?? null;
  const hasReachedPickup = selectedTrip
    ? Boolean(selectedTrip.assignment.picked_up_at)
      || (selectedTrip.pickupDistanceMiles != null && selectedTrip.pickupDistanceMiles <= TRACKING_GEOFENCE_MILES)
    : false;

  const routePoints: Coordinate[] = selectedTrip?.position
    ? hasReachedPickup
      ? [selectedTrip.position, geoPointToLatLng(selectedTrip.load.dropoff_location)]
      : [
          selectedTrip.position,
          geoPointToLatLng(selectedTrip.load.pickup_location),
          geoPointToLatLng(selectedTrip.load.dropoff_location),
        ]
    : [];

  const routePlan = useQuery({
    queryKey: ['tracking-route', selectedTrip?.assignment.id, routePoints.map((point) => `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`).join('|')],
    queryFn: () => fetchOsrmRoute(routePoints),
    enabled: routePoints.length >= 2,
    staleTime: 120000,
  });

  const liveCount = trips.filter((trip) => trip.signalStatus === 'ONLINE').length;
  const flaggedCount = trips.filter((trip) => trip.signalStatus === 'OFFLINE' || trip.signalStatus === 'CRITICAL').length;
  const summaryValue = summaryValueMode === 'revenue'
    ? formatUSD(trips.reduce((sum, trip) => sum + (trip.assignment.agreed_rate_usd ?? trip.load.offered_rate_usd ?? 0), 0))
    : formatDistance(trips.reduce((sum, trip) => sum + (trip.load.distance_miles ?? 0), 0));

  const mapTrips: TrackingMapTrip[] = trips.map((trip) => ({
    loadId: trip.tripId,
    referenceNumber: trip.load.reference_number,
    pickup: geoPointToLatLng(trip.load.pickup_location),
    dropoff: geoPointToLatLng(trip.load.dropoff_location),
    position: trip.position
      ? {
          lat: trip.position.lat,
          lng: trip.position.lng,
          heading_deg: trip.position.heading_deg,
        }
      : null,
    signalStatus: trip.signalStatus,
  }));

  if (loads.isLoading || tracking.isLoading) return <PageLoader />;
  if (loads.error) return <ErrorDisplay error={loads.error} onRetry={loads.refetch} />;
  if (tracking.error) return <ErrorDisplay error={tracking.error as Error} onRetry={tracking.refetch} />;

  return (
    <div className="animate-in space-y-6">
      <div className={`rounded-3xl border border-slate-800/80 p-6 shadow-[0_30px_90px_rgba(2,6,23,0.45)] ${palette.header}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className={`text-xs font-medium uppercase tracking-[0.24em] ${palette.eyebrow}`}>{eyebrow}</p>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">{title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">{description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="success" pulse>{liveCount} live</Badge>
            <Badge variant={flaggedCount > 0 ? 'danger' : 'info'}>{flaggedCount} flagged</Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={activeCountLabel} value={trips.length} />
        <StatCard label="Connected Trucks" value={liveCount} />
        <StatCard label="At Risk Signals" value={flaggedCount} />
        <StatCard label={summaryValueLabel} value={summaryValue} />
      </div>

      {trips.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <Card padding="none" className="overflow-hidden border-slate-800/70">
            <div className="flex flex-col gap-4 border-b border-slate-800/80 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-mono text-slate-500">{selectedTrip?.load.reference_number}</p>
                <h2 className="text-lg font-semibold text-white">
                  {selectedTrip?.load.pickup_city}, {selectedTrip?.load.pickup_state} → {selectedTrip?.load.dropoff_city}, {selectedTrip?.load.dropoff_state}
                </h2>
              </div>
              {selectedTrip && (
                <div className="flex flex-wrap gap-2">
                  <Badge variant={getSignalBadge(selectedTrip.signalStatus).variant} pulse={selectedTrip.signalStatus === 'ONLINE'}>
                    {getSignalBadge(selectedTrip.signalStatus).label}
                  </Badge>
                  <Badge variant="info">{selectedTrip.stage.replace(/_/g, ' ')}</Badge>
                  <Badge variant="warning">{cargoTypeLabels[selectedTrip.load.cargo_type]}</Badge>
                </div>
              )}
            </div>

            <TrackingMap
              shipments={mapTrips}
              selectedLoadId={effectiveSelectedTripId}
              onSelectLoadId={setSelectedTripId}
              route={routePlan.data ?? null}
            />
          </Card>

          <div className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
            <Card className="space-y-4 border-slate-800/70 bg-slate-900/70">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-300">{selectedItemLabel}</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{selectedTrip?.load.reference_number}</p>
                </div>
                {selectedTrip && (
                  <Badge variant={getSignalBadge(selectedTrip.signalStatus).variant}>
                    {getSignalBadge(selectedTrip.signalStatus).label}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="tracking-map-panel rounded-2xl p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">ETA</p>
                  <p className="mt-2 text-xl font-semibold text-white">{formatEta(routePlan.data?.durationSeconds)}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatDistance(routePlan.data?.distanceMiles ?? selectedTrip?.load.distance_miles ?? null)} remaining route</p>
                </div>
                <div className="tracking-map-panel rounded-2xl p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Telemetry</p>
                  <p className="mt-2 text-xl font-semibold text-white">
                    {selectedTrip?.position?.speed_kmh != null ? `${Math.round(selectedTrip.position.speed_kmh * 0.621371)} mph` : 'No speed'}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {selectedTrip?.position?.recorded_at
                      ? `Updated ${formatDistanceToNowStrict(new Date(selectedTrip.position.recorded_at), { addSuffix: true })}`
                      : 'Awaiting location ping'}
                  </p>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Truck</span>
                  <span className="font-medium text-white">{selectedTrip?.assignment.truck_id.slice(0, 8) ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Pickup geofence</span>
                  <span className="font-medium text-white">
                    {selectedTrip?.pickupDistanceMiles == null
                      ? 'No GPS yet'
                      : isWithinRadiusMiles(selectedTrip.pickupDistanceMiles, TRACKING_GEOFENCE_MILES)
                        ? 'Inside zone'
                        : `${selectedTrip.pickupDistanceMiles.toFixed(1)} mi away`}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Drop geofence</span>
                  <span className="font-medium text-white">
                    {selectedTrip?.dropoffDistanceMiles == null
                      ? 'No GPS yet'
                      : isWithinRadiusMiles(selectedTrip.dropoffDistanceMiles, TRACKING_GEOFENCE_MILES)
                        ? 'Inside zone'
                        : `${selectedTrip.dropoffDistanceMiles.toFixed(1)} mi away`}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">{valueItemLabel}</span>
                  <span className="font-medium text-emerald-400">{formatUSD(selectedTrip?.assignment.agreed_rate_usd ?? selectedTrip?.load.offered_rate_usd ?? null)}</span>
                </div>
              </div>
            </Card>

            <Card className="space-y-3 border-slate-800/70 bg-slate-900/70">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-300">{feedTitle}</p>
                  <p className="text-xs text-slate-500">{feedDescription}</p>
                </div>
                <Badge variant="info">{trips.length} active</Badge>
              </div>

              <div className="space-y-3">
                {trips.map((trip) => {
                  const signal = getSignalBadge(trip.signalStatus);
                  const isSelected = trip.tripId === selectedTrip?.tripId;

                  return (
                    <button
                      key={trip.tripId}
                      type="button"
                      onClick={() => setSelectedTripId(trip.tripId)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        isSelected
                          ? palette.selected
                          : 'border-slate-800/80 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900/80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-mono text-slate-500">{trip.load.reference_number}</p>
                          <p className="mt-1 text-sm font-medium text-white">
                            {trip.load.pickup_city}, {trip.load.pickup_state} → {trip.load.dropoff_city}, {trip.load.dropoff_state}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {trip.position
                              ? `${trip.position.lat.toFixed(4)}, ${trip.position.lng.toFixed(4)}`
                              : 'Awaiting initial GPS position'}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Badge variant={signal.variant} pulse={trip.signalStatus === 'ONLINE'}>{signal.label}</Badge>
                          <Badge variant="info">{trip.stage.replace(/_/g, ' ')}</Badge>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                        <span>Truck {trip.assignment.truck_id.slice(0, 8)}</span>
                        <span>
                          {trip.position?.recorded_at
                            ? formatDistanceToNowStrict(new Date(trip.position.recorded_at), { addSuffix: true })
                            : 'No telemetry'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}