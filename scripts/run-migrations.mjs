import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(repoRoot, 'schema.sql');
const migrationsDir = path.join(repoRoot, 'migrations');
const baselineMigrationName = '000_schema.sql';
const advisoryLockId = 76420031;

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

function usage() {
  console.error('Usage: node ./scripts/run-migrations.mjs <bootstrap|up|status>');
}

async function ensureMigrationTable(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS logistics`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS logistics.schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function acquireLock(client) {
  await client.query('SELECT pg_advisory_lock($1)', [advisoryLockId]);
}

async function releaseLock(client) {
  await client.query('SELECT pg_advisory_unlock($1)', [advisoryLockId]);
}

async function getAppliedMigrations(client) {
  const result = await client.query(
    'SELECT name, checksum, applied_at FROM logistics.schema_migrations ORDER BY applied_at, name',
  );
  return result.rows;
}

async function recordMigration(client, name, fileChecksum) {
  await client.query(
    `INSERT INTO logistics.schema_migrations (name, checksum) VALUES ($1, $2)`,
    [name, fileChecksum],
  );
}

async function hasBaselineSchema(client) {
  const result = await client.query(`SELECT to_regclass('logistics.organizations') AS table_name`);
  return Boolean(result.rows[0]?.table_name);
}

async function applySqlFile(client, name, filePath) {
  const content = await readFile(filePath, 'utf8');
  const fileChecksum = checksum(content);

  await client.query('BEGIN');
  try {
    await client.query(content);
    await recordMigration(client, name, fileChecksum);
    await client.query('COMMIT');
    return fileChecksum;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function bootstrap(client, appliedMap) {
  if (appliedMap.has(baselineMigrationName)) {
    return false;
  }

  const schemaExists = await hasBaselineSchema(client);
  if (schemaExists) {
    throw new Error(
      'Baseline schema already exists but is not recorded. Insert 000_schema.sql into logistics.schema_migrations or reconcile manually before continuing.',
    );
  }

  const schemaSql = await readFile(schemaPath, 'utf8');
  const fileChecksum = checksum(schemaSql);

  await client.query('BEGIN');
  try {
    await client.query(schemaSql);
    await recordMigration(client, baselineMigrationName, fileChecksum);
    await client.query('COMMIT');
    console.log(`Applied ${baselineMigrationName}`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function migrateUp(client, appliedMap) {
  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  let appliedCount = 0;
  for (const fileName of files) {
    const filePath = path.join(migrationsDir, fileName);
    const content = await readFile(filePath, 'utf8');
    const fileChecksum = checksum(content);
    const existing = appliedMap.get(fileName);

    if (existing) {
      if (existing.checksum !== fileChecksum) {
        throw new Error(`Checksum mismatch for already-applied migration ${fileName}`);
      }
      continue;
    }

    await applySqlFile(client, fileName, filePath);
    appliedMap.set(fileName, { checksum: fileChecksum });
    appliedCount += 1;
    console.log(`Applied ${fileName}`);
  }

  return appliedCount;
}

async function printStatus(client) {
  const applied = await getAppliedMigrations(client);
  if (applied.length === 0) {
    console.log('No migrations have been applied.');
    return;
  }

  for (const row of applied) {
    console.log(`${row.applied_at.toISOString()}  ${row.name}`);
  }
}

async function main() {
  const command = process.argv[2];
  if (!command || !['bootstrap', 'up', 'status'].includes(command)) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await ensureMigrationTable(client);
    await acquireLock(client);

    const appliedMigrations = await getAppliedMigrations(client);
    const appliedMap = new Map(appliedMigrations.map((row) => [row.name, { checksum: row.checksum }]));

    switch (command) {
      case 'bootstrap': {
        await bootstrap(client, appliedMap);
        const appliedCount = await migrateUp(client, appliedMap);
        if (appliedCount === 0) {
          console.log('No pending migrations.');
        }
        break;
      }
      case 'up': {
        if (!appliedMap.has(baselineMigrationName) && !(await hasBaselineSchema(client))) {
          throw new Error('Baseline schema not found. Run db:bootstrap before db:migrate on a fresh environment.');
        }
        const appliedCount = await migrateUp(client, appliedMap);
        if (appliedCount === 0) {
          console.log('No pending migrations.');
        }
        break;
      }
      case 'status':
        await printStatus(client);
        break;
      default:
        usage();
        process.exitCode = 1;
    }
  } finally {
    try {
      await releaseLock(client);
    } catch {
      // Ignore unlock failures during teardown.
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});