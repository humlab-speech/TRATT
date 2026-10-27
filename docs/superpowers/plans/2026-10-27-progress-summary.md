# Språkbanken profile conversion – progress

## Phase 1 – Foundation (tasks 1–5): complete

- T1 `701493ade` self-hosted Jost / Noto Sans / Noto Serif (incl. Serif 700); SW caches `/media/**`.
- T2 `0fa6be999` Sass palette, tokens, Bootstrap config, buttons, typography partials; old token block and global `h1` centering removed.
- T3 `299d0038a` global rules in `styles.scss` moved to tokens; `!important` card/bg-light overrides removed.
- T4 `e7cbd7698` headline CTAs (`btn-success` → `btn-next`).
- T5 `fcff4fb84` placeholder Tratt mark, regenerated icons, loading screen, manifest ("Tratt").

Open (deferred): manual browser checks (offline fonts, `/local` walkthrough, `/load`); `index.html` noscript `color: red`; leftover hard-coded colours in `styles.scss` (`.export-button`, jodit, `.btn-icon`); lockfile dev-flag churn after adding `sharp`; initial-bundle budget warning (2.69 MB, baseline unchecked).

## Phase 2 – Shell (tasks 6–9): complete

- T6 `adf49b905` `tratt-logo` component, "Tratt" name form, slogan keys (en/sv real, other locales English per plan), `shell.about.title`.
- T7 `738b0c692`, `bed819671`, `762371015` header/navbar; `HeaderSlotService`; pure `homeLinkFor()`; mobile offset when centre slot is populated (rules in `navbar.component.scss` and `styles.scss` must stay in step, needs `:has()`).
- T8 `0ec6551a5` data selector in the header centre slot; shared `selectLocalBundle` flushes before switching.
- T9 `fa3685e4b` footer + credits, `shell.footer.*` keys (used later by manual task 40), node logo column hidden when unconfigured.

Rulings: taglines in de/it/ko/nl/zh replaced by English brand string as the plan mandates (restore from git `47f4f638f` if wrong).

Open (deferred): official Språkbanken logo file (placeholder SVG, licence unresolved); footer `contentinfo` landmark and credits link underline (a11y); manual browser checks for header (Visp embed offset, 400/768/1024 px), data selector, footer; language toggle focusability and label-in-name; new i18n keys untranslated in de/it/ko/nl/zh; `modal.about.header` unused.

## Phase 3 – `/local` (tasks 10–13): complete

- T10 `a8e1bf610` hero + work card, banner SVG removed, `.local-hero__title` relies on global h1 rule (amendment).
- T11 `633b08e68` drop zone on tokens, drag-over state.
- T12 `12f429a8f` auto-transcribe / translate fold-outs with switch and chevron.
- T13 `3f72d798f` panels, progress bars without `bg-*`, `btn-next-lg` submit, level meter (middle state yellow per amendment).
- Fix `225be32b5` drop zone `:focus-visible`, solid border on drag-over, ARIA value/label on all six progress bars.

Rulings: de/it/ko/nl/zh `login.hero.*` stay English placeholders; `.level-light--orange` class name kept (colour is yellow).

Open (deferred): translations for hero text; indeterminate progress bar should omit `aria-valuenow`; text inside filled progress bars (spec 3.2 vs brief — revisit in task 44); vu-meter canvas hex and preview `background:#000` (task 25 allowlist / task 18-23); browser checks at 1440/400 px not done; tests are mostly source-text assertions.
