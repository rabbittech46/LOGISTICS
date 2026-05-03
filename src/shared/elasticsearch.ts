// ─────────────────────────────────────────────────────────────────────────────
// Elasticsearch Client — Search, filtering, and analytics
// ─────────────────────────────────────────────────────────────────────────────
import { Client } from '@elastic/elasticsearch';
import { config } from './config.js';
import { logger } from './logger.js';

export const esClient = new Client({
  node: config.elasticsearchUrl,
  auth: config.elasticsearchApiKey
    ? { apiKey: config.elasticsearchApiKey }
    : undefined,
  maxRetries: 3,
  requestTimeout: 10_000,
  sniffOnStart: false,
});

// ── Index names ─────────────────────────────────────────────────────────────

export const ES_INDICES = {
  LOADS:          'logistics-loads',
  TRUCKS:         'logistics-trucks',
  CARRIERS:       'logistics-carriers',
  TELEMETRY:      'logistics-telemetry',
  AUDIT_EVENTS:   'logistics-audit',
} as const;

// ── Load index mapping ──────────────────────────────────────────────────────

export async function ensureIndices(): Promise<void> {
  const indices = [
    {
      index: ES_INDICES.LOADS,
      body: {
        settings: { number_of_shards: 3, number_of_replicas: 1, refresh_interval: '5s' },
        mappings: {
          properties: {
            id:               { type: 'keyword' },
            shipper_org_id:   { type: 'keyword' },
            reference_number: { type: 'keyword' },
            cargo_type:       { type: 'keyword' },
            commodity:        { type: 'text', analyzer: 'standard' },
            weight_lbs:       { type: 'float' },
            status:           { type: 'keyword' },
            pickup_location:  { type: 'geo_point' },
            pickup_city:      { type: 'keyword' },
            pickup_state:     { type: 'keyword' },
            pickup_zip:       { type: 'keyword' },
            pickup_earliest:  { type: 'date' },
            pickup_latest:    { type: 'date' },
            dropoff_location: { type: 'geo_point' },
            dropoff_city:     { type: 'keyword' },
            dropoff_state:    { type: 'keyword' },
            dropoff_zip:      { type: 'keyword' },
            dropoff_earliest: { type: 'date' },
            dropoff_latest:   { type: 'date' },
            distance_miles:   { type: 'float' },
            offered_rate_usd: { type: 'float' },
            rate_per_mile_usd:{ type: 'float' },
            special_requirements: { type: 'keyword' },
            load_board_visible:   { type: 'boolean' },
            created_at:       { type: 'date' },
            updated_at:       { type: 'date' },
          },
        },
      },
    },
    {
      index: ES_INDICES.TRUCKS,
      body: {
        settings: { number_of_shards: 2, number_of_replicas: 1, refresh_interval: '10s' },
        mappings: {
          properties: {
            id:                   { type: 'keyword' },
            organization_id:      { type: 'keyword' },
            cargo_type:           { type: 'keyword' },
            status:               { type: 'keyword' },
            payload_capacity_lbs: { type: 'float' },
            current_location:     { type: 'geo_point' },
            make:                 { type: 'keyword' },
            model:                { type: 'keyword' },
            year:                 { type: 'integer' },
            created_at:           { type: 'date' },
          },
        },
      },
    },
  ];

  for (const { index, body } of indices) {
    const exists = await esClient.indices.exists({ index });
    if (!exists) {
      await esClient.indices.create({ index, ...body });
      logger.info({ index }, 'Elasticsearch index created');
    }
  }
}

// ── Load board search ───────────────────────────────────────────────────────

export interface LoadSearchParams {
  query?: string;
  cargoType?: string;
  originState?: string;
  destState?: string;
  pickupAfter?: string;
  pickupBefore?: string;
  minWeight?: number;
  maxWeight?: number;
  minRate?: number;
  maxRate?: number;
  nearLat?: number;
  nearLng?: number;
  radiusMiles?: number;
  page?: number;
  pageSize?: number;
  sortBy?: 'pickup_earliest' | 'offered_rate_usd' | 'distance_miles' | 'created_at';
  sortOrder?: 'asc' | 'desc';
}

export async function searchLoads(params: LoadSearchParams) {
  const must: any[] = [
    { term: { status: 'POSTED' } },
    { term: { load_board_visible: true } },
  ];
  const filter: any[] = [];

  if (params.query) {
    must.push({
      multi_match: {
        query: params.query,
        fields: ['commodity', 'reference_number', 'pickup_city', 'dropoff_city'],
        fuzziness: 'AUTO',
      },
    });
  }

  if (params.cargoType) filter.push({ term: { cargo_type: params.cargoType } });
  if (params.originState) filter.push({ term: { pickup_state: params.originState } });
  if (params.destState) filter.push({ term: { dropoff_state: params.destState } });

  if (params.pickupAfter || params.pickupBefore) {
    const range: any = {};
    if (params.pickupAfter) range.gte = params.pickupAfter;
    if (params.pickupBefore) range.lte = params.pickupBefore;
    filter.push({ range: { pickup_earliest: range } });
  }

  if (params.minWeight || params.maxWeight) {
    const range: any = {};
    if (params.minWeight) range.gte = params.minWeight;
    if (params.maxWeight) range.lte = params.maxWeight;
    filter.push({ range: { weight_lbs: range } });
  }

  if (params.minRate || params.maxRate) {
    const range: any = {};
    if (params.minRate) range.gte = params.minRate;
    if (params.maxRate) range.lte = params.maxRate;
    filter.push({ range: { offered_rate_usd: range } });
  }

  if (params.nearLat != null && params.nearLng != null) {
    filter.push({
      geo_distance: {
        distance: `${params.radiusMiles ?? 150}mi`,
        pickup_location: { lat: params.nearLat, lon: params.nearLng },
      },
    });
  }

  const page = params.page ?? 1;
  const size = Math.min(params.pageSize ?? 25, 100);

  const result = await esClient.search({
    index: ES_INDICES.LOADS,
    body: {
      query: { bool: { must, filter } },
      sort: [{ [params.sortBy ?? 'created_at']: { order: params.sortOrder ?? 'desc' } }],
      from: (page - 1) * size,
      size,
      track_total_hits: true,
    },
  });

  const total = typeof result.hits.total === 'number' ? result.hits.total : result.hits.total?.value ?? 0;

  return {
    loads: result.hits.hits.map((h: any) => ({ id: h._id, ...h._source })),
    total,
    page,
    pageSize: size,
    totalPages: Math.ceil(total / size),
  };
}

// ── Index a single load document ────────────────────────────────────────────

export async function indexLoad(load: Record<string, unknown>): Promise<void> {
  await esClient.index({
    index: ES_INDICES.LOADS,
    id: load.id as string,
    body: load,
  });
}

// ── Delete a load from index ────────────────────────────────────────────────

export async function removeLoad(loadId: string): Promise<void> {
  await esClient.delete({ index: ES_INDICES.LOADS, id: loadId }).catch(() => {});
}
