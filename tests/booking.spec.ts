import { test, expect } from '../fixtures/auth.fixture';
import {
  assertJsonResponse,
  bidResponseSchema,
  bidsResponseSchema,
  bookingResponseSchema,
  createBidResponseSchema,
  expectJsonResponse,
  loadResponseSchema,
  loadsResponseSchema,
  mySlotResponseSchema,
  reserveResponseSchema,
  slotSummaryResponseSchema,
  trucksResponseSchema,
} from '../utils/apiHelper';
import { waitForPath, waitForToast } from '../utils/waitHelper';
import { BookingPage } from '../pages/BookingPage';

test.describe('Booking and Bidding', () => {
  test.describe.configure({ mode: 'serial' });

  test('driver can reserve and confirm a slot on a newly posted multi-truck load', async ({ page, auth, apiHelper, bookingPage }) => {
    const load = await apiHelper.createPostedLoad('admin', {
      cargoType: 'DRY_VAN',
      totalTrucksRequired: 2,
      weightLbs: 41000,
      offeredRateUsd: 5400,
    });
    await apiHelper.createAvailableTruck('carrier');

    await auth.signInAs('driver');

    const loadPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && new RegExp(`/api/v1/loads/${load.id}$`, 'i').test(response.url());
    });
    const slotsPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && new RegExp(`/api/v1/loads/${load.id}/slots$`, 'i').test(response.url());
    });
    const mySlotPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && new RegExp(`/api/v1/loads/${load.id}/my-slot$`, 'i').test(response.url());
    });
    const trucksPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/trucks\?status=AVAILABLE/i.test(response.url());
    });

    await page.goto(`/driver/loads/${load.id}`);
    await assertJsonResponse(await loadPromise, loadResponseSchema, 200);
    await assertJsonResponse(await slotsPromise, slotSummaryResponseSchema, 200);
    await assertJsonResponse(await mySlotPromise, mySlotResponseSchema, 200);
    await assertJsonResponse(await trucksPromise, trucksResponseSchema, 200);

    const reserve = await expectJsonResponse({
      page,
      method: 'POST',
      url: new RegExp(`/api/v1/loads/${load.id}/reserve$`, 'i'),
      expectedStatus: 201,
      schema: reserveResponseSchema,
      trigger: () => bookingPage.reserveSlot(),
    });

    expect(reserve.data.data.status).toBe('RESERVED');

    const confirm = await expectJsonResponse({
      page,
      method: 'POST',
      url: new RegExp(`/api/v1/loads/${load.id}/confirm$`, 'i'),
      expectedStatus: 200,
      schema: bookingResponseSchema,
      trigger: () => bookingPage.confirmBooking('5400'),
    });

    expect(confirm.data.data.loadId).toBe(load.id);
    await waitForToast(page, /Booking confirmed/i);
    await expect(page.getByText(/You're booked!/i)).toBeVisible();
  });

  test('rapid repeated reserve clicks do not create duplicate reservations', async ({ page, auth, apiHelper, bookingPage }) => {
    const load = await apiHelper.createPostedLoad('admin', {
      cargoType: 'DRY_VAN',
      totalTrucksRequired: 2,
      offeredRateUsd: 5200,
    });
    const reserveStatuses: number[] = [];

    page.on('response', (response) => {
      if (new RegExp(`/api/v1/loads/${load.id}/reserve$`, 'i').test(response.url())) {
        reserveStatuses.push(response.status());
      }
    });

    await auth.signInAs('driver');
    await page.goto(`/driver/loads/${load.id}`);

    await bookingPage.reserveSlot(3);
    await waitForToast(page, /reserved/i);

    await expect
      .poll(async () => {
        const mySlot = await apiHelper.requestAs('driver', {
          method: 'GET',
          path: `/api/v1/loads/${load.id}/my-slot`,
          schema: mySlotResponseSchema,
          expectedStatus: 200,
        });

        return mySlot.data.data && 'status' in mySlot.data.data ? mySlot.data.data.status : null;
      }, { timeout: 15_000 })
      .toBe('RESERVED');

    const slots = await apiHelper.requestAs('driver', {
      method: 'GET',
      path: `/api/v1/loads/${load.id}/slots`,
      schema: slotSummaryResponseSchema,
      expectedStatus: 200,
    });

    expect(slots.data.data.reservedSlots).toBe(1);
    expect(reserveStatuses.filter((status) => status === 201).length).toBeLessThanOrEqual(1);
  });

  test('carrier can place a bid and admin can audit it immediately', async ({ auth, apiHelper, page }) => {
    const load = await apiHelper.createPostedLoad('admin', {
      cargoType: 'DRY_VAN',
      totalTrucksRequired: 1,
      offeredRateUsd: 4900,
    });
    await apiHelper.createAvailableTruck('carrier');

    const carrier = await auth.newAuthenticatedPage(page.context().browser()!, 'carrier');
    const admin = await auth.newAuthenticatedPage(page.context().browser()!, 'admin');
    const carrierBookingPage = new BookingPage(carrier.page);

    try {
      await carrier.page.goto(`/carrier/loads/${load.id}`);
      const bid = await expectJsonResponse({
        page: carrier.page,
        method: 'POST',
        url: /\/api\/v1\/bids$/i,
        expectedStatus: 201,
        schema: createBidResponseSchema,
        trigger: () => carrierBookingPage.placeBid('5000', 'Playwright bid'),
      });

      expect(bid.data.data.bidId).toBeTruthy();

      const bidsList = await apiHelper.requestAs('carrier', {
        method: 'GET',
        path: `/api/v1/bids/load/${load.id}`,
        schema: bidsResponseSchema,
        expectedStatus: 200,
      });
      expect(bidsList.data.data.some((item) => item.load_id === load.id)).toBe(true);

      await admin.page.goto('/admin/bookings');
      await waitForPath(admin.page, '/admin/bookings');
      await expect(admin.page.getByText(load.id.slice(0, 10), { exact: false }).first()).toBeVisible();
    } finally {
      await carrier.context.close();
      await admin.context.close();
    }
  });

  test('network interruption during reservation shows an error and the retry succeeds', async ({ page, auth, apiHelper, bookingPage }) => {
    const load = await apiHelper.createPostedLoad('admin', {
      cargoType: 'DRY_VAN',
      totalTrucksRequired: 2,
      offeredRateUsd: 5300,
    });

    await auth.signInAs('driver');
    await page.goto(`/driver/loads/${load.id}`);

    await page.route(new RegExp(`/api/v1/loads/${load.id}/reserve$`, 'i'), async (route) => {
      await route.abort('failed');
    }, { times: 1 });

    await bookingPage.reserveSlot();
    await waitForToast(page, /Network error|Please try again|Reservation failed/i);

    const reserve = await expectJsonResponse({
      page,
      method: 'POST',
      url: new RegExp(`/api/v1/loads/${load.id}/reserve$`, 'i'),
      expectedStatus: 201,
      schema: reserveResponseSchema,
      trigger: () => bookingPage.reserveSlot(),
    });

    expect(reserve.data.data.status).toBe('RESERVED');
  });
});