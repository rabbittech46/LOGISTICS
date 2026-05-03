import { test, expect } from '../fixtures/auth.fixture';
import { buildLoadFormInput, roleAccounts, smokePages } from '../fixtures/testData';
import {
  assertJsonResponse,
  assignmentsResponseSchema,
  bidsResponseSchema,
  createLoadResponseSchema,
  loadResponseSchema,
  loadsResponseSchema,
  driversResponseSchema,
  messageResponseSchema,
  mySlotResponseSchema,
  slotSummaryResponseSchema,
  trucksResponseSchema,
} from '../utils/apiHelper';
import { expectHeading, expectRedirectToLogin, waitForPath } from '../utils/waitHelper';

test.describe('User Flows', () => {
  test.describe.configure({ mode: 'parallel' });

  test('shipper can create, post, inspect, cancel, and navigate the product shell', async ({ page, auth, dashboardPage, bookingPage }) => {
    const loadInput = buildLoadFormInput();

    await auth.signInAs('shipper');
    await expectHeading(page, smokePages.shipper[0].heading);

    await dashboardPage.navigate('Create Load');
    await waitForPath(page, '/shipper/loads/new');

    const createResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === 'POST' && /\/api\/v1\/loads$/i.test(response.url());
    }, { timeout: 45_000 });
    const postResponsePromise = page.waitForResponse((response) => {
      return response.request().method() === 'POST' && /\/api\/v1\/loads\/[0-9a-f-]+\/post$/i.test(response.url());
    }, { timeout: 45_000 });

    await bookingPage.createLoad(loadInput);

    const createResponse = await assertJsonResponse(await createResponsePromise, createLoadResponseSchema, 201);
    const postResponse = await assertJsonResponse(await postResponsePromise, loadResponseSchema, 200);

    expect(postResponse.data.id).toBe(createResponse.data.loadId);
    await page.waitForURL(/\/shipper\/loads\/[0-9a-f-]+$/i);
    await expect(page.getByText(/POSTED/i).first()).toBeVisible();

    const cancelPromise = page.waitForResponse((response) => {
      return response.request().method() === 'POST' && /\/api\/v1\/loads\/[0-9a-f-]+\/cancel$/i.test(response.url());
    });
    await bookingPage.cancelCurrentLoad();
    await assertJsonResponse(await cancelPromise, messageResponseSchema, 200);
    await expect(page.getByText(/CANCELLED/i).first()).toBeVisible();

    const loadsPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads(?:\?|$)/i.test(response.url());
    });
    await dashboardPage.navigate('My Loads');
    await waitForPath(page, '/shipper/loads');
    await assertJsonResponse(await loadsPromise, loadsResponseSchema, 200);

    const trackingPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads\?status=IN_TRANSIT/i.test(response.url());
    });
    await dashboardPage.navigate('Live Tracking');
    await waitForPath(page, '/shipper/tracking');
    await assertJsonResponse(await trackingPromise, loadsResponseSchema, 200);
    await expectHeading(page, /Live Tracking/i);

    await dashboardPage.logout();
    await expectRedirectToLogin(page);
  });

  test('carrier can traverse all carrier pages, inspect a load, and use filters safely', async ({ page, auth, dashboardPage }) => {
    await auth.signInAs('carrier');

    const loadBoardPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads\/board(?:\?|$)/i.test(response.url());
    });
    await dashboardPage.navigate('Load Board');
    await waitForPath(page, '/carrier/loads');
    await assertJsonResponse(await loadBoardPromise, loadsResponseSchema, 200);
    await expectHeading(page, /Available Loads/i);

    const loadDetailPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads\/[0-9a-f-]+$/i.test(response.url());
    });
    const slotPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads\/[0-9a-f-]+\/slots$/i.test(response.url());
    });
    const bidListPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/bids\/load\/[0-9a-f-]+$/i.test(response.url());
    });
    const trucksPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/trucks\?status=AVAILABLE/i.test(response.url());
    });

    await page.locator('main a[href^="/carrier/loads/"]').first().click();
    await assertJsonResponse(await loadDetailPromise, loadResponseSchema, 200);
    await assertJsonResponse(await slotPromise, slotSummaryResponseSchema, 200);
    await assertJsonResponse(await bidListPromise, bidsResponseSchema, 200);
    await assertJsonResponse(await trucksPromise, trucksResponseSchema, 200);
    await expect(page.getByRole('heading').first()).toBeVisible();

    await page.goto('/carrier/loads');
    await waitForPath(page, '/carrier/loads');
    const filteredPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /pickupState=ZZ/i.test(response.url());
    });
    await page.getByTestId('carrier-state-filter').fill('ZZ');
    const filteredLoads = await assertJsonResponse(await filteredPromise, loadsResponseSchema, 200);
    expect(filteredLoads.data).toHaveLength(0);
    await expect(page.getByText(/No loads available/i)).toBeVisible();

    const fleetPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/trucks(?:\?|$)/i.test(response.url());
    });
    await dashboardPage.navigate('Fleet');
    await waitForPath(page, '/carrier/fleet');
    await assertJsonResponse(await fleetPromise, trucksResponseSchema, 200);

    const driversPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/drivers(?:\?|$)/i.test(response.url());
    });
    await dashboardPage.navigate('Drivers');
    await waitForPath(page, '/carrier/drivers');
    await assertJsonResponse(await driversPromise, driversResponseSchema, 200);

    const bidsPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/bids(?:\?|$)/i.test(response.url());
    });
    await dashboardPage.navigate('Bids');
    await waitForPath(page, '/carrier/bids');
    await assertJsonResponse(await bidsPromise, bidsResponseSchema, 200);

    const assignmentsPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/assignments(?:\?|$)/i.test(response.url());
    });
    await dashboardPage.navigate('Trips');
    await waitForPath(page, '/carrier/trips');
    await assertJsonResponse(await assignmentsPromise, assignmentsResponseSchema, 200);
  });

  test('driver can traverse pages, filter the board to an empty state, and open a load detail', async ({ page, auth, dashboardPage }) => {
    await auth.signInAs('driver');
    await waitForPath(page, roleAccounts.driver.landingPath);

    const loadDetailPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads\/[0-9a-f-]+$/i.test(response.url());
    });
    const slotPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads\/[0-9a-f-]+\/slots$/i.test(response.url());
    });
    const mySlotPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads\/[0-9a-f-]+\/my-slot$/i.test(response.url());
    });
    const trucksPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/trucks\?status=AVAILABLE/i.test(response.url());
    });

    await page.locator('main a[href^="/driver/loads/"]').first().click();
    await assertJsonResponse(await loadDetailPromise, loadResponseSchema, 200);
    await assertJsonResponse(await slotPromise, slotSummaryResponseSchema, 200);
    await assertJsonResponse(await mySlotPromise, mySlotResponseSchema, 200);
    await assertJsonResponse(await trucksPromise, trucksResponseSchema, 200);

    await page.goto('/driver/loads');
    await waitForPath(page, '/driver/loads');
    const filteredPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /pickupState=ZZ/i.test(response.url());
    });
    await page.getByTestId('driver-state-filter').fill('ZZ');
    const filteredLoads = await assertJsonResponse(await filteredPromise, loadsResponseSchema, 200);
    expect(filteredLoads.data).toHaveLength(0);
    await expect(page.getByText(/No loads available/i)).toBeVisible();

    const bookingsPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/assignments(?:\?|$)/i.test(response.url());
    });
    await dashboardPage.navigate('My Bookings');
    await waitForPath(page, '/driver/bookings');
    await assertJsonResponse(await bookingsPromise, assignmentsResponseSchema, 200);

    await dashboardPage.navigate('My Trips');
    await waitForPath(page, '/driver/trips');
    await expectHeading(page, /My Trips/i);
    await expect(page.getByText(/No active trips|Load:/i).first()).toBeVisible();
  });
});