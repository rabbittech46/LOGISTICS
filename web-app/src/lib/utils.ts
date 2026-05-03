// Generate a cryptographically random idempotency key for slot booking operations
export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `idk_${crypto.randomUUID()}`;
  }
  // Fallback for older environments
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `idk_${hex}`;
}

// Format currency
export function formatUSD(amount: number | undefined | null): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Format weight
export function formatWeight(lbs: number): string {
  return `${new Intl.NumberFormat('en-US').format(lbs)} lbs`;
}

// Format distance
export function formatDistance(miles: number | undefined | null): string {
  if (miles == null) return '—';
  return `${new Intl.NumberFormat('en-US').format(Math.round(miles))} mi`;
}

type AssignmentProgress = {
  status: string;
  assigned_at?: string | null;
  dispatched_at?: string | null;
  pickup_arrived_at?: string | null;
  picked_up_at?: string | null;
  dropoff_arrived_at?: string | null;
  delivered_at?: string | null;
};

export function getAssignmentStage(assignment: AssignmentProgress): string {
  if (assignment.status === 'CANCELLED') return 'CANCELLED';
  if (assignment.status === 'COMPLETED') return 'COMPLETED';
  if (assignment.delivered_at) return 'DELIVERED';
  if (assignment.dropoff_arrived_at) return 'AT_DROPOFF';
  if (assignment.picked_up_at) return 'PICKED_UP';
  if (assignment.pickup_arrived_at) return 'AT_PICKUP';
  if (assignment.dispatched_at) return 'DISPATCHED';
  if (assignment.assigned_at) return 'ASSIGNED';
  return assignment.status;
}

// Status colors for tailwind
export const loadStatusColors: Record<string, string> = {
  DRAFT: 'bg-gray-500/20 text-gray-300',
  POSTED: 'bg-blue-500/20 text-blue-400',
  BIDDING: 'bg-purple-500/20 text-purple-400',
  ASSIGNED: 'bg-cyan-500/20 text-cyan-400',
  CONFIRMED: 'bg-emerald-500/20 text-emerald-400',
  IN_TRANSIT: 'bg-amber-500/20 text-amber-400',
  DELIVERED: 'bg-green-500/20 text-green-400',
  COMPLETED: 'bg-green-600/20 text-green-300',
  CANCELLED: 'bg-red-500/20 text-red-400',
  DISPUTED: 'bg-orange-500/20 text-orange-400',
};

export const slotStatusColors: Record<string, string> = {
  AVAILABLE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  RESERVED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  BOOKED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

// Cargo type labels
export const cargoTypeLabels: Record<string, string> = {
  DRY_VAN: 'Dry Van',
  REFRIGERATED: 'Refrigerated',
  FLATBED: 'Flatbed',
  TANKER: 'Tanker',
  HAZMAT: 'Hazmat',
  OVERSIZED: 'Oversized',
  INTERMODAL: 'Intermodal',
  CURTAIN_SIDE: 'Curtain Side',
  LOWBOY: 'Lowboy',
};
