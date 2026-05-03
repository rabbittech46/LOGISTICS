import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = __ENV.K6_BASE_URL || 'https://localhost';
const apiStatusUrl = __ENV.K6_API_STATUS_URL || `${baseUrl}/api/v1/status`;
const apiHealthUrl = __ENV.K6_API_HEALTH_URL || `${baseUrl}/health`;
const webUrl = __ENV.K6_WEB_URL || baseUrl;

const launchRps = Number(__ENV.K6_LAUNCH_RPS || 2500);
const multiplier = Number(__ENV.K6_TRAFFIC_MULTIPLIER || 2);
const targetRps = Math.max(1, Math.round(launchRps * multiplier));

export const options = {
  scenarios: {
    browserEdge: {
      executor: 'constant-arrival-rate',
      rate: Math.max(1, Math.round(targetRps * 0.08)),
      timeUnit: '1s',
      duration: __ENV.K6_DURATION || '5m',
      preAllocatedVUs: Number(__ENV.K6_WEB_PREALLOCATED_VUS || 50),
      maxVUs: Number(__ENV.K6_WEB_MAX_VUS || 250),
      exec: 'webScenario',
    },
    apiStatus: {
      executor: 'constant-arrival-rate',
      rate: Math.max(1, Math.round(targetRps * 0.12)),
      timeUnit: '1s',
      duration: __ENV.K6_DURATION || '5m',
      preAllocatedVUs: Number(__ENV.K6_API_PREALLOCATED_VUS || 75),
      maxVUs: Number(__ENV.K6_API_MAX_VUS || 300),
      exec: 'statusScenario',
    },
    apiHealth: {
      executor: 'constant-arrival-rate',
      rate: Math.max(1, Math.round(targetRps * 0.02)),
      timeUnit: '1s',
      duration: __ENV.K6_DURATION || '5m',
      preAllocatedVUs: Number(__ENV.K6_HEALTH_PREALLOCATED_VUS || 20),
      maxVUs: Number(__ENV.K6_HEALTH_MAX_VUS || 80),
      exec: 'healthScenario',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    checks: ['rate>0.99'],
  },
  insecureSkipTLSVerify: __ENV.K6_INSECURE_SKIP_TLS_VERIFY === 'true',
};

const defaultHeaders = {
  'user-agent': 'rabbittech-launch-readiness-k6/1.0',
};

export function webScenario() {
  const response = http.get(webUrl, { headers: defaultHeaders });
  check(response, {
    'web returned 200': (res) => res.status === 200,
  });
  sleep(1);
}

export function statusScenario() {
  const response = http.get(apiStatusUrl, { headers: defaultHeaders });
  check(response, {
    'status returned 200': (res) => res.status === 200,
    'status returned version': (res) => Boolean(res.json('version')),
    'status returned environment': (res) => Boolean(res.json('environment')),
  });
  sleep(1);
}

export function healthScenario() {
  const response = http.get(apiHealthUrl, { headers: defaultHeaders });
  check(response, {
    'health returned 200': (res) => res.status === 200,
    'health service is api': (res) => res.json('service') === 'api',
    'health status is ok': (res) => res.json('status') === 'ok',
  });
  sleep(1);
}