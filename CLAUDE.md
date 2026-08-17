# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TRATT (Orthographic Transcription) - Angular 19 web app for phonetic transcription of audio files. Nx monorepo with publishable libraries under the `@octra/` namespace (kept from the upstream OCTRA project this is forked from).

## Commands

```bash
npm start                    # Dev server on port 5321
npm run build                # Production build
npm run build:dev            # Dev build
npm run build:libs           # Build all libraries
npm run lint                 # ESLint
npm run format               # Prettier format (nx format:write)
npm test                     # Jest tests
npm run dep-graph            # Interactive dependency graph
npm run analyze:octra        # Bundle analysis
```

## Architecture

**Monorepo layout** (Nx 20):

- `apps/octra/` — Main Angular app
- `apps/web-components/` — Web components build
- `libs/annotation/` — Annotation task objects
- `libs/media/` — Core media classes (no DOM deps)
- `libs/web-media/` — Browser audio playback
- `libs/ngx-components/` — Angular components (signal displays)
- `libs/ngx-utilities/` — Angular utilities
- `libs/utilities/` — Cross-platform utilities
- `libs/json-sets/` — JSON validation
- `libs/assets/` — JSON schemas & shared assets

**State**: NgRx store split into: app, user, annotation, idb, asr, login-mode. Actions/reducers/effects per slice in `apps/octra/src/app/core/store/`.

**Editors**: Specialized transcription editors in `apps/octra/src/app/editors/` — 2D-Editor (signal viz + segments), Dictaphone-Editor, Linear-Editor (dual signal), TRN-Editor, New-Editor.

**Routing**: Lazy-loaded InternModule with guards for auth, config loading, and IndexedDB init. Task routes follow visp-task/project/session/bundle pattern.

**i18n**: Transloco (not @angular/localize).

## Key Config

- TypeScript path aliases: `@octra/*` → `libs/*/src/index.ts` (see `tsconfig.base.json`)
- Build budgets: 2MB initial / 6MB error (prod)
- Node 20+
- Commit convention: Commitizen with conventional-changelog
- Formatting: Prettier (single quotes, 2-space indent)
