'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useAssignments } from '../../../hooks/queries';
import { api, ApiRequestError } from '../../../lib/api-client';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { PageLoader, ErrorDisplay, EmptyState } from '../../../components/ui/feedback';
import { formatUSD } from '../../../lib/utils';
import { useAuthStore } from '../../../stores/auth-store';
import { useUIStore } from '../../../stores/ui-store';
import { format } from 'date-fns';

interface PaymentRecord {
  id: string;
  loadId: string;
  assignmentId: string | null;
  grossAmountCents: number;
  platformFeeCents: number;
  netCarrierCents: number;
  advanceAmountCents: number | null;
  status: string;
  createdAt: string;
  releasedAt: string | null;
}

interface PaymentCheckoutSession {
  paymentId: string;
  stripePaymentIntentId: string;
  clientSecret: string;
  grossAmountCents: number;
  platformFeeCents: number;
  netCarrierCents: number;
  paymentStatus: string;
}

interface PaymentSyncResult {
  payment: PaymentRecord;
  stripeIntentStatus: string;
}

const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;
const stripeAppearance = {
  theme: 'night',
  variables: {
    colorPrimary: '#38bdf8',
    colorBackground: '#0f172a',
    colorText: '#e2e8f0',
    colorDanger: '#f87171',
    borderRadius: '14px',
  },
} as const;

const paymentStatusColors: Record<string, string> = {
  PENDING: 'bg-amber-500/20 text-amber-300',
  ESCROW_HELD: 'bg-blue-500/20 text-blue-300',
  PARTIALLY_RELEASED: 'bg-violet-500/20 text-violet-300',
  RELEASED: 'bg-emerald-500/20 text-emerald-300',
  FAILED: 'bg-red-500/20 text-red-300',
  REFUNDED: 'bg-gray-500/20 text-gray-300',
  DISPUTED: 'bg-orange-500/20 text-orange-300',
};

function CheckoutForm({
  session,
  onConfirmed,
  onCancel,
}: {
  session: PaymentCheckoutSession;
  onConfirmed: (paymentId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements) {
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: window.location.href,
        },
      });

      if (result.error) {
        setErrorMessage(result.error.message ?? 'Unable to confirm payment');
        return;
      }

      await onConfirmed(session.paymentId);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PaymentElement />
      {errorMessage && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {errorMessage}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          Close
        </Button>
        <Button loading={submitting} onClick={handleSubmit}>
          Authorize Payment
        </Button>
      </div>
    </div>
  );
}

export default function ShipperPaymentsPage() {
  const queryClient = useQueryClient();
  const addToast = useUIStore((state) => state.addToast);
  const activeOrg = useAuthStore((state) => state.activeOrg);
  const [platformFeePct, setPlatformFeePct] = useState('8');
  const [advancePct, setAdvancePct] = useState('0');
  const [creatingForAssignmentId, setCreatingForAssignmentId] = useState<string | null>(null);
  const [activeCheckoutSession, setActiveCheckoutSession] = useState<PaymentCheckoutSession | null>(null);

  const assignmentsQuery = useAssignments();
  const paymentsQuery = useQuery({
    queryKey: ['payments'],
    queryFn: () => api.get<{ data: PaymentRecord[] }>('/api/v1/payments'),
  });

  const createEscrow = useMutation({
    mutationFn: async (payload: {
      loadId: string;
      assignmentId: string;
      carrierOrgId: string;
      grossAmountCents: number;
      platformFeePct: number;
      advancePct: number;
    }) => api.post<{ data: PaymentCheckoutSession }>('/api/v1/payments/escrow', {
      ...payload,
      shipperOrgId: activeOrg?.orgId,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });

  const openCheckout = useMutation({
    mutationFn: async (paymentId: string) => api.get<{ data: PaymentCheckoutSession }>(`/api/v1/payments/${paymentId}/checkout`),
  });

  const syncPayment = useMutation({
    mutationFn: async (paymentId: string) => api.post<{ data: PaymentSyncResult }>(`/api/v1/payments/${paymentId}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });

  if (assignmentsQuery.isLoading || paymentsQuery.isLoading) return <PageLoader />;
  if (assignmentsQuery.error) return <ErrorDisplay error={assignmentsQuery.error} onRetry={assignmentsQuery.refetch} />;
  if (paymentsQuery.error) return <ErrorDisplay error={paymentsQuery.error} onRetry={paymentsQuery.refetch} />;

  const assignments = assignmentsQuery.data?.data ?? [];
  const payments = paymentsQuery.data?.data ?? [];
  const paymentByAssignment = new Map(payments.filter((payment) => payment.assignmentId).map((payment) => [payment.assignmentId!, payment]));

  const fundingQueue = assignments.filter((assignment) => !paymentByAssignment.has(assignment.id));

  const totalVolume = payments.reduce((sum, payment) => sum + payment.grossAmountCents, 0);
  const heldCount = payments.filter((payment) => ['ESCROW_HELD', 'PARTIALLY_RELEASED'].includes(payment.status)).length;
  const releasedCount = payments.filter((payment) => payment.status === 'RELEASED').length;
  const pendingCount = payments.filter((payment) => payment.status === 'PENDING').length;

  const handleCreateEscrow = async (assignment: {
    id: string;
    load_id: string;
    carrier_org_id: string;
    agreed_rate_usd: number;
  }) => {
    if (!activeOrg?.orgId) {
      addToast({ type: 'error', title: 'No active shipper organization' });
      return;
    }

    const platformFee = Number(platformFeePct);
    const advance = Number(advancePct);
    if (Number.isNaN(platformFee) || platformFee < 0 || platformFee > 30) {
      addToast({ type: 'warning', title: 'Invalid platform fee', message: 'Use a value between 0 and 30 percent.' });
      return;
    }
    if (Number.isNaN(advance) || advance < 0 || advance > 50) {
      addToast({ type: 'warning', title: 'Invalid advance percentage', message: 'Use a value between 0 and 50 percent.' });
      return;
    }

    setCreatingForAssignmentId(assignment.id);
    try {
      const result = await createEscrow.mutateAsync({
        loadId: assignment.load_id,
        assignmentId: assignment.id,
        carrierOrgId: assignment.carrier_org_id,
        grossAmountCents: Math.round(assignment.agreed_rate_usd * 100),
        platformFeePct: platformFee,
        advancePct: advance,
      });

      if (!stripePromise) {
        addToast({
          type: 'warning',
          title: 'Escrow created but checkout is unavailable',
          message: 'Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to complete card authorization in the browser.',
        });
        return;
      }

      setActiveCheckoutSession(result.data);
      addToast({
        type: 'info',
        title: 'Escrow created',
        message: 'Enter card details to authorize the escrow hold.',
      });
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.errorBody.error : err instanceof Error ? err.message : 'Unknown error';
      addToast({ type: 'error', title: 'Failed to create escrow', message });
    } finally {
      setCreatingForAssignmentId(null);
    }
  };

  const handleResumeCheckout = async (paymentId: string) => {
    if (!stripePromise) {
      addToast({
        type: 'warning',
        title: 'Checkout is unavailable',
        message: 'Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to resume payment authorization in the browser.',
      });
      return;
    }

    try {
      const result = await openCheckout.mutateAsync(paymentId);
      setActiveCheckoutSession(result.data);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.errorBody.error : err instanceof Error ? err.message : 'Unknown error';
      addToast({ type: 'error', title: 'Unable to open checkout', message });
    }
  };

  const handlePaymentConfirmed = async (paymentId: string) => {
    try {
      const result = await syncPayment.mutateAsync(paymentId);
      const syncedPayment = result.data.payment;

      if (['ESCROW_HELD', 'PARTIALLY_RELEASED', 'RELEASED'].includes(syncedPayment.status)) {
        setActiveCheckoutSession(null);
        addToast({
          type: 'success',
          title: 'Escrow authorized',
          message: `Payment is now ${syncedPayment.status.replace('_', ' ').toLowerCase()}.`,
        });
        return;
      }

      addToast({
        type: 'info',
        title: 'Payment confirmed with Stripe',
        message: `Stripe intent is ${result.data.stripeIntentStatus}; the ledger status is still ${syncedPayment.status}.`,
      });
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.errorBody.error : err instanceof Error ? err.message : 'Unknown error';
      addToast({ type: 'error', title: 'Unable to sync payment status', message });
    }
  };

  return (
    <div className="animate-in">
      <div className="flex flex-col gap-2 mb-6">
        <h1 className="text-2xl font-bold text-white">Payments</h1>
        <p className="text-sm text-gray-400 max-w-3xl">
          Initiate escrow for awarded loads, monitor settlement status, and verify which deliveries have released funds to carriers.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6 lg:grid-cols-4">
        <StatCard label="Payment Volume" value={formatUSD(totalVolume / 100)} />
        <StatCard label="Escrow Held" value={heldCount} />
        <StatCard label="Released" value={releasedCount} />
        <StatCard label="Pending Funding" value={pendingCount} />
      </div>

      <Card className="mb-6 border-blue-500/20 bg-gradient-to-br from-blue-950/30 to-gray-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-blue-300/70">Escrow Settings</p>
            <h2 className="text-xl font-semibold text-white mt-1">Configure the default payment split before funding</h2>
            <p className="text-sm text-gray-400 mt-2 max-w-2xl">
              These values are used when you create a new escrow record for an awarded assignment.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:w-[28rem]">
            <Input
              label="Platform fee %"
              type="number"
              min="0"
              max="30"
              value={platformFeePct}
              onChange={(event) => setPlatformFeePct(event.target.value)}
            />
            <Input
              label="Carrier advance %"
              type="number"
              min="0"
              max="50"
              value={advancePct}
              onChange={(event) => setAdvancePct(event.target.value)}
            />
          </div>
        </div>
      </Card>

      {activeCheckoutSession && (
        <Card className="mb-6 border-emerald-500/20 bg-gradient-to-br from-emerald-950/25 to-gray-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-emerald-300/70">Stripe Checkout</p>
              <h2 className="text-xl font-semibold text-white mt-1">Authorize escrow funding</h2>
              <p className="text-sm text-gray-400 mt-2 max-w-2xl">
                This authorizes the shipper charge and moves the payment into escrow held once Stripe marks the intent capturable.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm">
              <p className="text-gray-300">Gross amount</p>
              <p className="text-xl font-semibold text-emerald-300">{formatUSD(activeCheckoutSession.grossAmountCents / 100)}</p>
            </div>
          </div>

          {stripePromise ? (
            <Elements
              key={activeCheckoutSession.clientSecret}
              stripe={stripePromise}
              options={{
                clientSecret: activeCheckoutSession.clientSecret,
                appearance: stripeAppearance,
              }}
            >
              <CheckoutForm
                session={activeCheckoutSession}
                onConfirmed={handlePaymentConfirmed}
                onCancel={() => setActiveCheckoutSession(null)}
              />
            </Elements>
          ) : (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not configured, so browser-side checkout is unavailable.
            </div>
          )}
        </Card>
      )}

      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Funding queue</h2>
            <p className="text-sm text-gray-400 mt-1">Assignments without a payment record appear here.</p>
          </div>
          <Badge className="bg-blue-500/15 text-blue-200">{fundingQueue.length} awaiting payment</Badge>
        </div>

        {fundingQueue.length === 0 ? (
          <EmptyState
            title="All assigned loads have payment records"
            description="When new awards happen, you can create escrow here before delivery execution continues."
          />
        ) : (
          <div className="space-y-3">
            {fundingQueue.map((assignment) => (
              <div key={assignment.id} className="rounded-2xl border border-gray-700/60 bg-gray-900/70 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Load {assignment.load_id.slice(0, 8)}...</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Assignment {assignment.id.slice(0, 8)}... • Carrier {assignment.carrier_org_id.slice(0, 8)}...
                    </p>
                    <p className="text-sm text-emerald-300 mt-2">Target amount {formatUSD(assignment.agreed_rate_usd)}</p>
                  </div>
                  <Button
                    loading={creatingForAssignmentId === assignment.id}
                    onClick={() => handleCreateEscrow(assignment)}
                  >
                    Create Escrow
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Payment lifecycle</h2>
            <p className="text-sm text-gray-400 mt-1">Track intent creation, held escrow, and release after POD confirmation.</p>
          </div>
          <Badge className="bg-gray-700/60 text-gray-200">{payments.length} payment records</Badge>
        </div>

        {payments.length === 0 ? (
          <EmptyState
            title="No payment records yet"
            description="Create escrow from the funding queue once a bid is awarded and an assignment exists."
          />
        ) : (
          <div className="space-y-3">
            {payments.map((payment) => (
              <div key={payment.id} className="rounded-2xl border border-gray-700/60 bg-gray-900/70 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-white">Payment {payment.id.slice(0, 8)}...</p>
                      <Badge className={paymentStatusColors[payment.status] ?? 'bg-gray-600/20 text-gray-300'}>
                        {payment.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="grid gap-1 text-sm text-gray-400 mt-2 sm:grid-cols-2">
                      <p>Load: {payment.loadId.slice(0, 8)}...</p>
                      <p>Assignment: {payment.assignmentId ? `${payment.assignmentId.slice(0, 8)}...` : '—'}</p>
                      <p>Gross: {formatUSD(payment.grossAmountCents / 100)}</p>
                      <p>Carrier net: {formatUSD(payment.netCarrierCents / 100)}</p>
                      <p>Platform fee: {formatUSD(payment.platformFeeCents / 100)}</p>
                      <p>Advance: {formatUSD((payment.advanceAmountCents ?? 0) / 100)}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 lg:items-end">
                    <div className="text-xs text-gray-500 lg:text-right">
                      <p>Created {format(new Date(payment.createdAt), 'MMM d, yyyy h:mm a')}</p>
                      <p className="mt-1">
                        Released {payment.releasedAt ? format(new Date(payment.releasedAt), 'MMM d, yyyy h:mm a') : 'Pending'}
                      </p>
                    </div>
                    {['PENDING', 'FAILED'].includes(payment.status) && (
                      <Button
                        size="sm"
                        loading={openCheckout.isPending && activeCheckoutSession?.paymentId !== payment.id}
                        onClick={() => handleResumeCheckout(payment.id)}
                      >
                        {payment.status === 'FAILED' ? 'Retry funding' : 'Complete funding'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}