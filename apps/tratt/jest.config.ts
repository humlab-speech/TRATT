export default {
  displayName: 'tratt',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../coverage/apps/tratt',
  transform: {
    // Narrowly-scoped transform for login.component.ts ONLY: its
    // `@Component` providers array constructs a Worker via `new URL(...,
    // import.meta.url)` inline (not behind an importable module boundary
    // that can be jest.mock()-ed away), which ts-jest's CommonJS config
    // (see tsconfig.spec.json) cannot compile (TS1343). See
    // login-component-import-meta.transformer.js for the full rationale.
    // Must come before the general '.ts' pattern below so it wins for this
    // one file; every other file is unaffected.
    '.+/pages/login/login\\.component\\.ts$': [
      '<rootDir>/src/test-transformers/login-component-import-meta.transformer.js',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
      },
    ],
  },
  moduleNameMapper: {
    '^canvas$': '<rootDir>/__mocks__/canvas.js',
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|jodit|ngx-jodit|konva)'],
  snapshotSerializers: [
    'jest-preset-angular/build/serializers/no-ng-attributes',
    'jest-preset-angular/build/serializers/ng-snapshot',
    'jest-preset-angular/build/serializers/html-comment',
  ],
};
