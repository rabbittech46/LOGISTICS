// ─────────────────────────────────────────────────────────────────────────────
// React Query hooks — server-state management for all API resources
// ─────────────────────────────────────────────────────────────────────────────
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '../lib/api-client';
import type {
  ApiResponse,
  Load,
  LoadSlot,
  SlotSummary,
  Booking,
  Truck,
  Driver,
  Assignment,
  AssignmentTracking,
  Bid,
  Organization,
  User,
} from '../lib/types';
import type { CreateLoadFormData, ConfirmBookingFormData } from '../lib/validations';

interface CreateLoadResult {
  loadId: string;
  referenceNumber: string;
}

// ── Query Keys ──────────────────────────────────────────────────────────────
export const queryKeys = {
  loads: ['loads'] as const,
  loadBoard: ['loadBoard'] as const,
  load: (id: string) => ['load', id] as const,
  loadSlots: (id: string) => ['loadSlots', id] as const,
  mySlot: (id: string) => ['mySlot', id] as const,
  trucks: ['trucks'] as const,
  truck: (id: string) => ['truck', id] as const,
  drivers: ['drivers'] as const,
  driver: (id: string) => ['driver', id] as const,
  driverMe: ['driverMe'] as const,
  assignments: ['assignments'] as const,
  assignmentTracking: ['assignmentTracking'] as const,
  assignment: (id: string) => ['assignment', id] as const,
  bids: ['bids'] as const,
  loadBids: (loadId: string) => ['bids', 'load', loadId] as const,
  organizations: ['organizations'] as const,
  organization: (id: string) => ['organization', id] as const,
  userMe: ['userMe'] as const,
};

// ── Loads ────────────────────────────────────────────────────────────────────
export function useLoads(params?: Record<string, string>) {
  const search = params ? '?' + new URLSearchParams(params).toString() : '';
  return useQuery({
    queryKey: [...queryKeys.loads, params],
    queryFn: () => api.get<ApiResponse<Load[]>>(`/api/v1/loads${search}`),
    refetchOnMount: 'always',
  });
}

export function useLoadBoard(params?: Record<string, string>) {
  const search = params ? '?' + new URLSearchParams(params).toString() : '';
  return useQuery({
    queryKey: [...queryKeys.loadBoard, params],
    queryFn: () => api.get<ApiResponse<Load[]>>(`/api/v1/loads/board${search}`),
    refetchInterval: 10000,
    refetchIntervalInBackground: false, // Stop polling when tab is hidden
    refetchOnMount: 'always',
  });
}

export function useLoad(id: string) {
  return useQuery({
    queryKey: queryKeys.load(id),
    queryFn: () => api.get<ApiResponse<Load>>(`/api/v1/loads/${id}`),
    enabled: !!id,
  });
}

export function useCreateLoad() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateLoadFormData) =>
      api.post<ApiResponse<CreateLoadResult>>('/api/v1/loads', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.loads });
    },
  });
}

export function usePostLoad() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (loadId: string) =>
      api.post<ApiResponse<Load>>(`/api/v1/loads/${loadId}/post`),
    onSuccess: (_, loadId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.load(loadId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.loads });
      queryClient.invalidateQueries({ queryKey: queryKeys.loadBoard });
    },
  });
}

export function useCancelLoad() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ loadId, reason }: { loadId: string; reason: string }) =>
      api.post<ApiResponse<{ message: string }>>(`/api/v1/loads/${loadId}/cancel`, { reason }),
    onSuccess: (_, { loadId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.load(loadId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.loads });
    },
  });
}

// ── Slot Booking ────────────────────────────────────────────────────────────
export function useLoadSlots(loadId: string) {
  return useQuery({
    queryKey: queryKeys.loadSlots(loadId),
    queryFn: () => api.get<ApiResponse<SlotSummary>>(`/api/v1/loads/${loadId}/slots`),
    enabled: !!loadId,
    refetchInterval: 5000,
    refetchIntervalInBackground: false, // Don't poll when tab is backgrounded
  });
}

export function useMySlot(loadId: string) {
  return useQuery({
    queryKey: queryKeys.mySlot(loadId),
    queryFn: () => api.get<ApiResponse<LoadSlot | null>>(`/api/v1/loads/${loadId}/my-slot`),
    enabled: !!loadId,
  });
}

export function useReserveSlot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ loadId, idempotencyKey }: { loadId: string; idempotencyKey: string }) =>
      api.post<ApiResponse<LoadSlot>>(`/api/v1/loads/${loadId}/reserve`, undefined, {
        idempotencyKey,
        retries: 0,
      }),
    onSuccess: (_, { loadId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.loadSlots(loadId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.mySlot(loadId) });
    },
  });
}

export function useConfirmBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ loadId, idempotencyKey, ...data }: ConfirmBookingFormData & { loadId: string; idempotencyKey: string }) =>
      api.post<ApiResponse<Booking>>(`/api/v1/loads/${loadId}/confirm`, data, {
        idempotencyKey,
        retries: 0,
      }),
    onSuccess: (_, { loadId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.loadSlots(loadId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.mySlot(loadId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.load(loadId) });
    },
  });
}

export function useCancelReservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ loadId, slotId, idempotencyKey }: { loadId: string; slotId: string; idempotencyKey: string }) =>
      api.post<ApiResponse<{ slotId: string; status: string }>>(
        `/api/v1/loads/${loadId}/cancel-reservation`,
        { slotId },
        { idempotencyKey, retries: 0 },
      ),
    onSuccess: (_, { loadId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.loadSlots(loadId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.mySlot(loadId) });
    },
  });
}

// ── Trucks ───────────────────────────────────────────────────────────────────
export function useTrucks(params?: Record<string, string>) {
  const search = params ? '?' + new URLSearchParams(params).toString() : '';
  return useQuery({
    queryKey: [...queryKeys.trucks, params],
    queryFn: () => api.get<ApiResponse<Truck[]>>(`/api/v1/trucks${search}`),
    refetchOnMount: 'always',
  });
}

export function useTruck(id: string) {
  return useQuery({
    queryKey: queryKeys.truck(id),
    queryFn: () => api.get<ApiResponse<Truck>>(`/api/v1/trucks/${id}`),
    enabled: !!id,
  });
}

// ── Drivers ──────────────────────────────────────────────────────────────────
export function useDrivers(params?: Record<string, string>) {
  const search = params ? '?' + new URLSearchParams(params).toString() : '';
  return useQuery({
    queryKey: [...queryKeys.drivers, params],
    queryFn: () => api.get<ApiResponse<Driver[]>>(`/api/v1/drivers${search}`),
    refetchOnMount: 'always',
  });
}

export function useDriverMe() {
  return useQuery({
    queryKey: queryKeys.driverMe,
    queryFn: () => api.get<ApiResponse<Driver>>('/api/v1/drivers/me'),
  });
}

// ── Assignments ──────────────────────────────────────────────────────────────
export function useAssignments(params?: Record<string, string>) {
  const search = params ? '?' + new URLSearchParams(params).toString() : '';
  return useQuery({
    queryKey: [...queryKeys.assignments, params],
    queryFn: () => api.get<ApiResponse<Assignment[]>>(`/api/v1/assignments${search}`),
    refetchOnMount: 'always',
  });
}

export function useAssignmentTracking(params?: Record<string, string>) {
  const search = params ? '?' + new URLSearchParams(params).toString() : '';
  return useQuery({
    queryKey: [...queryKeys.assignmentTracking, params],
    queryFn: () => api.get<ApiResponse<AssignmentTracking[]>>(`/api/v1/assignments/tracking${search}`),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
  });
}

// ── Bids ─────────────────────────────────────────────────────────────────────
export function useLoadBids(loadId: string) {
  return useQuery({
    queryKey: queryKeys.loadBids(loadId),
    queryFn: () => api.get<ApiResponse<Bid[]>>(`/api/v1/bids/load/${loadId}`),
    enabled: !!loadId,
    refetchOnMount: 'always',
  });
}

export function useAllBids() {
  return useQuery({
    queryKey: queryKeys.bids,
    queryFn: () => api.get<ApiResponse<Bid[]>>('/api/v1/bids'),
    refetchOnMount: 'always',
  });
}

// ── Organizations ────────────────────────────────────────────────────────────
export function useOrganizations() {
  return useQuery({
    queryKey: queryKeys.organizations,
    queryFn: () => api.get<ApiResponse<Organization[]>>('/api/v1/organizations'),
    refetchOnMount: 'always',
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; orgType: string; contactEmail: string; contactPhone?: string; dotNumber?: string; mcNumber?: string }) =>
      api.post<ApiResponse<Organization>>('/api/v1/organizations', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
    },
  });
}

// ── User Profile ─────────────────────────────────────────────────────────────
export function useUserProfile() {
  return useQuery({
    queryKey: queryKeys.userMe,
    queryFn: () => api.get<ApiResponse<User>>('/api/v1/users/me'),
  });
}
