import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIRequestContext, type APIResponse, type Cookie, type Page, type Response } from '@playwright/test';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import { z, type ZodTypeAny } from 'zod';
import {
  appConfig,
  buildLoadApiInput,
  buildOrganizationData,
  buildPersistedAuthState,
  seededUsers,
  type TestRole,
} from '../fixtures/testData';

const JWT_PRIVATE_KEY = readFileSync(join(process.cwd(), 'secrets', 'jwt_private.pem'), 'utf-8').trim();
const REDIS_URL = process.env.PLAYWRIGHT_REDIS_URL ?? 'redis://127.0.0.1:16379/0';
const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

const userOrgSchema = z.object({
  orgId: z.string().uuid(),
  orgName: z.string().min(1),
  role: z.string().min(1),
  orgType: z.enum(['SHIPPER', 'CARRIER']),
});

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  organizations: z.array(userOrgSchema).min(1),
});

export const loadSchema = z.object({
  id: z.string().uuid(),
  reference_number: z.string().min(1),
  cargo_type: z.string().min(1),
  commodity: z.string().min(1),
  weight_lbs: z.number(),
  pickup_city: z.string().min(1),
  pickup_state: z.string().min(2),
  dropoff_city: z.string().min(1),
  dropoff_state: z.string().min(2),
  pickup_earliest: z.string().min(1),
  pickup_latest: z.string().min(1),
  dropoff_earliest: z.string().min(1),
  dropoff_latest: z.string().min(1),
  status: z.string().min(1),
  total_trucks_required: z.number().int().positive(),
  offered_rate_usd: z.number().nullable().optional(),
  distance_miles: z.number().nullable().optional(),
  is_hazmat: z.boolean().optional(),
}).passthrough();

export const truckSchema = z.object({
  id: z.string().uuid(),
  plate_number: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  cargo_type: z.string().min(1),
  status: z.string().min(1),
}).passthrough();

export const driverSchema = z.object({
  id: z.string().uuid(),
  cdl_number: z.string().min(1),
  cdl_class: z.string().min(1),
  is_available: z.boolean(),
}).passthrough();

export const bidSchema = z.object({
  id: z.string().uuid(),
  load_id: z.string().uuid(),
  carrier_org_id: z.string().uuid(),
  bid_amount_usd: z.number(),
  status: z.string().min(1),
  created_at: z.string().min(1),
}).passthrough();

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  org_type: z.enum(['SHIPPER', 'CARRIER']),
  contact_email: z.string().email(),
  is_active: z.boolean(),
  created_at: z.string().min(1),
}).passthrough();

export const assignmentSchema = z.object({
  id: z.string().uuid(),
  load_id: z.string().uuid(),
  truck_id: z.string().uuid().nullable().optional(),
  agreed_rate_usd: z.number(),
  status: z.string().min(1),
  created_at: z.string().min(1),
}).passthrough();

export const slotSummarySchema = z.object({
  totalSlots: z.number().int().positive(),
  availableSlots: z.number().int().min(0),
  reservedSlots: z.number().int().min(0),
  bookedSlots: z.number().int().min(0),
});

const camelLoadSlotSchema = z.object({
  slotId: z.string().uuid(),
  loadId: z.string().uuid(),
  slotNumber: z.number().int().positive(),
  status: z.enum(['AVAILABLE', 'RESERVED', 'BOOKED']),
  reservationExpiresAt: z.string().optional(),
}).passthrough();

const snakeLoadSlotSchema = z.object({
  id: z.string().uuid(),
  load_id: z.string().uuid(),
  slot_number: z.number().int().positive(),
  status: z.enum(['AVAILABLE', 'RESERVED', 'BOOKED']),
  reservation_expires_at: z.string().optional(),
}).passthrough();

export const loadSlotSchema = z.union([camelLoadSlotSchema, snakeLoadSlotSchema]);

export const bookingSchema = z.object({
  bookingId: z.string().uuid(),
  slotId: z.string().uuid(),
  loadId: z.string().uuid(),
  status: z.string().min(1),
  confirmedAt: z.string().min(1),
});

export const loginResponseSchema = z.object({
  data: z.object({
    accessToken: z.string().min(20),
    expiresIn: z.number().int().positive(),
    user: userSchema,
  }),
});

export const refreshResponseSchema = z.object({
  data: z.object({
    accessToken: z.string().min(20),
    expiresIn: z.number().int().positive(),
  }),
});

export const registerResponseSchema = z.object({
  data: z.object({
    userId: z.string().uuid(),
  }).passthrough(),
});

export const errorResponseSchema = z.object({
  error: z.string().min(1),
}).passthrough();

export const createLoadResponseSchema = z.object({
  data: z.object({
    loadId: z.string().uuid(),
    referenceNumber: z.string().min(1),
  }),
});

export const createOrganizationResponseSchema = z.object({
  data: z.object({
    orgId: z.string().uuid(),
  }).passthrough(),
});

export const createBidResponseSchema = z.object({
  data: z.object({
    bidId: z.string().uuid(),
  }).passthrough(),
});

export const createTruckResponseSchema = z.object({
  data: z.object({
    truckId: z.string().uuid(),
  }).passthrough(),
});

export const loadResponseSchema = z.object({ data: loadSchema }).passthrough();
export const loadsResponseSchema = z.object({ data: z.array(loadSchema), meta: z.object({ total: z.number().optional() }).optional() }).passthrough();
export const trucksResponseSchema = z.object({ data: z.array(truckSchema) }).passthrough();
export const driversResponseSchema = z.object({ data: z.array(driverSchema) }).passthrough();
export const bidsResponseSchema = z.object({ data: z.array(bidSchema) }).passthrough();
export const organizationsResponseSchema = z.object({ data: z.array(organizationSchema) }).passthrough();
export const assignmentsResponseSchema = z.object({ data: z.array(assignmentSchema) }).passthrough();
export const slotSummaryResponseSchema = z.object({ data: slotSummarySchema }).passthrough();
export const mySlotResponseSchema = z.object({ data: loadSlotSchema.nullable() }).passthrough();
export const reserveResponseSchema = z.object({ data: loadSlotSchema }).passthrough();
export const bookingResponseSchema = z.object({ data: bookingSchema }).passthrough();
export const organizationResponseSchema = z.object({ data: organizationSchema }).passthrough();
export const messageResponseSchema = z.object({ data: z.object({ message: z.string().min(1) }).passthrough() }).passthrough();
export const bidResponseSchema = z.object({ data: bidSchema }).passthrough();

export interface RoleSession {
  role: TestRole;
  accessToken: string;
  user: z.infer<typeof userSchema>;
  refreshCookie: Cookie;
  storageStateValue: string;
}

export class ApiHelper {
  private readonly apiBaseUrl: string;
  private readonly webBaseUrl: string;
  private readonly sessionCache = new Map<TestRole, Promise<RoleSession>>();
  private redisClient: Redis | null = null;

  constructor(private readonly request: APIRequestContext) {
    this.apiBaseUrl = appConfig.apiUrl;
    this.webBaseUrl = appConfig.baseUrl;
  }

  async authenticate(role: TestRole): Promise<RoleSession> {
    if (!this.sessionCache.has(role)) {
      this.sessionCache.set(role, this.loginRole(role));
    }

    return this.sessionCache.get(role)!;
  }

  async createPostedLoad(role: Extract<TestRole, 'shipper' | 'admin'> = 'shipper', overrides: Partial<ReturnType<typeof buildLoadApiInput>> = {}): Promise<z.infer<typeof loadSchema>> {
    const createResult = await this.requestAs(role, {
      method: 'POST',
      path: '/api/v1/loads',
      data: buildLoadApiInput(overrides),
      schema: createLoadResponseSchema,
      expectedStatus: 201,
    });

    await this.requestAs(role, {
      method: 'POST',
      path: `/api/v1/loads/${createResult.data.data.loadId}/post`,
      schema: loadResponseSchema,
      expectedStatus: 200,
    });

    const load = await this.requestAs(role, {
      method: 'GET',
      path: `/api/v1/loads/${createResult.data.data.loadId}`,
      schema: loadResponseSchema,
      expectedStatus: 200,
    });

    return load.data.data;
  }

  async createOrganization(role: Extract<TestRole, 'admin'> = 'admin', overrides: Partial<ReturnType<typeof buildOrganizationData>> = {}): Promise<z.infer<typeof organizationSchema>> {
    const response = await this.requestAs(role, {
      method: 'POST',
      path: '/api/v1/organizations',
      data: buildOrganizationData(overrides),
      schema: organizationResponseSchema,
      expectedStatus: 201,
    });

    return response.data.data;
  }

  async createAvailableTruck(role: Extract<TestRole, 'carrier'> = 'carrier'): Promise<string> {
    const token = randomUUID().replace(/-/g, '').toUpperCase();
    const vin = `${token}ABCDEFGH`.slice(0, 17);
    const plateSuffix = token.slice(-6);
    const futureDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const response = await this.requestAs(role, {
      method: 'POST',
      path: '/api/v1/trucks',
      data: {
        vin,
        plateNumber: `PW${plateSuffix}`,
        plateState: 'TX',
        make: 'Playwright',
        model: `E2E-${plateSuffix}`,
        year: new Date().getFullYear(),
        cargoType: 'FLATBED',
        lengthIn: 636,
        widthIn: 102,
        heightIn: 120,
        payloadCapacityLbs: 48000,
        grossVehicleWtLbs: 80000,
        insuranceExpiry: futureDate,
        registrationExpiry: futureDate,
      },
      schema: createTruckResponseSchema,
      expectedStatus: 201,
    });

    return response.data.data.truckId;
  }

  async requestAs<TSchema extends ZodTypeAny>(
    role: TestRole,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      path: string;
      data?: unknown;
      schema: TSchema;
      expectedStatus: number | number[];
    },
  ): Promise<{ data: z.infer<TSchema>; response: APIResponse }> {
    const session = await this.authenticate(role);
    const response = await this.request.fetch(`${this.apiBaseUrl}${options.path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      data: options.data,
      failOnStatusCode: false,
      ignoreHTTPSErrors: true,
    });

    const data = await assertJsonResponse(response, options.schema, options.expectedStatus);
    return { data, response };
  }

  private async loginRole(role: TestRole): Promise<RoleSession> {
    const user = seededUsers[role];
    const activeOrg = user.organizations[0];
    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        orgId: activeOrg.orgId,
        role: activeOrg.role,
      },
      JWT_PRIVATE_KEY,
      {
        algorithm: 'RS256',
        expiresIn: '15m',
        issuer: 'rabbittech-logistics',
        audience: 'logistics-api',
      },
    );
    const refreshCookie = await this.createRefreshCookie(user, activeOrg);

    return {
      role,
      accessToken,
      user,
      refreshCookie,
      storageStateValue: buildPersistedAuthState(role),
    };
  }

  private async createRefreshCookie(
    user: z.infer<typeof userSchema>,
    activeOrg: z.infer<typeof userOrgSchema>,
  ): Promise<Cookie> {
    const refreshToken = randomUUID() + randomUUID();
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    const redis = this.getRedisClient();

    await redis.setex(
      `refresh:${tokenHash}`,
      REFRESH_TOKEN_TTL_SEC,
      JSON.stringify({
        userId: user.id,
        email: user.email,
        orgId: activeOrg.orgId,
        role: activeOrg.role,
      }),
    );

    const url = new URL(this.webBaseUrl);

    return {
      name: 'refreshToken',
      value: refreshToken,
      domain: url.hostname,
      path: '/api/v1/auth/refresh',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Strict',
      expires: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL_SEC,
    };
  }

  private getRedisClient(): Redis {
    if (!this.redisClient) {
      this.redisClient = new Redis(REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
    }

    return this.redisClient;
  }
}

export async function expectJsonResponse<TSchema extends ZodTypeAny>(options: {
  page: Page;
  method: string;
  url: RegExp;
  expectedStatus: number | number[];
  schema: TSchema;
  trigger: () => Promise<unknown>;
}): Promise<{ data: z.infer<TSchema>; response: Response }> {
  const responsePromise = options.page.waitForResponse((response) => {
    return response.request().method() === options.method && options.url.test(response.url());
  });

  await options.trigger();
  const response = await responsePromise;
  const data = await assertJsonResponse(response, options.schema, options.expectedStatus);

  return { data, response };
}

export async function assertJsonResponse<TSchema extends ZodTypeAny>(
  response: APIResponse | Response,
  schema: TSchema,
  expectedStatus: number | number[],
): Promise<z.infer<TSchema>> {
  const allowedStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  expect(
    allowedStatuses,
    `${response.url()} responded with unexpected status ${response.status()}`,
  ).toContain(response.status());

  const rawText = await response.text();
  const parsedJson = rawText.length > 0 ? JSON.parse(rawText) : {};
  const parsed = schema.safeParse(parsedJson);

  expect(parsed.success, formatSchemaError(response.url(), response.status(), rawText, parsed)).toBeTruthy();
  return parsed.data as z.infer<TSchema>;
}

function formatSchemaError(
  url: string,
  status: number,
  rawText: string,
  result: ReturnType<ZodTypeAny['safeParse']>,
): string {
  if (result.success) {
    return '';
  }

  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('\n');

  return `Schema validation failed for ${url} (${status})\n${issues}\nBody:\n${rawText}`;
}