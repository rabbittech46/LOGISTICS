import { expect, type Page } from '@playwright/test';
import type { CreateLoadFormInput } from '../fixtures/testData';

export class BookingPage {
  constructor(private readonly page: Page) {}

  async createLoad(data: CreateLoadFormInput): Promise<void> {
    const form = this.page.getByTestId('create-load-form');

    await form.locator('[name="cargoType"]').selectOption(data.cargoType);
    await form.locator('[name="commodity"]').fill(data.commodity);
    await form.locator('[name="weightLbs"]').fill(data.weightLbs);
    await form.locator('[name="totalTrucksRequired"]').fill(data.totalTrucksRequired);
    await form.locator('[name="offeredRateUsd"]').fill(data.offeredRateUsd);

    if (data.isHazmat) {
      await this.page.getByTestId('hazmat-toggle').check();
      if (data.hazmatClass) {
        await form.locator('[name="hazmatClass"]').fill(data.hazmatClass);
      }
    }

    await form.locator('[name="pickupAddress"]').fill(data.pickupAddress);
    await form.locator('[name="pickupCity"]').fill(data.pickupCity);
    await form.locator('[name="pickupState"]').fill(data.pickupState);
    await form.locator('[name="pickupZip"]').fill(data.pickupZip);
    await form.locator('[name="pickupLat"]').fill(data.pickupLat);
    await form.locator('[name="pickupLng"]').fill(data.pickupLng);
    await form.locator('[name="pickupEarliest"]').fill(data.pickupEarliest);
    await form.locator('[name="pickupLatest"]').fill(data.pickupLatest);
    await form.locator('[name="pickupContactName"]').fill(data.pickupContactName);
    await form.locator('[name="pickupContactPhone"]').fill(data.pickupContactPhone);
    await form.locator('[name="pickupInstructions"]').fill(data.pickupInstructions);

    await form.locator('[name="dropoffAddress"]').fill(data.dropoffAddress);
    await form.locator('[name="dropoffCity"]').fill(data.dropoffCity);
    await form.locator('[name="dropoffState"]').fill(data.dropoffState);
    await form.locator('[name="dropoffZip"]').fill(data.dropoffZip);
    await form.locator('[name="dropoffLat"]').fill(data.dropoffLat);
    await form.locator('[name="dropoffLng"]').fill(data.dropoffLng);
    await form.locator('[name="dropoffEarliest"]').fill(data.dropoffEarliest);
    await form.locator('[name="dropoffLatest"]').fill(data.dropoffLatest);
    await form.locator('[name="dropoffContactName"]').fill(data.dropoffContactName);
    await form.locator('[name="dropoffContactPhone"]').fill(data.dropoffContactPhone);
    await form.locator('[name="dropoffInstructions"]').fill(data.dropoffInstructions);

    const submitButton = this.page.getByTestId('create-load-submit');
    await submitButton.scrollIntoViewIfNeeded();
    await submitButton.click();
  }

  async cancelCurrentLoad(): Promise<void> {
    await this.page.getByTestId('cancel-load-button').click();
  }

  async placeBid(amount: string, notes: string): Promise<void> {
    const select = this.page.getByTestId('carrier-truck-select');
    await expect(select.locator('option').nth(1)).toHaveAttribute('value', /.+/);
    const optionValue = await select.locator('option').nth(1).getAttribute('value');

    expect(optionValue, 'Expected at least one available truck in carrier bid flow').toBeTruthy();
    await select.selectOption(optionValue!);
    await this.page.getByTestId('carrier-bid-amount').fill(amount);
    await this.page.getByTestId('carrier-bid-notes').fill(notes);
    await this.page.getByTestId('submit-bid-button').click();
  }

  async reserveSlot(clickCount = 1): Promise<void> {
    await this.page.getByTestId('reserve-slot-button').click({ clickCount });
  }

  async confirmBooking(agreedRate = '5400'): Promise<void> {
    const select = this.page.getByTestId('driver-truck-select');
    await expect(select.locator('option').nth(1)).toHaveAttribute('value', /.+/);
    const optionValue = await select.locator('option').nth(1).getAttribute('value');

    expect(optionValue, 'Expected at least one available truck in booking flow').toBeTruthy();
    await select.selectOption(optionValue!);
    await this.page.getByTestId('driver-agreed-rate').fill(agreedRate);
    await this.page.getByTestId('confirm-booking-button').click();
  }

  async releaseReservation(): Promise<void> {
    await this.page.getByTestId('release-slot-button').click();
  }
}