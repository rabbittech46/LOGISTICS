// ─────────────────────────────────────────────────────────────────────────────
// Load Test — k6 script for API stress testing
//
// Run: k6 run tests/load/api-load-test.js --vus 100 --duration 5m
// ─────────────────────────────────────────────────────────────────────────────
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('error_rate');
const priceQuoteDuration = new Trend('price_quote_duration');

export const options = {
  stages: [
    { duration: '1m', target: 50 },    // Ramp up
    { duration: '3m', target: 200 },   // Peak load
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],    // P95 < 500ms, P99 < 1s
    error_rate: ['rate<0.01'],                          // <1% error rate
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_URL || 'https://api.rabbittech.io';
let authToken = '';

export function setup() {
  // Login to get auth token
  const loginRes = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({
    email: __ENV.TEST_EMAIL || 'loadtest@rabbittech.io',
    password: __ENV.TEST_PASSWORD || 'LoadTest!2024',
  }), { headers: { 'Content-Type': 'application/json' } });

  check(loginRes, { 'login successful': (r) => r.status === 200 });

  if (loginRes.status === 200) {
    return { token: JSON.parse(loginRes.body).data.accessToken };
  }
  return { token: '' };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  // ── Health Check ────────────────────────────────────────────────────
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, { 'health OK': (r) => r.status === 200 });
  errorRate.add(healthRes.status !== 200);

  // ── Price Quote ─────────────────────────────────────────────────────
  const states = ['TX', 'CA', 'IL', 'FL', 'NY', 'GA', 'OH', 'PA', 'NC', 'WA'];
  const cargoTypes = ['DRY_VAN', 'FLATBED', 'REFRIGERATED', 'TANKER'];

  const quoteRes = http.post(`${BASE_URL}/api/v1/pricing/quote`, JSON.stringify({
    cargoType: cargoTypes[Math.floor(Math.random() * cargoTypes.length)],
    weightLbs: 10000 + Math.random() * 30000,
    distanceMiles: 50 + Math.random() * 2000,
    originState: states[Math.floor(Math.random() * states.length)],
    destState: states[Math.floor(Math.random() * states.length)],
    pickupDate: '2024-07-15',
  }), { headers });

  check(quoteRes, { 'price quote OK': (r) => r.status === 200 });
  errorRate.add(quoteRes.status !== 200);
  priceQuoteDuration.add(quoteRes.timings.duration);

  // ── Load Board Search ───────────────────────────────────────────────
  const searchRes = http.get(
    `${BASE_URL}/api/v1/loads?originState=TX&destState=CA&cargoType=DRY_VAN&page=1&pageSize=20`,
    { headers },
  );
  check(searchRes, { 'search OK': (r) => r.status === 200 });
  errorRate.add(searchRes.status !== 200);

  // ── Status Check ────────────────────────────────────────────────────
  const statusRes = http.get(`${BASE_URL}/api/v1/status`, { headers });
  check(statusRes, { 'status OK': (r) => r.status === 200 });

  sleep(0.5 + Math.random());
}
