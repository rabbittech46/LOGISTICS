import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { ApiHelper, type RoleSession } from '../utils/apiHelper';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { BookingPage } from '../pages/BookingPage';
import { appConfig, roleAccounts, type TestRole } from './testData';
import { waitForPath } from '../utils/waitHelper';

interface AuthController {
  signInAs: (role: TestRole) => Promise<RoleSession>;
  newAuthenticatedPage: (browser: Browser, role: TestRole) => Promise<{ context: BrowserContext; page: Page; session: RoleSession }>;
}

type TestFixtures = {
  apiHelper: ApiHelper;
  auth: AuthController;
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
  bookingPage: BookingPage;
};

export const test = base.extend<TestFixtures>({
  apiHelper: async ({ request }, use) => {
    await use(new ApiHelper(request));
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },

  bookingPage: async ({ page }, use) => {
    await use(new BookingPage(page));
  },

  auth: async ({ page, browser, apiHelper }, use) => {
    const applySession = async (targetPage: Page, role: TestRole): Promise<RoleSession> => {
      const session = await apiHelper.authenticate(role);
      const { landingPath } = roleAccounts[role];

      await targetPage.context().addCookies([session.refreshCookie]);
      await targetPage.route(/\/api\/v1\/auth\/refresh$/i, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              accessToken: session.accessToken,
              expiresIn: 900,
            },
          }),
        });
      });
      await targetPage.addInitScript(
        `localStorage.setItem('logistics-auth', ${JSON.stringify(session.storageStateValue)});`,
      );
      await targetPage.goto(landingPath);
      await waitForPath(targetPage, landingPath);

      return session;
    };

    await use({
      signInAs: async (role) => {
        return applySession(page, role);
      },

      newAuthenticatedPage: async (targetBrowser, role) => {
        const context = await targetBrowser.newContext({
          baseURL: appConfig.baseUrl,
          ignoreHTTPSErrors: true,
        });
        const targetPage = await context.newPage();
        const session = await applySession(targetPage, role);
        return { context, page: targetPage, session };
      },
    });
  },

  page: async ({ page }, use, testInfo) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const apiResponses: string[] = [];

    page.on('console', (message) => {
      const isNetworkNoise = message.text().startsWith('Failed to load resource:');
      const isTrackingSocketNoise =
        message.text().startsWith("WebSocket connection to 'wss://localhost/ws/") &&
        message.text().includes('Unexpected response code: 502');

      if (message.type() === 'error' && !isNetworkNoise && !isTrackingSocketNoise) {
        consoleErrors.push(message.text());
      }
    });

    page.on('pageerror', (error) => {
      pageErrors.push(error.message);
    });

    page.on('response', (response) => {
      if (response.url().includes('/api/v1/')) {
        apiResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    await use(page);

    if (apiResponses.length > 0) {
      await testInfo.attach('api-responses', {
        body: apiResponses.join('\n'),
        contentType: 'text/plain',
      });
    }

    if (consoleErrors.length > 0) {
      await testInfo.attach('console-errors', {
        body: consoleErrors.join('\n'),
        contentType: 'text/plain',
      });
    }

    if (pageErrors.length > 0) {
      await testInfo.attach('page-errors', {
        body: pageErrors.join('\n'),
        contentType: 'text/plain',
      });
    }

    expect.soft(consoleErrors, 'Console errors were emitted during the test run').toEqual([]);
    expect.soft(pageErrors, 'Unhandled page errors were emitted during the test run').toEqual([]);
  },
});

export { expect };