'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../../lib/api-client';
import { Card, StatCard } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { formatUSD } from '../../../lib/utils';
import { useAuthStore } from '../../../stores/auth-store';
import { useUIStore } from '../../../stores/ui-store';

interface PriceQuote {
  baseCents: number;
  distanceCents: number;
  weightCents: number;
  fuelSurchargeCents: number;
  cargoSurchargeCents: number;
  surgeCents: number;
  weekendSurchargeCents: number;
  totalCents: number;
  ratePerMileCents: number;
  surgeMultiplier: number;
  contractedRate: boolean;
  confidenceScore: number;
  breakdown: Array<{
    component: string;
    amountCents: number;
    description: string;
  }>;
}

const cargoOptions = [
  { value: 'DRY_VAN', label: 'Dry Van' },
  { value: 'REFRIGERATED', label: 'Refrigerated' },
  { value: 'FLATBED', label: 'Flatbed' },
  { value: 'TANKER', label: 'Tanker' },
  { value: 'INTERMODAL', label: 'Intermodal' },
  { value: 'OVERSIZED', label: 'Oversized' },
];

function centsToUsd(cents: number) {
  return formatUSD(cents / 100);
}

export default function ShipperPricingPage() {
  const addToast = useUIStore((state) => state.addToast);
  const activeOrg = useAuthStore((state) => state.activeOrg);
  const [cargoType, setCargoType] = useState('DRY_VAN');
  const [weightLbs, setWeightLbs] = useState('42000');
  const [distanceMiles, setDistanceMiles] = useState('640');
  const [originState, setOriginState] = useState('TX');
  const [destState, setDestState] = useState('CA');
  const [pickupDate, setPickupDate] = useState(new Date().toISOString().slice(0, 10));
  const [isHazmat, setIsHazmat] = useState(false);
  const [isOversized, setIsOversized] = useState(false);

  const quoteMutation = useMutation({
    mutationFn: async () => api.post<{ data: PriceQuote }>('/api/v1/pricing/quote', {
      cargoType,
      weightLbs: Number(weightLbs),
      distanceMiles: Number(distanceMiles),
      originState: originState.toUpperCase(),
      destState: destState.toUpperCase(),
      pickupDate,
      isHazmat,
      isOversized,
      shipperOrgId: activeOrg?.orgId,
    }),
  });

  const quote = quoteMutation.data?.data;

  const handleQuote = async () => {
    try {
      await quoteMutation.mutateAsync();
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.errorBody.error : err instanceof Error ? err.message : 'Unknown error';
      addToast({ type: 'error', title: 'Unable to calculate quote', message });
    }
  };

  return (
    <div className="animate-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Pricing</h1>
        <p className="text-sm text-gray-400 mt-2 max-w-3xl">
          Run a live pricing quote using the platform pricing engine before you publish or negotiate a load.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Card className="border-violet-500/20 bg-gradient-to-br from-violet-950/25 to-gray-900">
          <p className="text-xs uppercase tracking-[0.2em] text-violet-300/70">Quote inputs</p>
          <h2 className="text-xl font-semibold text-white mt-1">Build a lane quote</h2>

          <div className="mt-5 space-y-3">
            <Select label="Cargo type" value={cargoType} onChange={(event) => setCargoType(event.target.value)} options={cargoOptions} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Weight (lbs)" type="number" value={weightLbs} onChange={(event) => setWeightLbs(event.target.value)} />
              <Input label="Distance (miles)" type="number" value={distanceMiles} onChange={(event) => setDistanceMiles(event.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Origin state" value={originState} onChange={(event) => setOriginState(event.target.value.toUpperCase())} maxLength={2} />
              <Input label="Destination state" value={destState} onChange={(event) => setDestState(event.target.value.toUpperCase())} maxLength={2} />
            </div>
            <Input label="Pickup date" type="date" value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-xl border border-gray-700/60 bg-gray-900/70 px-4 py-3 text-sm text-gray-200">
                Hazmat
                <input type="checkbox" checked={isHazmat} onChange={(event) => setIsHazmat(event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-gray-700/60 bg-gray-900/70 px-4 py-3 text-sm text-gray-200">
                Oversized
                <input type="checkbox" checked={isOversized} onChange={(event) => setIsOversized(event.target.checked)} />
              </label>
            </div>
            <Button className="w-full" loading={quoteMutation.isPending} onClick={handleQuote}>
              Calculate Quote
            </Button>
          </div>
        </Card>

        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Quoted total" value={quote ? centsToUsd(quote.totalCents) : '—'} />
            <StatCard label="Rate / mile" value={quote ? centsToUsd(quote.ratePerMileCents) : '—'} />
            <StatCard label="Confidence" value={quote ? `${Math.round(quote.confidenceScore * 100)}%` : '—'} />
          </div>

          <Card>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Quote outcome</h2>
                <p className="text-sm text-gray-400 mt-1">Dynamic pricing combines lane model, cargo surcharges, and market conditions.</p>
              </div>
              {quote && (
                <Badge className={quote.contractedRate ? 'bg-emerald-500/20 text-emerald-300' : 'bg-blue-500/20 text-blue-300'}>
                  {quote.contractedRate ? 'Contracted rate' : `Surge ${quote.surgeMultiplier.toFixed(2)}x`}
                </Badge>
              )}
            </div>

            {!quote ? (
              <div className="rounded-2xl border border-dashed border-gray-700/60 bg-gray-900/40 px-6 py-10 text-center text-sm text-gray-500">
                Run a quote to see the pricing breakdown and recommended shipper rate.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard label="Base" value={centsToUsd(quote.baseCents)} />
                  <StatCard label="Distance" value={centsToUsd(quote.distanceCents)} />
                  <StatCard label="Cargo" value={centsToUsd(quote.cargoSurchargeCents)} />
                  <StatCard label="Fuel" value={centsToUsd(quote.fuelSurchargeCents)} />
                </div>

                <div className="space-y-3">
                  {quote.breakdown.map((item) => (
                    <div key={`${item.component}-${item.description}`} className="rounded-2xl border border-gray-700/60 bg-gray-900/60 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-white">{item.component.replace(/_/g, ' ')}</p>
                          <p className="text-sm text-gray-400 mt-1">{item.description}</p>
                        </div>
                        <p className="text-sm font-semibold text-emerald-300">{centsToUsd(item.amountCents)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}