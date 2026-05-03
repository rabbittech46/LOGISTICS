'use client';

import { useSearchParams } from 'next/navigation';
import { LiveTripTrackingView } from '../../../components/live-trip-tracking-view';

export default function DriverTrackingPage() {
  const searchParams = useSearchParams();

  return (
    <LiveTripTrackingView
      theme="driver"
      defaultSelectedTripId={searchParams.get('assignmentId')}
      eyebrow="Driver Live Operations"
      title="My Live Route"
      description="Stay on the same tracking stack as dispatch with real-time truck telemetry, route ETAs, and pickup or drop geofence visibility powered by Leaflet, OpenStreetMap, and OSRM."
      emptyTitle="No live trips assigned"
      emptyDescription="Once you have an active dispatch and the truck starts streaming telemetry, your live route will appear here automatically."
      feedTitle="Dispatch Feed"
      feedDescription="Focus a trip to inspect its current route, signal health, and geofence progress."
      summaryValueLabel="Planned Miles"
      summaryValueMode="distance"
    />
  );
}