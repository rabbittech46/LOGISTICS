'use client';

import Link from 'next/link';
import { useAssignments } from '../../../hooks/queries';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';
import { formatUSD } from '../../../lib/utils';
import { format } from 'date-fns';

export default function DriverBookingsPage() {
  const { data, isLoading, error, refetch } = useAssignments();

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const assignments = data?.data ?? [];

  return (
    <div className="animate-in">
      <h1 className="text-xl font-bold text-white mb-4">My Bookings</h1>

      {assignments.length === 0 ? (
        <EmptyState
          title="No bookings yet"
          description="Reserve slots on the Load Board to get started"
          action={<Link href="/driver/loads" className="text-blue-400 hover:underline">Browse Loads</Link>}
        />
      ) : (
        <div className="space-y-3">
          {assignments.map((assignment) => (
            <Link key={assignment.id} href="/driver/trips">
              <Card className="hover:border-gray-600 transition-colors cursor-pointer">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-mono text-gray-500">Assignment {assignment.id.slice(0, 8)}</p>
                  <Badge className="bg-blue-500/20 text-blue-400">{assignment.status}</Badge>
                </div>

                <p className="font-medium text-white text-sm">Load {assignment.load_id.slice(0, 8)}</p>

                <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                  <span>{format(new Date(assignment.assigned_at), 'MMM d, h:mm a')}</span>
                  <span className="text-emerald-400 font-semibold">{formatUSD(assignment.agreed_rate_usd)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
