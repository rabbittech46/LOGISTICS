import process from 'node:process';

const targets = [
  {
    name: 'web',
    url: process.env.STAGING_WEB_URL,
    expectedStatus: 200,
    requiredText: 'html',
  },
  {
    name: 'api-health',
    url: process.env.STAGING_API_HEALTH_URL,
    expectedStatus: 200,
    expectedJson: { service: 'api', status: 'ok' },
  },
  {
    name: 'api-status',
    url: process.env.STAGING_API_STATUS_URL,
    expectedStatus: 200,
    expectedJsonKeys: ['version', 'environment', 'timestamp'],
  },
  {
    name: 'tracking-health',
    url: process.env.STAGING_TRACKING_HEALTH_URL,
    expectedStatus: 200,
    expectedJson: { service: 'tracking', status: 'ok' },
  },
];

function printUsageAndExit() {
  console.error('Missing staging URLs. Set these environment variables before running:');
  console.error('  STAGING_WEB_URL');
  console.error('  STAGING_API_HEALTH_URL');
  console.error('  STAGING_API_STATUS_URL');
  console.error('  STAGING_TRACKING_HEALTH_URL');
  process.exit(1);
}

if (targets.some((target) => !target.url)) {
  printUsageAndExit();
}

async function validateTarget(target) {
  const response = await fetch(target.url, {
    headers: { 'user-agent': 'rabbittech-staging-validator/1.0' },
  });

  if (response.status !== target.expectedStatus) {
    throw new Error(`${target.name}: expected HTTP ${target.expectedStatus}, received ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (target.expectedJson || target.expectedJsonKeys) {
    if (!contentType.includes('application/json')) {
      throw new Error(`${target.name}: expected JSON response, received ${contentType || 'unknown content type'}`);
    }

    const payload = await response.json();

    if (target.expectedJson) {
      for (const [key, expectedValue] of Object.entries(target.expectedJson)) {
        if (payload[key] !== expectedValue) {
          throw new Error(`${target.name}: expected ${key}=${expectedValue}, received ${payload[key]}`);
        }
      }
    }

    if (target.expectedJsonKeys) {
      for (const key of target.expectedJsonKeys) {
        if (!(key in payload)) {
          throw new Error(`${target.name}: missing JSON key ${key}`);
        }
      }
    }

    return;
  }

  const body = await response.text();
  if (target.requiredText && !body.toLowerCase().includes(target.requiredText)) {
    throw new Error(`${target.name}: response body did not include ${target.requiredText}`);
  }
}

async function main() {
  console.log('Running staging endpoint validation...');

  for (const target of targets) {
    await validateTarget(target);
    console.log(`PASS ${target.name}: ${target.url}`);
  }

  console.log('Staging endpoint validation passed.');
}

main().catch((error) => {
  console.error('Staging endpoint validation failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});