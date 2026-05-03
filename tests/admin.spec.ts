import { test, expect } from '../fixtures/auth.fixture';
import { buildOrganizationData, installDialogTrap, securityPayloads } from '../fixtures/testData';
import {
  assertJsonResponse,
  createOrganizationResponseSchema,
  errorResponseSchema,
  expectJsonResponse,
  loadResponseSchema,
  loadsResponseSchema,
  organizationsResponseSchema,
  organizationResponseSchema,
  bidsResponseSchema,
  slotSummaryResponseSchema,
} from '../utils/apiHelper';
import { expectRedirectToLogin, waitForPath } from '../utils/waitHelper';

test.describe('Admin Coverage', () => {
  test.describe.configure({ mode: 'parallel' });

  test('admin can traverse admin pages and inspect a load detail', async ({ page, auth, dashboardPage }) => {
    await auth.signInAs('admin');

    const loadsPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads(?:\?|$)/i.test(response.url());
    });
    await dashboardPage.navigate('All Loads');
    await waitForPath(page, '/admin/loads');
    await assertJsonResponse(await loadsPromise, loadsResponseSchema, 200);

    const loadDetailPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads\/[0-9a-f-]+$/i.test(response.url());
    });
    const slotsPromise = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && /\/api\/v1\/loads\/[0-9a-f-]+\/slots$/i.test(response.url());
    });
    await page.locator('main a[href^="/admin/loads/"]').first().click();
    await assertJsonResponse(await loadDetailPromise, loadResponseSchema, 200);
    await assertJsonResponse(await slotsPromise, slotSummaryResponseSchema, 200);

    await dashboardPage.navigate('Bookings Audit');
    await waitForPath(page, '/admin/bookings');
    await expect(page.getByRole('heading', { name: /Bookings Audit/i })).toBeVisible();
    await expect(page.getByText(/No bids recorded|Total Bids/i).first()).toBeVisible();

    await dashboardPage.navigate('Organizations');
    await waitForPath(page, '/admin/orgs');
    await expect(page.getByRole('heading', { name: /Organizations/i })).toBeVisible();
  });

  test('admin can create an organization and xss-like input is rendered as inert text', async ({ page, auth, dashboardPage }) => {
    const dialogTrap = await installDialogTrap(page);
    const organization = buildOrganizationData({
      name: `${securityPayloads.xss} Playwright Carrier ${Date.now()}`,
    });

    await auth.signInAs('admin');
    await dashboardPage.navigate('Organizations');
    await waitForPath(page, '/admin/orgs');

    await page.getByTestId('toggle-org-form').click();
    await page.getByLabel('Name').fill(organization.name);
    await page.getByLabel('Type').selectOption(organization.orgType);
    await page.getByLabel('Contact Email').fill(organization.contactEmail);
    await page.getByLabel('Contact Phone').fill(organization.contactPhone);
    await page.getByLabel('DOT Number').fill(organization.dotNumber);
    await page.getByLabel('MC Number').fill(organization.mcNumber);

    const response = await expectJsonResponse({
      page,
      method: 'POST',
      url: /\/api\/v1\/organizations$/i,
      expectedStatus: 201,
      schema: createOrganizationResponseSchema,
      trigger: () => page.getByTestId('create-org-submit').click(),
    });

    expect(response.data.data.orgId).toBeTruthy();
    await expect(page.getByText(organization.name, { exact: false })).toBeVisible();
    expect(dialogTrap.wasTriggered()).toBe(false);
  });

  test('oversized admin input is blocked client-side and non-admin users are redirected away', async ({ page, auth, dashboardPage }) => {
    await auth.signInAs('admin');
    await dashboardPage.navigate('Organizations');
    await waitForPath(page, '/admin/orgs');
    await page.getByTestId('toggle-org-form').click();

    await page.getByLabel('Name').fill(securityPayloads.oversizedName);
    await page.getByLabel('Type').selectOption('CARRIER');
    await page.getByLabel('Contact Email').fill('oversized@playwright.test');

    await page.getByTestId('create-org-submit').click();
    await expect(page.getByText(/too big|at most|max/i).first()).toBeVisible();

    const shipper = await auth.newAuthenticatedPage(page.context().browser()!, 'shipper');
    await shipper.page.goto('/admin/dashboard');
    await waitForPath(shipper.page, '/shipper/dashboard');
    await shipper.context.close();
  });
});