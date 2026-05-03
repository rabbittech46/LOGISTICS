import { expect, type Page } from '@playwright/test';

const navTestIds: Record<string, string> = {
  Dashboard: 'nav-admin-dashboard',
  'All Loads': 'nav-admin-loads',
  'Bookings Audit': 'nav-admin-bookings',
  Organizations: 'nav-admin-orgs',
  'Create Load': 'nav-shipper-loads-new',
  'My Loads': 'nav-shipper-loads',
  'Live Tracking': 'nav-shipper-tracking',
  'Load Board': 'nav-carrier-loads',
  Fleet: 'nav-carrier-fleet',
  Drivers: 'nav-carrier-drivers',
  Bids: 'nav-carrier-bids',
  Trips: 'nav-carrier-trips',
  'My Bookings': 'nav-driver-bookings',
  'My Trips': 'nav-driver-trips',
};

export class DashboardPage {
  constructor(private readonly page: Page) {}

  async navigate(label: string): Promise<void> {
    const testId = navTestIds[label];
    if (testId) {
      const link = this.page.getByTestId(testId).first();
      await expect(link).toBeVisible();
      await link.click({ force: true });
      return;
    }

    await this.page.getByRole('link', { name: label, exact: true }).click({ force: true });
  }

  async logout(): Promise<void> {
    const button = this.page.getByTestId('logout-button').first();
    await expect(button).toBeVisible();
    await button.click();
  }

  async openFirstLinkInMain(): Promise<void> {
    const firstLink = this.page.locator('main a[href]').first();
    await expect(firstLink).toBeVisible();
    await firstLink.click();
  }
}