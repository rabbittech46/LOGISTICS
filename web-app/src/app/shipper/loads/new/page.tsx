'use client';

import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createLoadSchema, type CreateLoadFormData, cargoTypes } from '../../../../lib/validations';
import { useCreateLoad, usePostLoad } from '../../../../hooks/queries';
import { useUIStore } from '../../../../stores/ui-store';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { cargoTypeLabels } from '../../../../lib/utils';

export default function CreateLoadPage() {
  const router = useRouter();
  const addToast = useUIStore((s) => s.addToast);
  const createLoad = useCreateLoad();
  const postLoad = usePostLoad();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateLoadFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(createLoadSchema) as any,
    defaultValues: {
      totalTrucksRequired: 1,
      isHazmat: false,
    },
  });

  const isHazmat = useWatch({ control, name: 'isHazmat' });

  const toIsoString = (value: string) => new Date(value).toISOString();

  const onSubmit = async (data: CreateLoadFormData) => {
    try {
      const payload = {
        ...data,
        pickupEarliest: toIsoString(data.pickupEarliest),
        pickupLatest: toIsoString(data.pickupLatest),
        dropoffEarliest: toIsoString(data.dropoffEarliest),
        dropoffLatest: toIsoString(data.dropoffLatest),
      };
      const res = await createLoad.mutateAsync(payload);
      const loadId = res.data.loadId;
      // Auto-post the load so it appears on the board
      try {
        await postLoad.mutateAsync(loadId);
        addToast({ type: 'success', title: 'Load created and posted!' });
      } catch {
        addToast({ type: 'info', title: 'Load created as draft', message: 'Post it to make it visible on the load board' });
      }
      router.push(`/shipper/loads/${loadId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create load';
      addToast({ type: 'error', title: 'Error', message });
    }
  };

  const cargoOptions = cargoTypes.map((ct) => ({
    value: ct,
    label: cargoTypeLabels[ct] ?? ct,
  }));

  return (
    <div className="animate-in max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Create New Load</h1>
        <p className="text-sm text-gray-400 mt-1">Fill in the shipment details</p>
      </div>

      <form data-testid="create-load-form" onSubmit={handleSubmit(onSubmit as never)} className="space-y-6">
        {/* Cargo Details */}
        <Card>
          <h2 className="text-lg font-semibold text-white mb-4">Cargo Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Select
              label="Cargo Type"
              options={cargoOptions}
              placeholder="Select type..."
              error={errors.cargoType?.message}
              {...register('cargoType')}
            />
            <Input
              label="Commodity"
              placeholder="e.g. Electronics"
              error={errors.commodity?.message}
              {...register('commodity')}
            />
            <Input
              label="Weight (lbs)"
              type="number"
              placeholder="40000"
              error={errors.weightLbs?.message}
              {...register('weightLbs')}
            />
            <Input
              label="Trucks Required"
              type="number"
              min={1}
              max={100}
              placeholder="1"
              error={errors.totalTrucksRequired?.message}
              hint="For multi-truck loads"
              {...register('totalTrucksRequired')}
            />
            <Input
              label="Offered Rate (USD)"
              type="number"
              placeholder="5000"
              error={errors.offeredRateUsd?.message}
              {...register('offeredRateUsd')}
            />
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  data-testid="hazmat-toggle"
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500"
                  {...register('isHazmat')}
                />
                <span className="text-sm text-gray-300">Hazmat Load</span>
              </label>
            </div>
            {isHazmat && (
              <Input
                label="Hazmat Class"
                placeholder="e.g. 1.1"
                error={errors.hazmatClass?.message}
                {...register('hazmatClass')}
              />
            )}
          </div>
        </Card>

        {/* Pickup Location */}
        <Card>
          <h2 className="text-lg font-semibold text-white mb-4">Pickup Location</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2 lg:col-span-3">
              <Input
                label="Address"
                placeholder="123 Industrial Blvd"
                error={errors.pickupAddress?.message}
                {...register('pickupAddress')}
              />
            </div>
            <Input
              label="City"
              placeholder="Chicago"
              error={errors.pickupCity?.message}
              {...register('pickupCity')}
            />
            <Input
              label="State"
              placeholder="IL"
              maxLength={2}
              error={errors.pickupState?.message}
              {...register('pickupState')}
            />
            <Input
              label="ZIP"
              placeholder="60601"
              error={errors.pickupZip?.message}
              {...register('pickupZip')}
            />
            <Input
              label="Latitude"
              type="number"
              step="any"
              placeholder="41.8781"
              error={errors.pickupLat?.message}
              {...register('pickupLat')}
            />
            <Input
              label="Longitude"
              type="number"
              step="any"
              placeholder="-87.6298"
              error={errors.pickupLng?.message}
              {...register('pickupLng')}
            />
            <Input
              label="Earliest Pickup"
              type="datetime-local"
              error={errors.pickupEarliest?.message}
              {...register('pickupEarliest')}
            />
            <Input
              label="Latest Pickup"
              type="datetime-local"
              error={errors.pickupLatest?.message}
              {...register('pickupLatest')}
            />
            <Input
              label="Contact Name"
              placeholder="Optional"
              error={errors.pickupContactName?.message}
              {...register('pickupContactName')}
            />
            <Input
              label="Contact Phone"
              placeholder="Optional"
              error={errors.pickupContactPhone?.message}
              {...register('pickupContactPhone')}
            />
            <div className="sm:col-span-2 lg:col-span-3">
              <Input
                label="Pickup Instructions"
                placeholder="Optional"
                error={errors.pickupInstructions?.message}
                {...register('pickupInstructions')}
              />
            </div>
          </div>
        </Card>

        {/* Dropoff Location */}
        <Card>
          <h2 className="text-lg font-semibold text-white mb-4">Dropoff Location</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2 lg:col-span-3">
              <Input
                label="Address"
                placeholder="456 Distribution Way"
                error={errors.dropoffAddress?.message}
                {...register('dropoffAddress')}
              />
            </div>
            <Input
              label="City"
              placeholder="Memphis"
              error={errors.dropoffCity?.message}
              {...register('dropoffCity')}
            />
            <Input
              label="State"
              placeholder="TN"
              maxLength={2}
              error={errors.dropoffState?.message}
              {...register('dropoffState')}
            />
            <Input
              label="ZIP"
              placeholder="38118"
              error={errors.dropoffZip?.message}
              {...register('dropoffZip')}
            />
            <Input
              label="Latitude"
              type="number"
              step="any"
              placeholder="35.1495"
              error={errors.dropoffLat?.message}
              {...register('dropoffLat')}
            />
            <Input
              label="Longitude"
              type="number"
              step="any"
              placeholder="-90.0490"
              error={errors.dropoffLng?.message}
              {...register('dropoffLng')}
            />
            <Input
              label="Earliest Dropoff"
              type="datetime-local"
              error={errors.dropoffEarliest?.message}
              {...register('dropoffEarliest')}
            />
            <Input
              label="Latest Dropoff"
              type="datetime-local"
              error={errors.dropoffLatest?.message}
              {...register('dropoffLatest')}
            />
            <Input
              label="Contact Name"
              placeholder="Optional"
              error={errors.dropoffContactName?.message}
              {...register('dropoffContactName')}
            />
            <Input
              label="Contact Phone"
              placeholder="Optional"
              error={errors.dropoffContactPhone?.message}
              {...register('dropoffContactPhone')}
            />
            <div className="sm:col-span-2 lg:col-span-3">
              <Input
                label="Dropoff Instructions"
                placeholder="Optional"
                error={errors.dropoffInstructions?.message}
                {...register('dropoffInstructions')}
              />
            </div>
          </div>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-3 justify-end">
          <Button data-testid="create-load-cancel" type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button data-testid="create-load-submit" type="submit" loading={isSubmitting} size="lg">
            Create & Post Load
          </Button>
        </div>
      </form>
    </div>
  );
}
