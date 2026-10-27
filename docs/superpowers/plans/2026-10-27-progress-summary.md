# Språkbanken profile conversion – progress

## Phase 1 – Foundation (tasks 1–5): complete

- T1 `701493ade` self-hosted Jost / Noto Sans / Noto Serif (incl. Serif 700); SW caches `/media/**`.
- T2 `0fa6be999` Sass palette, tokens, Bootstrap config, buttons, typography partials; old token block and global `h1` centering removed.
- T3 `299d0038a` global rules in `styles.scss` moved to tokens; `!important` card/bg-light overrides removed.
- T4 `e7cbd7698` headline CTAs (`btn-success` → `btn-next`).
- T5 `fcff4fb84` placeholder Tratt mark, regenerated icons, loading screen, manifest ("Tratt").

Open (deferred): manual browser checks (offline fonts, `/local` walkthrough, `/load`); `index.html` noscript `color: red`; leftover hard-coded colours in `styles.scss` (`.export-button`, jodit, `.btn-icon`); lockfile dev-flag churn after adding `sharp`; initial-bundle budget warning (2.69 MB, baseline unchecked).
