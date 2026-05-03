'use client';

import { useTrucks, useDrivers, useAllBids, useAssignments } from '../../../hooks/queries';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { PageLoader } from '../../../components/ui/feedback';
import { getAssignmentStage } from '../../../lib/utils';
import Link from 'next/link';

export default function CarrierDashboardPage() {
  const trucks = useTrucks();
  const drivers = useDrivers();
  const bids = useAllBids();
  const assignments = useAssignments();

  if (trucks.isLoading || drivers.isLoading) return <PageLoader />;

  const truckList = trucks.data?.data ?? [];
  const driverList = drivers.data?.data ?? [];
  const bidList = bids.data?.data ?? [];
  const assignmentList = assignments.data?.data ?? [];

  const availableTrucks = truckList.filter((t) => t.status === 'AVAILABLE');
  const activeTrips = assignmentList.filter((a) =>
    !['COMPLETED', 'CANCELLED'].includes(a.status)
  );
  const pendingBids = bidList.filter((b) => b.status === 'PENDING');

  return (
    <div className="animate-in">
      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/70">Carrier command center</p>
            <h1 className="mt-2 text-3xl font-black text-white">Fleet operations overview</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-300">See truck availability, active trips, and bidding pressure in one mobile-first operational surface.</p>
          </div>
          <Link
            href="/carrier/loads"
            className="inline-flex h-12 items-center justify-center rounded-[20px] bg-gradient-to-r from-sky-400 to-blue-600 px-5 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(31,134,255,0.3)]"
          >
            Open load board
          </Link>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total Trucks" value={truckList.length} />
        <StatCard label="Available" value={availableTrucks.length} />
        <StatCard label="Drivers" value={driverList.length} />
        <StatCard label="Active Trips" value={activeTrips.length} />
        <StatCard label="Pending Bids" value={pendingBids.length} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Fleet Overview */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Fleet</h2>
            <Link href="/carrier/fleet" className="text-xs text-blue-400 hover:text-blue-300">
              Manage &rarr;
            </Link>
          </div>
          <div className="space-y-2">
            {truckList.slice(0, 5).map((truck) => (
              <div
                key={truck.id}
                className="flex items-center justify-between rounded-[22px] border border-white/8 bg-white/4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    {truck.plate_number}
                  </p>
                  <p className="text-xs text-slate-400">
                    {truck.make} {truck.model} &bull; {truck.cargo_type?.replace('_', ' ')}
                  </p>
                </div>
                <Badge
                  variant={
                    truck.status === 'AVAILABLE' ? 'success' :
                    truck.status === 'BUSY' ? 'info' :
                    truck.status === 'MAINTENANCE' ? 'warning' : 'default'
                  }
                >
                  {truck.status?.replace('_', ' ') ?? 'N/A'}
                </Badge>
              </div>
            ))}
            {truckList.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">
                No trucks registered.{' '}
                <Link href="/carrier/fleet" className="text-sky-300 hover:underline">Add one</Link>
              </p>
            )}
          </div>
        </Card>

        {/* Active Trips */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Active Trips</h2>
            <Link href="/carrier/trips" className="text-xs text-blue-400 hover:text-blue-300">
              View all &rarr;
            </Link>
          </div>
          <div className="space-y-2">
            {activeTrips.slice(0, 5).map((trip) => (
              <div
                key={trip.id}
                className="flex items-center justify-between rounded-[22px] border border-white/8 bg-white/4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {trip.load_id?.slice(0, 8)}
                  </p>
                  <p className="text-xs text-slate-400">{getAssignmentStage(trip).replace(/_/g, ' ')}</p>
                </div>
                <Badge variant="info" pulse>Active</Badge>
              </div>
            ))}
            {activeTrips.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">No active trips</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
