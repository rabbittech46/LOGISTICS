'use client';

import { useSearchParams } from 'next/navigation';
import { LiveTripTrackingView } from '../../../components/live-trip-tracking-view';

export default function LiveTrackingPage() {
  const searchParams = useSearchParams();

  return (
    <LiveTripTrackingView
      theme="shipper"
      defaultSelectedTripId={searchParams.get('assignmentId')}
      eyebrow="Open-Source Control Tower"
      title="Live Shipment Tracking"
      description="Real-time driver telemetry, live ETAs, and pickup or drop geofence awareness powered by OpenStreetMap, Leaflet, and OSRM, with each assigned truck rendered independently."
      emptyTitle="No active shipments"
      emptyDescription="Tracking becomes available automatically once an assigned truck starts streaming GPS telemetry for one of your active shipments."
      feedTitle="Fleet Feed"
      feedDescription="Tap an assignment to focus its live route, geofence state, and telemetry freshness."
      activeCountLabel="Tracked Assignments"
      selectedItemLabel="Selected Shipment"
      valueItemLabel="Load value"
      summaryValueLabel="Booked Value"
      summaryValueMode="revenue"
    />
  );
}
