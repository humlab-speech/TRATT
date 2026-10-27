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
