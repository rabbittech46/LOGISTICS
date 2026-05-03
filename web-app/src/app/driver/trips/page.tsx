'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { useAssignments } from '../../../hooks/queries';
import { api, ApiRequestError } from '../../../lib/api-client';
import { triggerErrorHaptic, triggerSuccessHaptic } from '../../../lib/native-feedback';
import { isNativeApp } from '../../../lib/native';
import { pickNativePodPhotos, type UploadablePhoto } from '../../../lib/native-media';
import { Card } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';
import { getAssignmentStage } from '../../../lib/utils';
import { useUIStore } from '../../../stores/ui-store';
import { format } from 'date-fns';

const milestoneColors: Record<string, string> = {
  ASSIGNED: 'bg-slate-500/20 text-slate-300',
  DISPATCHED: 'bg-blue-500/20 text-blue-400',
  AT_PICKUP: 'bg-amber-500/20 text-amber-400',
  PICKED_UP: 'bg-purple-500/20 text-purple-400',
  AT_DROPOFF: 'bg-indigo-500/20 text-indigo-400',
  DELIVERED: 'bg-emerald-500/20 text-emerald-400',
  COMPLETED: 'bg-emerald-500/20 text-emerald-400',
  CANCELLED: 'bg-red-500/20 text-red-400',
};

const milestoneLabels: Record<string, string> = {
  ASSIGNED: 'Assigned',
  DISPATCHED: 'Dispatched',
  AT_PICKUP: 'At Pickup',
  PICKED_UP: 'Picked Up',
  AT_DROPOFF: 'At Dropoff',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const milestoneOrder = ['ASSIGNED', 'DISPATCHED', 'AT_PICKUP', 'PICKED_UP', 'AT_DROPOFF', 'DELIVERED', 'COMPLETED'];

const milestoneActionLabels: Record<'pickup_arrived' | 'picked_up' | 'dropoff_arrived', string> = {
  pickup_arrived: 'Mark arrived at pickup',
  picked_up: 'Mark picked up',
  dropoff_arrived: 'Mark arrived at dropoff',
};

interface PodUploadResponse {
  urls: Array<{ key: string; uploadUrl: string }>;
}

function toUploadablePhotos(files: File[]): UploadablePhoto[] {
  const timestamp = Date.now();
  return files.map((file, index) => ({
    id: `web-pod-${timestamp}-${index}`,
    file,
    previewUrl: URL.createObjectURL(file),
  }));
}

function getNextMilestone(assignment: {
  dispatched_at?: string;
  pickup_arrived_at?: string;
  picked_up_at?: string;
  dropoff_arrived_at?: string;
}) {
  if (!assignment.dispatched_at) return null;
  if (!assignment.pickup_arrived_at) return 'pickup_arrived' as const;
  if (!assignment.picked_up_at) return 'picked_up' as const;
  if (!assignment.dropoff_arrived_at) return 'dropoff_arrived' as const;
  return null;
}

export default function DriverTripsPage() {
  const { data, isLoading, error, refetch } = useAssignments();
  const addToast = useUIStore((state) => state.addToast);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [podFiles, setPodFiles] = useState<Record<string, UploadablePhoto[]>>({});
  const [podNotes, setPodNotes] = useState<Record<string, string>>({});
  const nativeShell = isNativeApp();

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;

  const assignments = data?.data ?? [];

  const handleMilestone = async (assignmentId: string, milestone: 'pickup_arrived' | 'picked_up' | 'dropoff_arrived') => {
    setActiveAction(`${assignmentId}:${milestone}`);
    try {
      await api.post(`/api/v1/assignments/${assignmentId}/milestones`, { milestone });
      await triggerSuccessHaptic();
      addToast({ type: 'success', title: 'Milestone recorded', message: milestoneActionLabels[milestone] });
      await refetch();
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.errorBody.error : err instanceof Error ? err.message : 'Unknown error';
      await triggerErrorHaptic();
      addToast({ type: 'error', title: 'Failed to update trip', message });
    } finally {
      setActiveAction(null);
    }
  };

  const handlePodFilesChange = (assignmentId: string, event: ChangeEvent<HTMLInputElement>) => {
    const selected = toUploadablePhotos(Array.from(event.target.files ?? []));
    setPodFiles((current) => ({
      ...current,
      [assignmentId]: selected,
    }));
    event.target.value = '';
  };

  const handleNativePhotoPick = async (assignmentId: string) => {
    try {
      const photos = await pickNativePodPhotos(5);
      if (photos.length === 0) {
        return;
      }

      setPodFiles((current) => ({
        ...current,
        [assignmentId]: photos,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to open photo picker';
      addToast({ type: 'error', title: 'Photo selection failed', message });
    }
  };

  const handlePodSubmit = async (assignmentId: string) => {
    const files = podFiles[assignmentId] ?? [];
    if (files.length === 0) {
      addToast({ type: 'warning', title: 'Add POD photos', message: 'Upload at least one JPG photo before confirming delivery.' });
      return;
    }

    if (files.some((photo) => !['image/jpeg', 'image/jpg'].includes(photo.file.type))) {
      addToast({ type: 'warning', title: 'Unsupported file type', message: 'Upload JPG images only for POD submission.' });
      return;
    }

    setActiveAction(`${assignmentId}:pod`);
    try {
      const uploadResponse = await api.post<PodUploadResponse>(`/api/v1/pod/${assignmentId}/upload-urls`, {
        fileCount: files.length,
      });

      await Promise.all(
        uploadResponse.urls.map(async (item, index) => {
          const response = await fetch(item.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'image/jpeg' },
            body: files[index].file,
          });
          if (!response.ok) {
            throw new Error('One or more POD uploads failed');
          }
        }),
      );

      await api.post(`/api/v1/pod/${assignmentId}/confirm`, {
        podPhotoKeys: uploadResponse.urls.map((item) => item.key),
        podNotes: podNotes[assignmentId]?.trim() || undefined,
      });

      await triggerSuccessHaptic();
      addToast({ type: 'success', title: 'Delivery confirmed', message: 'POD was submitted and settlement was triggered.' });
      setPodFiles((current) => ({ ...current, [assignmentId]: [] }));
      setPodNotes((current) => ({ ...current, [assignmentId]: '' }));
      await refetch();
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.errorBody.error : err instanceof Error ? err.message : 'Unknown error';
      await triggerErrorHaptic();
      addToast({ type: 'error', title: 'POD submission failed', message });
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <div className="animate-in">
      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200/70">Driver trip hub</p>
            <h1 className="mt-2 text-3xl font-black text-white">Execution milestones and POD</h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-300">Update trip status in the field, capture proof of delivery, and trigger settlement from one mobile-friendly workflow.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 lg:w-[24rem]">
            <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-400">Trips</p>
              <p className="mt-2 text-2xl font-black text-white">{assignments.length}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-400">Ready POD</p>
              <p className="mt-2 text-2xl font-black text-white">{assignments.filter((assignment) => assignment.status === 'ACTIVE' && Boolean(assignment.dropoff_arrived_at) && !assignment.delivered_at).length}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/5 p-3">
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-slate-400">Delivered</p>
              <p className="mt-2 text-2xl font-black text-white">{assignments.filter((assignment) => Boolean(assignment.delivered_at)).length}</p>
            </div>
          </div>
        </div>
      </Card>

      {assignments.length === 0 ? (
        <EmptyState
          title="No active trips"
          description="Confirmed bookings will appear here when they are dispatched to you."
        />
      ) : (
        <div className="space-y-4">
          {assignments.map((assignment) => {
            const currentMilestone = getAssignmentStage(assignment);
            const currentIdx = milestoneOrder.indexOf(currentMilestone);
            const nextMilestone = getNextMilestone(assignment);
            const canSubmitPod = assignment.status === 'ACTIVE' && Boolean(assignment.dropoff_arrived_at) && !assignment.delivered_at;
            const selectedFiles = podFiles[assignment.id] ?? [];

            return (
              <Card key={assignment.id} className="overflow-hidden border-gray-700/60 bg-gray-900/60">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-mono text-gray-500">{assignment.id.slice(0, 8)}</p>
                  <Badge className={milestoneColors[currentMilestone] ?? 'bg-gray-700 text-gray-300'}>
                    {milestoneLabels[currentMilestone] ?? currentMilestone}
                  </Badge>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="lg:max-w-xl">
                    <p className="text-sm font-medium text-white mb-3">
                      Load: {assignment.load_id.slice(0, 8)} • Truck: {assignment.truck_id?.slice(0, 8) ?? '—'}
                    </p>

                    <div className="relative pl-4">
                      {milestoneOrder.map((milestone, index) => {
                        const done = index <= currentIdx;
                        return (
                          <div key={milestone} className="flex items-center gap-3 mb-2 last:mb-0">
                            <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${done ? 'bg-emerald-500' : 'bg-gray-700'}`} />
                            {index < milestoneOrder.length - 1 && (
                              <div
                                className={`absolute left-[1.18rem] mt-4 w-0.5 h-4 ${done ? 'bg-emerald-500/50' : 'bg-gray-700'}`}
                                style={{ top: `${index * 2}rem` }}
                              />
                            )}
                            <span className={`text-xs ${done ? 'text-white font-medium' : 'text-gray-500'}`}>
                              {milestoneLabels[milestone]}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-xs text-gray-500 mt-3">
                      Started: {format(new Date(assignment.created_at), 'MMM d, h:mm a')}
                    </p>
                  </div>

                  <div className="lg:w-[22rem] lg:flex-shrink-0 space-y-3">
                    {nextMilestone && (
                      <div className="rounded-2xl border border-blue-500/20 bg-blue-950/20 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-blue-300/70">Next action</p>
                        <p className="text-sm text-white mt-2">{milestoneActionLabels[nextMilestone]}</p>
                        <Button
                          className="mt-3 w-full"
                          loading={activeAction === `${assignment.id}:${nextMilestone}`}
                          onClick={() => handleMilestone(assignment.id, nextMilestone)}
                        >
                          {milestoneActionLabels[nextMilestone]}
                        </Button>
                      </div>
                    )}

                    {canSubmitPod && (
                      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/70">Proof Of Delivery</p>
                        <p className="text-sm text-gray-300 mt-2">Upload signed or photo evidence to confirm delivery and trigger settlement.</p>
                        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                          {nativeShell ? (
                            <Button variant="secondary" className="sm:flex-1" onClick={() => handleNativePhotoPick(assignment.id)}>
                              Add from camera or gallery
                            </Button>
                          ) : (
                            <label className="inline-flex h-12 cursor-pointer items-center justify-center rounded-[20px] border border-white/10 bg-white/6 px-4 text-sm font-semibold text-white transition hover:bg-white/10 sm:flex-1">
                              Select JPG photos
                              <input
                                className="hidden"
                                type="file"
                                accept="image/jpeg"
                                multiple
                                onChange={(event) => handlePodFilesChange(assignment.id, event)}
                              />
                            </label>
                          )}
                          <Button className="sm:flex-1" loading={activeAction === `${assignment.id}:pod`} onClick={() => handlePodSubmit(assignment.id)}>
                            Submit POD
                          </Button>
                        </div>

                        <p className="mt-2 text-xs text-gray-500">
                          {selectedFiles.length > 0 ? `${selectedFiles.length} photo(s) ready for upload` : 'Add one or more delivery photos.'}
                        </p>

                        {selectedFiles.length > 0 && (
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            {selectedFiles.map((photo) => (
                              <div key={photo.id} className="relative overflow-hidden rounded-[16px] border border-white/10 bg-black/20">
                                <Image
                                  src={photo.previewUrl}
                                  alt="POD preview"
                                  width={160}
                                  height={96}
                                  unoptimized
                                  className="h-24 w-full object-cover"
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        <label className="mt-3 block text-sm font-medium text-gray-300">Delivery notes</label>
                        <textarea
                          className="mt-2 min-h-24 w-full rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30"
                          placeholder="Receiver name, exceptions, seal condition, dock notes..."
                          value={podNotes[assignment.id] ?? ''}
                          onChange={(event) => setPodNotes((current) => ({ ...current, [assignment.id]: event.target.value }))}
                        />
                      </div>
                    )}

                    {assignment.status === 'ACTIVE' && (
                      <div className="flex justify-end">
                        <Link
                          href={`/driver/tracking?assignmentId=${assignment.id}`}
                          className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:border-emerald-400/50 hover:bg-emerald-500/15"
                        >
                          Open live tracking
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
