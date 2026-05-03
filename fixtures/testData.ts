import type { Page } from '@playwright/test';

export type TestRole = 'admin' | 'shipper' | 'carrier' | 'driver';

export interface RoleAccount {
  email: string;
  password: string;
  landingPath: string;
}

export interface SeededUserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizations: Array<{
    orgId: string;
    orgName: string;
    role: 'PLATFORM_ADMIN' | 'ORG_ADMIN' | 'DISPATCHER' | 'DRIVER' | 'SHIPPER_STAFF';
    orgType: 'SHIPPER' | 'CARRIER';
  }>;
}

export interface RegistrationUser {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

export interface CreateLoadFormInput {
  cargoType: string;
  commodity: string;
  weightLbs: string;
  totalTrucksRequired: string;
  offeredRateUsd: string;
  isHazmat: boolean;
  hazmatClass?: string;
  pickupAddress: string;
  pickupCity: string;
  pickupState: string;
  pickupZip: string;
  pickupLat: string;
  pickupLng: string;
  pickupEarliest: string;
  pickupLatest: string;
  pickupContactName: string;
  pickupContactPhone: string;
  pickupInstructions: string;
  dropoffAddress: string;
  dropoffCity: string;
  dropoffState: string;
  dropoffZip: string;
  dropoffLat: string;
  dropoffLng: string;
  dropoffEarliest: string;
  dropoffLatest: string;
  dropoffContactName: string;
  dropoffContactPhone: string;
  dropoffInstructions: string;
}

export interface CreateLoadApiInput {
  cargoType: string;
  commodity: string;
  weightLbs: number;
  totalTrucksRequired: number;
  offeredRateUsd: number;
  isHazmat: boolean;
  hazmatClass?: string;
  pickupAddress: string;
  pickupCity: string;
  pickupState: string;
  pickupZip: string;
  pickupLat: number;
  pickupLng: number;
  pickupEarliest: string;
  pickupLatest: string;
  pickupContactName: string;
  pickupContactPhone: string;
  pickupInstructions: string;
  dropoffAddress: string;
  dropoffCity: string;
  dropoffState: string;
  dropoffZip: string;
  dropoffLat: number;
  dropoffLng: number;
  dropoffEarliest: string;
  dropoffLatest: string;
  dropoffContactName: string;
  dropoffContactPhone: string;
  dropoffInstructions: string;
}

export interface OrganizationInput {
  name: string;
  orgType: 'SHIPPER' | 'CARRIER';
  contactEmail: string;
  contactPhone: string;
  dotNumber: string;
  mcNumber: string;
}

export interface SmokePageDefinition {
  label: string;
  path: string;
  heading: RegExp;
  apiPattern?: RegExp;
}

export const appConfig = {
  baseUrl: process.env.PLAYWRIGHT_BASE_URL ?? 'https://localhost',
  apiUrl: process.env.PLAYWRIGHT_API_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'https://localhost',
  expectTimeout: Number.parseInt(process.env.PLAYWRIGHT_EXPECT_TIMEOUT ?? '15000', 10),
};

const defaultPassword = process.env.PLAYWRIGHT_DEFAULT_PASSWORD ?? 'Password123!';

export const roleAccounts: Record<TestRole, RoleAccount> = {
  admin: {
    email: process.env.PLAYWRIGHT_ADMIN_EMAIL ?? 'admin@rabbittech.test',
    password: process.env.PLAYWRIGHT_ADMIN_PASSWORD ?? defaultPassword,
    landingPath: '/admin/dashboard',
  },
  shipper: {
    email: process.env.PLAYWRIGHT_SHIPPER_EMAIL ?? 'alice@acmefreight.test',
    password: process.env.PLAYWRIGHT_SHIPPER_PASSWORD ?? defaultPassword,
    landingPath: '/shipper/dashboard',
  },
  carrier: {
    email: process.env.PLAYWRIGHT_CARRIER_EMAIL ?? 'charlie@roadrunner.test',
    password: process.env.PLAYWRIGHT_CARRIER_PASSWORD ?? defaultPassword,
    landingPath: '/carrier/dashboard',
  },
  driver: {
    email: process.env.PLAYWRIGHT_DRIVER_EMAIL ?? 'eddie@roadrunner.test',
    password: process.env.PLAYWRIGHT_DRIVER_PASSWORD ?? defaultPassword,
    landingPath: '/driver/loads',
  },
};

export const seededUsers: Record<TestRole, SeededUserProfile> = {
  admin: {
    id: 'c0000000-0000-0000-0000-000000000001',
    email: 'admin@rabbittech.test',
    firstName: 'Platform',
    lastName: 'Admin',
    organizations: [{
      orgId: 'a0000000-0000-0000-0000-000000000001',
      orgName: 'Acme Freight Corp',
      role: 'PLATFORM_ADMIN',
      orgType: 'SHIPPER',
    }],
  },
  shipper: {
    id: 'c0000000-0000-0000-0000-000000000002',
    email: 'alice@acmefreight.test',
    firstName: 'Alice',
    lastName: 'Morgan',
    organizations: [{
      orgId: 'a0000000-0000-0000-0000-000000000001',
      orgName: 'Acme Freight Corp',
      role: 'ORG_ADMIN',
      orgType: 'SHIPPER',
    }],
  },
  carrier: {
    id: 'c0000000-0000-0000-0000-000000000004',
    email: 'charlie@roadrunner.test',
    firstName: 'Charlie',
    lastName: 'Vega',
    organizations: [{
      orgId: 'b0000000-0000-0000-0000-000000000001',
      orgName: 'RoadRunner Logistics',
      role: 'ORG_ADMIN',
      orgType: 'CARRIER',
    }],
  },
  driver: {
    id: 'c0000000-0000-0000-0000-000000000006',
    email: 'eddie@roadrunner.test',
    firstName: 'Eddie',
    lastName: 'Reyes',
    organizations: [{
      orgId: 'b0000000-0000-0000-0000-000000000001',
      orgName: 'RoadRunner Logistics',
      role: 'DRIVER',
      orgType: 'CARRIER',
    }],
  },
};

export const securityPayloads = {
  xss: '<img src=x onerror=window.__pwXssTriggered=true />',
  oversizedName: 'X'.repeat(220),
  oversizedCommodity: 'C'.repeat(240),
};

export const protectedRoutes = [
  '/admin/dashboard',
  '/shipper/dashboard',
  '/carrier/dashboard',
  '/driver/loads',
];

export const smokePages: Record<'shipper' | 'carrier' | 'driver' | 'admin', SmokePageDefinition[]> = {
  shipper: [
    { label: 'Dashboard', path: '/shipper/dashboard', heading: /Shipper Dashboard/i, apiPattern: /\/api\/v1\/loads(?:\?|$)/i },
    { label: 'Create Load', path: '/shipper/loads/new', heading: /Create New Load/i },
    { label: 'My Loads', path: '/shipper/loads', heading: /My Loads/i, apiPattern: /\/api\/v1\/loads(?:\?|$)/i },
    { label: 'Live Tracking', path: '/shipper/tracking', heading: /Live Tracking/i, apiPattern: /\/api\/v1\/loads\?status=IN_TRANSIT/i },
  ],
  carrier: [
    { label: 'Dashboard', path: '/carrier/dashboard', heading: /Carrier Dashboard/i, apiPattern: /\/api\/v1\/(trucks|drivers|bids|assignments)/i },
    { label: 'Load Board', path: '/carrier/loads', heading: /Available Loads/i, apiPattern: /\/api\/v1\/loads\/board(?:\?|$)/i },
    { label: 'Fleet', path: '/carrier/fleet', heading: /Fleet Management/i, apiPattern: /\/api\/v1\/trucks(?:\?|$)/i },
    { label: 'Drivers', path: '/carrier/drivers', heading: /Drivers/i, apiPattern: /\/api\/v1\/drivers(?:\?|$)/i },
    { label: 'Bids', path: '/carrier/bids', heading: /Bid Management/i, apiPattern: /\/api\/v1\/bids(?:\?|$)/i },
    { label: 'Trips', path: '/carrier/trips', heading: /Trips/i, apiPattern: /\/api\/v1\/assignments(?:\?|$)/i },
  ],
  driver: [
    { label: 'Load Board', path: '/driver/loads', heading: /Load Board/i, apiPattern: /\/api\/v1\/loads\/board(?:\?|$)/i },
    { label: 'My Bookings', path: '/driver/bookings', heading: /My Bookings/i, apiPattern: /\/api\/v1\/assignments(?:\?|$)/i },
    { label: 'My Trips', path: '/driver/trips', heading: /My Trips/i, apiPattern: /\/api\/v1\/assignments(?:\?|$)/i },
  ],
  admin: [
    { label: 'Dashboard', path: '/admin/dashboard', heading: /Platform Overview/i, apiPattern: /\/api\/v1\/(organizations|loads|bids)/i },
    { label: 'All Loads', path: '/admin/loads', heading: /All Loads/i, apiPattern: /\/api\/v1\/loads(?:\?|$)/i },
    { label: 'Bookings Audit', path: '/admin/bookings', heading: /Bookings Audit/i, apiPattern: /\/api\/v1\/bids(?:\?|$)/i },
    { label: 'Organizations', path: '/admin/orgs', heading: /Organizations/i, apiPattern: /\/api\/v1\/organizations(?:\?|$)/i },
  ],
};

export function buildPersistedAuthState(role: TestRole): string {
  const user = seededUsers[role];

  return JSON.stringify({
    state: {
      user,
      activeOrg: user.organizations[0],
      isAuthenticated: true,
    },
    version: 0,
  });
}

export function buildRegistrationData(overrides: Partial<RegistrationUser> = {}): RegistrationUser {
  const nonce = uniqueSuffix();
  const phone = uniquePhoneNumber();

  return {
    firstName: 'Playwright',
    lastName: 'Tester',
    email: `playwright.user.${nonce}@rabbittech.test`,
    phone,
    password: 'Password123!',
    ...overrides,
  };
}

export function buildOrganizationData(overrides: Partial<OrganizationInput> = {}): OrganizationInput {
  const nonce = uniqueSuffix();
  const contactPhone = uniquePhoneNumber();
  const dotSuffix = `${Date.now()}`.slice(-4);

  return {
    name: `Playwright Logistics ${nonce}`,
    orgType: 'CARRIER',
    contactEmail: `ops+${nonce}@playwright-logistics.test`,
    contactPhone,
    dotNumber: `${9000000 + Number.parseInt(dotSuffix, 10)}`,
    mcNumber: `MC-${nonce.slice(-6)}`,
    ...overrides,
  };
}

export function buildLoadFormInput(overrides: Partial<CreateLoadFormInput> = {}): CreateLoadFormInput {
  const nonce = uniqueSuffix();
  const pickupEarliest = futureDateTimeLocal(2);
  const pickupLatest = futureDateTimeLocal(8);
  const dropoffEarliest = futureDateTimeLocal(30);
  const dropoffLatest = futureDateTimeLocal(36);

  return {
    cargoType: 'DRY_VAN',
    commodity: `Playwright pallets ${nonce}`,
    weightLbs: '42000',
    totalTrucksRequired: '1',
    offeredRateUsd: '5100',
    isHazmat: false,
    pickupAddress: '100 Quality Way',
    pickupCity: 'Chicago',
    pickupState: 'IL',
    pickupZip: '60601',
    pickupLat: '41.8781',
    pickupLng: '-87.6298',
    pickupEarliest,
    pickupLatest,
    pickupContactName: 'Receiving Dock',
    pickupContactPhone: '+1-555-300-1000',
    pickupInstructions: 'Check in with dock 4.',
    dropoffAddress: '500 Freight Parkway',
    dropoffCity: 'Dallas',
    dropoffState: 'TX',
    dropoffZip: '75201',
    dropoffLat: '32.7767',
    dropoffLng: '-96.7970',
    dropoffEarliest,
    dropoffLatest,
    dropoffContactName: 'Warehouse Lead',
    dropoffContactPhone: '+1-555-300-2000',
    dropoffInstructions: 'Call 30 minutes before arrival.',
    ...overrides,
  };
}

export function buildLoadApiInput(overrides: Partial<CreateLoadApiInput> = {}): CreateLoadApiInput {
  const formInput = buildLoadFormInput({
    totalTrucksRequired: '2',
    ...Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [key, typeof value === 'number' ? String(value) : value]),
    ) as Partial<CreateLoadFormInput>,
  });

  return {
    cargoType: formInput.cargoType,
    commodity: formInput.commodity,
    weightLbs: Number.parseInt(formInput.weightLbs, 10),
    totalTrucksRequired: Number.parseInt(formInput.totalTrucksRequired, 10),
    offeredRateUsd: Number.parseInt(formInput.offeredRateUsd, 10),
    isHazmat: formInput.isHazmat,
    hazmatClass: formInput.hazmatClass,
    pickupAddress: formInput.pickupAddress,
    pickupCity: formInput.pickupCity,
    pickupState: formInput.pickupState,
    pickupZip: formInput.pickupZip,
    pickupLat: Number.parseFloat(formInput.pickupLat),
    pickupLng: Number.parseFloat(formInput.pickupLng),
    pickupEarliest: new Date(formInput.pickupEarliest).toISOString(),
    pickupLatest: new Date(formInput.pickupLatest).toISOString(),
    pickupContactName: formInput.pickupContactName,
    pickupContactPhone: formInput.pickupContactPhone,
    pickupInstructions: formInput.pickupInstructions,
    dropoffAddress: formInput.dropoffAddress,
    dropoffCity: formInput.dropoffCity,
    dropoffState: formInput.dropoffState,
    dropoffZip: formInput.dropoffZip,
    dropoffLat: Number.parseFloat(formInput.dropoffLat),
    dropoffLng: Number.parseFloat(formInput.dropoffLng),
    dropoffEarliest: new Date(formInput.dropoffEarliest).toISOString(),
    dropoffLatest: new Date(formInput.dropoffLatest).toISOString(),
    dropoffContactName: formInput.dropoffContactName,
    dropoffContactPhone: formInput.dropoffContactPhone,
    dropoffInstructions: formInput.dropoffInstructions,
    ...overrides,
  };
}

export async function installDialogTrap(page: Page): Promise<{ wasTriggered: () => boolean }> {
  let triggered = false;

  page.on('dialog', async (dialog) => {
    triggered = true;
    await dialog.dismiss();
  });

  return {
    wasTriggered: () => triggered,
  };
}

export function uniqueSuffix(): string {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, '0');

  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}${Math.random().toString(36).slice(2, 8)}`;
}

export function uniquePhoneNumber(): string {
  const digits = `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`.slice(-7);

  return `+1-555-${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function futureDateTimeLocal(hoursAhead: number): string {
  const date = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  const pad = (value: number) => value.toString().padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}