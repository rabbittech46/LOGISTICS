import { promises as fs } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();

const ignoredDirs = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
  '.next',
]);

const allowedSecretFiles = new Set([
  'nginx/certs/README.md',
  'secrets/README.md',
]);

const secretPatterns = [
  {
    name: 'Private key block',
    regex: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/m,
  },
  {
    name: 'Stripe secret key',
    regex: /\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b/,
  },
  {
    name: 'Stripe webhook secret',
    regex: /\bwhsec_[0-9A-Za-z]{16,}\b/,
  },
  {
    name: 'AWS access key',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
];

const textExtensions = new Set([
  '.env',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.pem',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

function toRepoPath(filePath) {
  return path.relative(rootDir, filePath).replace(/\\/g, '/');
}

async function collectFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    const repoPath = toRepoPath(absolutePath);
    const topLevel = repoPath.split('/')[0];

    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name) || ignoredDirs.has(topLevel)) {
        continue;
      }
      files.push(...await collectFiles(absolutePath));
      continue;
    }

    files.push(absolutePath);
  }

  return files;
}

function looksTextFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath).toLowerCase();
  return textExtensions.has(extension) || baseName === '.env' || baseName.endsWith('.example');
}

async function readIfText(filePath) {
  if (!looksTextFile(filePath)) {
    return null;
  }

  const content = await fs.readFile(filePath);
  if (content.includes(0)) {
    return null;
  }
  return content.toString('utf8');
}

async function main() {
  const files = await collectFiles(rootDir);
  const findings = [];

  for (const filePath of files) {
    const repoPath = toRepoPath(filePath);

    if ((repoPath.startsWith('secrets/') || repoPath.startsWith('nginx/certs/')) && !allowedSecretFiles.has(repoPath)) {
      findings.push(`${repoPath}: committed secret-bearing file is forbidden`);
      continue;
    }

    const content = await readIfText(filePath);
    if (!content) {
      continue;
    }

    if (repoPath === '.env.example' || repoPath === '.env.playwright.example') {
      continue;
    }

    for (const pattern of secretPatterns) {
      if (pattern.regex.test(content)) {
        findings.push(`${repoPath}: ${pattern.name}`);
      }
    }
  }

  if (findings.length > 0) {
    console.error('Repository security check failed. Remove committed secrets before continuing.');
    for (const finding of findings) {
      console.error(`- ${finding}`);
    }
    process.exit(1);
  }

  console.log('Repository security check passed.');
}

main().catch((error) => {
  console.error('Repository security check crashed.');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});