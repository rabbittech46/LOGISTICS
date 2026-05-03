'use client';

import { useSearchParams } from 'next/navigation';
import { LiveTripTrackingView } from '../../../components/live-trip-tracking-view';

export default function CarrierTrackingPage() {
  const searchParams = useSearchParams();

  return (
    <LiveTripTrackingView
      theme="carrier"
      defaultSelectedTripId={searchParams.get('assignmentId')}
      eyebrow="Carrier Fleet Tracking"
      title="Live Fleet Control"
      description="Monitor every active assignment on one open-source map stack with live truck telemetry, route ETAs, and pickup or drop geofence state for dispatch." 
      emptyTitle="No live fleet movements"
      emptyDescription="Active assignments appear here automatically once dispatch is in motion and the assigned truck begins reporting location telemetry."
      feedTitle="Fleet Feed"
      feedDescription="Select an assignment to focus its route, telemetry freshness, and geofence status."
      summaryValueLabel="Booked Revenue"
      summaryValueMode="revenue"
    />
  );
}