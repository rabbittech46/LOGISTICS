/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'ES2022',
        target: 'ES2022',
        moduleResolution: 'Node16',
        isolatedModules: true,
      },
    }],
  },
  roots: ['<rootDir>/tests'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover'],
  modulePathIgnorePatterns: [
    '<rootDir>/dist/',
    '<rootDir>/playwright-report/',
    '<rootDir>/test-results/',
    '<rootDir>/web-app/.next/',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/web/**',
  ],
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
      preset: 'ts-jest/presets/default-esm',
      testEnvironment: 'node',
      extensionsToTreatAsEsm: ['.ts'],
      modulePathIgnorePatterns: [
        '<rootDir>/dist/',
        '<rootDir>/playwright-report/',
        '<rootDir>/test-results/',
        '<rootDir>/web-app/.next/',
      ],
      moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
      transform: { '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: { module: 'ES2022', target: 'ES2022', moduleResolution: 'Node16', isolatedModules: true } }] },
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      preset: 'ts-jest/presets/default-esm',
      testEnvironment: 'node',
      extensionsToTreatAsEsm: ['.ts'],
      modulePathIgnorePatterns: [
        '<rootDir>/dist/',
        '<rootDir>/playwright-report/',
        '<rootDir>/test-results/',
        '<rootDir>/web-app/.next/',
      ],
      moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
      transform: { '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: { module: 'ES2022', target: 'ES2022', moduleResolution: 'Node16', isolatedModules: true } }] },
    },
  ],
  testTimeout: 60_000,
};
