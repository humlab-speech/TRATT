'use strict';

/**
 * Jest transformer wrapper for login.component.ts ONLY.
 *
 * login.component.ts's `providers` array constructs its diarization Worker
 * factory inline: `new URL('...worker', import.meta.url)`. Under this
 * project's ts-jest CommonJS config (module: "commonjs", target: "es2016" —
 * see apps/tratt/tsconfig.spec.json), any file containing `import.meta`
 * fails to compile with TS1343 ("The 'import.meta' meta-property is only
 * allowed when the '--module' option is ... 'esnext' ..."), and even if that
 * diagnostic were suppressed, Node's CommonJS script parser rejects
 * `import.meta` syntax outright at load time — this is a hard tooling
 * blocker, not a soft lint warning.
 *
 * Every other file in this codebase that hits this same `import.meta.url`
 * pattern (local-transcription.service.ts, local-translation.service.ts) is
 * worked around by jest.mock()-ing the *module* out of the require graph
 * before it's imported (see workbench.component.spec.ts,
 * linear-editor.component.spec.ts, editors/components.spec.ts). That
 * technique doesn't apply here: the offending expression lives directly in
 * login.component.ts's own `@Component` decorator, i.e. inside the file
 * under test itself, so it can't be mocked away without losing the real
 * class.
 *
 * This wrapper instead does a plain textual substitution of
 * `import.meta.url` -> a CommonJS-safe equivalent (`file://` URL of the
 * current module, via Node's `url.pathToFileURL`) *before* handing the
 * source to the real jest-preset-angular/ts-jest transformer, so TypeScript
 * never sees `import.meta` syntax at all. The replaced expression is only
 * ever read inside an arrow function assigned to LOCAL_DIARIZATION_WORKER_FACTORY,
 * which login.component.spec.ts never invokes (LocalDiarizationRuntimeService
 * is mocked at the DI boundary in every test), so the substitute value's
 * exact contents are inert for test purposes — only its syntactic validity
 * matters.
 *
 * Wired up in apps/tratt/jest.config.ts as a narrowly-scoped `transform`
 * entry matching only this one file path; every other file continues
 * through the ordinary jest-preset-angular transform entry untouched.
 */

const jestPresetAngular = require('jest-preset-angular').default;

const IMPORT_META_URL_RE = /import\.meta\.url/g;
const REPLACEMENT = "(require('url').pathToFileURL(__filename).href)";

module.exports = {
  createTransformer(userOptions) {
    const delegate = jestPresetAngular.createTransformer(userOptions);

    return {
      process(sourceText, sourcePath, options) {
        const patched = sourceText.replace(IMPORT_META_URL_RE, REPLACEMENT);
        return delegate.process(patched, sourcePath, options);
      },
      processAsync(sourceText, sourcePath, options) {
        const patched = sourceText.replace(IMPORT_META_URL_RE, REPLACEMENT);
        if (typeof delegate.processAsync === 'function') {
          return delegate.processAsync(patched, sourcePath, options);
        }
        return Promise.resolve(delegate.process(patched, sourcePath, options));
      },
      getCacheKey(sourceText, sourcePath, options) {
        const patched = sourceText.replace(IMPORT_META_URL_RE, REPLACEMENT);
        if (typeof delegate.getCacheKey === 'function') {
          return (
            delegate.getCacheKey(patched, sourcePath, options) +
            ':import-meta-patched'
          );
        }
        return patched;
      },
    };
  },
};
