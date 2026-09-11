export default {
  displayName: 'tratt',
  preset: '../../jest.preset.js',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../coverage/apps/tratt',
  transform: {
    '^.+\\.(ts|mjs|js|html)$': [
      'jest-preset-angular',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        stringifyContentPathRegex: '\\.(html|svg)$',
        // warnOnly: a spec's transitive import graph can contain files with
        // pre-existing/expected type errors (type safety is enforced
        // separately by `nx typecheck`/`nx build`) without failing the
        // whole suite before any test runs. Diagnostics still print.
        diagnostics: {
          warnOnly: true,
        },
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
