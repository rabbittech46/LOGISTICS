'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAssignments } from '../../../hooks/queries';
import { api, ApiRequestError } from '../../../lib/api-client';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';
import { Button } from '../../../components/ui/button';
import { formatUSD, getAssignmentStage } from '../../../lib/utils';
import { useUIStore } from '../../../stores/ui-store';
import { format } from 'date-fns';

const milestoneSteps = [
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'DISPATCHED', label: 'Dispatched' },
  { key: 'AT_PICKUP', label: 'At Pickup' },
  { key: 'PICKED_UP', label: 'Picked Up' },
  { key: 'AT_DROPOFF', label: 'At Dropoff' },
  { key: 'DELIVERED', label: 'Delivered' },
];

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-blue-500/20 text-blue-400',
  COMPLETED: 'bg-emerald-500/20 text-emerald-400',
  CANCELLED: 'bg-red-500/20 text-red-400',
  DISPUTED: 'bg-orange-500/20 text-orange-400',
};

function MilestoneProgress({ currentMilestone }: { currentMilestone?: string }) {
  const currentIdx = milestoneSteps.findIndex((s) => s.key === currentMilestone);
  return (
    <div className="flex items-center gap-1 mt-2">
      {milestoneSteps.map((step, i) => {
        const isCompleted = i < currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <div key={step.key} className="flex items-center gap-1">
            <div
              className={`w-2 h-2 rounded-full ${
                isCompleted
                  ? 'bg-emerald-500'
                  : isCurrent
                    ? 'bg-blue-500 ring-2 ring-blue-500/30'
                    : 'bg-gray-700'
              }`}
              title={step.label}
            />
            {i < milestoneSteps.length - 1 && (
              <div className={`w-4 h-0.5 ${isCompleted ? 'bg-emerald-500' : 'bg-gray-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function CarrierTripsPage() {
  const { data, isLoading, error, refetch } = useAssignments();
  const addToast = useUIStore((state) => state.addToast);
  const [dispatchingAssignmentId, setDispatchingAssignmentId] = useState<string | null>(null);

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const assignments = data?.data ?? [];
  const active = assignments.filter((a) => a.status === 'ACTIVE').length;
  const completed = assignments.filter((a) => a.status === 'COMPLETED').length;
  const totalRevenue = assignments.reduce((s, a) => s + a.agreed_rate_usd, 0);

  const handleDispatch = async (assignmentId: string, loadId: string) => {
    setDispatchingAssignmentId(assignmentId);
    try {
      await api.post(`/api/v1/loads/${loadId}/dispatch`, { assignmentId });
      addToast({ type: 'success', title: 'Load dispatched', message: 'Driver milestones and POD are now unlocked.' });
      await refetch();
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.errorBody.error : err instanceof Error ? err.message : 'Unknown error';
      addToast({ type: 'error', title: 'Failed to dispatch trip', message });
    } finally {
      setDispatchingAssignmentId(null);
    }
  };

  return (
    <div className="animate-in">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">Trips</h1>
        <p className="text-sm text-gray-400 mt-1">Active and completed assignments</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total Trips" value={assignments.length} />
        <StatCard label="Active" value={active} />
        <StatCard label="Completed" value={completed} />
        <StatCard label="Revenue" value={formatUSD(totalRevenue)} />
      </div>

      {assignments.length === 0 ? (
        <EmptyState
          title="No trips yet"
          description="Trips appear here once your bids are accepted and loads assigned"
        />
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const currentMilestone = getAssignmentStage(a);

            return (
              <Card key={a.id} hover>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-mono text-gray-500">
                      Load: {a.load_id.slice(0, 8)}...
                    </p>
                    <Badge className={statusColors[a.status] ?? 'bg-gray-500/20 text-gray-400'}>
                      {a.status}
                    </Badge>
                  </div>
                  <p className="text-lg font-bold text-emerald-400">{formatUSD(a.agreed_rate_usd)}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs text-gray-400">
                  <div>
                    <p>Assigned: {format(new Date(a.assigned_at), 'MMM d, h:mm a')}</p>
                    {a.dispatched_at && <p>Dispatched: {format(new Date(a.dispatched_at), 'MMM d, h:mm a')}</p>}
                  </div>
                  <div>
                    {a.picked_up_at && <p>Picked up: {format(new Date(a.picked_up_at), 'MMM d, h:mm a')}</p>}
                    {a.delivered_at && <p>Delivered: {format(new Date(a.delivered_at), 'MMM d, h:mm a')}</p>}
                  </div>
                </div>

                {a.status === 'ACTIVE' && (
                  <MilestoneProgress currentMilestone={currentMilestone} />
                )}

                {a.status === 'ACTIVE' && (
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-gray-500">
                      {a.dispatched_at
                        ? 'Trip is in execution. Follow live tracking or wait for driver milestones.'
                        : 'Dispatch is carrier-owned. Dispatching unlocks pickup, in-transit, and POD updates.'}
                    </div>
                    <div className="flex gap-2 justify-end">
                      {!a.dispatched_at && (
                        <Button
                          loading={dispatchingAssignmentId === a.id}
                          onClick={() => handleDispatch(a.id, a.load_id)}
                        >
                          Dispatch Trip
                        </Button>
                      )}
                      <Link
                        href={`/carrier/tracking?assignmentId=${a.id}`}
                        className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-200 transition hover:border-sky-400/50 hover:bg-sky-500/15"
                      >
                        Open live tracking
                      </Link>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
