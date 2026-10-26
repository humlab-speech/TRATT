# CLAUDE.md

## Gotchas

- `@octra/api-types` and `@octra/ngx-octra-api` are upstream npm packages, not workspace libs.
- i18n: Transloco (not @angular/localize).
- Routing: lazy-loaded InternModule with guards for auth, config loading, and IndexedDB init. Task routes follow visp-task/project/session/bundle pattern.
- Commit convention: Commitizen with conventional-changelog.
