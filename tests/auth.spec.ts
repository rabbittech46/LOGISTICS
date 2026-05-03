import { test, expect } from '../fixtures/auth.fixture';
import { buildPersistedAuthState, buildRegistrationData, protectedRoutes, roleAccounts } from '../fixtures/testData';
import {
  errorResponseSchema,
  expectJsonResponse,
  loginResponseSchema,
  refreshResponseSchema,
  registerResponseSchema,
} from '../utils/apiHelper';
import { expectRedirectToLogin, waitForPath } from '../utils/waitHelper';

test.describe('Authentication', () => {
  test.describe.configure({ mode: 'serial' });

  test('signup creates a new account and redirects back to login', async ({ page, loginPage }) => {
    const user = buildRegistrationData();

    await loginPage.gotoRegister();
    const { data } = await expectJsonResponse({
      page,
      method: 'POST',
      url: /\/api\/v1\/auth\/register$/i,
      expectedStatus: 201,
      schema: registerResponseSchema,
      trigger: () => loginPage.register(user),
    });

    expect(data.data.userId).toBeTruthy();
    await expect(page).toHaveURL(/\/login\?registered=1$/i);
  });

  test('login rejects invalid credentials and exposes the API error', async ({ page, loginPage }) => {
    await loginPage.goto();

    const { data } = await expectJsonResponse({
      page,
      method: 'POST',
      url: /\/api\/v1\/auth\/login$/i,
      expectedStatus: [400, 401],
      schema: errorResponseSchema,
      trigger: () => loginPage.login(roleAccounts.shipper.email, 'WrongPassword123!'),
    });

    await expect(loginPage.errorBanner()).toBeVisible();
    expect(data.error).toMatch(/invalid|login|credential/i);
  });

  test('login persists the session and silently refreshes access after reload', async ({ page, loginPage, dashboardPage }) => {
    await loginPage.goto();
    const { data } = await expectJsonResponse({
      page,
      method: 'POST',
      url: /\/api\/v1\/auth\/login$/i,
      expectedStatus: 200,
      schema: loginResponseSchema,
      trigger: () => loginPage.login(roleAccounts.shipper.email, roleAccounts.shipper.password),
    });

    expect(data.data.user.email).toBe(roleAccounts.shipper.email);
    await waitForPath(page, roleAccounts.shipper.landingPath);

    const refresh = await expectJsonResponse({
      page,
      method: 'POST',
      url: /\/api\/v1\/auth\/refresh$/i,
      expectedStatus: 200,
      schema: refreshResponseSchema,
      trigger: () => page.reload(),
    });

    expect(refresh.data.data.accessToken).toBeTruthy();
    await waitForPath(page, roleAccounts.shipper.landingPath);

    await dashboardPage.logout();
    await expectRedirectToLogin(page);
  });

  test('missing refresh token forces the app back to login on reload', async ({ page }) => {
    await page.addInitScript(
      `localStorage.setItem('logistics-auth', ${JSON.stringify(buildPersistedAuthState('shipper'))});`,
    );

    const refresh = await expectJsonResponse({
      page,
      method: 'POST',
      url: /\/api\/v1\/auth\/refresh$/i,
      expectedStatus: [400, 401],
      schema: errorResponseSchema,
      trigger: () => page.goto(roleAccounts.shipper.landingPath),
    });

    expect(refresh.data.error).toMatch(/validation|unauthorized|token/i);
    await expectRedirectToLogin(page);
  });

  test('protected routes redirect unauthenticated users to login', async ({ page }) => {
    for (const route of protectedRoutes) {
      await page.goto(route);
      await expectRedirectToLogin(page);
    }
  });
});