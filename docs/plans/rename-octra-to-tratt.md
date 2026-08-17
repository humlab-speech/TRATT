# Rename plan: OCTRA → TRATT

Goal: the product is called **TRATT** (never "VISP TRATT", never "VISP OCTRA", never "Octra")
everywhere a human can see it. Internal code identifiers follow only where the cost is low.

Baseline: 3901 matches of `octra` (case-insensitive) in 376 files (excl. `node_modules`, `.git`).
Branding work already landed for logos, favicon, `index.html`, `manifest.json` and the banner
tagline (commits `59d65fea8`, `ffa65dbff`, `a3ed886af`).

---

## 0. Scope decision: four tiers

| Tier | What | Rename? |
|---|---|---|
| **T1** | User-visible strings & docs | **Yes — required** |
| **T2** | Persisted identifiers (IndexedDB, storage keys, config keys, URLs) | Yes, with migration |
| **T3** | Internal code identifiers, paths, Nx project names, `@octra/*` aliases | Optional, staged, last |
| **T4** | External / legal | **No** |

**T4 — do not touch:**
- npm deps `@octra/api-types`, `@octra/ngx-octra-api` (upstream IPS-LMU packages, not ours).
- `octraBackend` API contract keys where they mirror the remote backend's payloads.
- `LICENSE.txt` / copyright attribution to the original OCTRA authors, and the README's
  "fork of OCTRA" provenance section — this must keep saying OCTRA (legal + honest attribution).
  Reword around it: "TRATT is a fork of [OCTRA](https://github.com/IPS-LMU/octra)".
- Git history, `CHANGELOG.md` entries already released.

---

## Phase 1 — User-visible strings (T1a: templates & TS)

Targets (grep `-i octra` in `*.html`, `*.ts`, excluding component selectors `octra-*`):

1. `apps/octra/src/app/core/component/navbar/navbar.component.html:18` — `VISP TRATT` → `TRATT`.
2. `apps/octra/src/app/core/modals/about-modal/about-modal.component.html:3` — `About VISP OCTRA` → `About TRATT`.
   Check the rest of the modal body for OCTRA prose and the VISP slogan image — decide whether the
   VISP slogan stays as an *organisation* mark (recommended: keep it in About + login footer only,
   as provenance, since it is not part of the product name).
3. `apps/octra/src/app/core/pages/login/login.component.html`, `loading.component.html`,
   `auth.component.html`, `visp-task.component.html`, `project-request-modal.component.html` —
   any literal OCTRA prose.
4. `apps/octra/src/app/app.info.ts:46` — manual URL
   `https://clarin.phonetik.uni-muenchen.de/apps/octra/manuals/octra/`. **Blocked on a decision:**
   is there a TRATT manual URL? If not, keep the OCTRA manual link but label it as the upstream
   manual; do not silently point users at a dead URL.
5. `scripts/generate-build-info.mjs:9` — comment says "VISP OCTRA version popover"; update text.
6. Alt texts / `aria-label`s containing OCTRA.

Rule: this phase changes **text nodes and attributes only**, never selectors (`<octra-audio-viewer>`),
never imports.

Verify: `npm run build:dev`, then `/run` the app and eyeball navbar, about modal, login, loading.

---

## Phase 2 — Localisation (T1b)

Files: `apps/octra/src/assets/i18n/{de,en,it,ko,nl,sv,zh}.json`
Hits: de 19, en 20, it 12, ko 12, nl 11, sv 21, zh 11 → **106 strings**.

Also: `apps/octra/src/config/localmode/guidelines/guidelines_{de,en,it,ko,nl,sv,zh}.json`.

Steps:

1. **Do not blind-`sed`.** Three distinct cases:
   - Product name in prose (`OCTRA is a free web-application…`, `Please use OCTRA locally.`) → `TRATT`.
   - Lower/mixed case (`octra sending your feedback`, `The Octra team`, `Octra saves your progress`)
     → `TRATT` (the name is an acronym-style wordmark; normalise casing while you are in there).
   - Interpolation params — `{{octraBackendURL}}` in `en.json:627` and siblings. The param name is
     supplied from component code; **either** rename the param in both places **or** leave it. Recommended:
     leave the param name, rename only the prose. Cheaper, zero risk.
2. Per-language wording review, not translation-by-substitution:
   - `sv` has the most hits (21) and is the primary VISP audience — TRATT is a Swedish word (funnel);
     check that sentences still read naturally (`OCTRA sparar` → `TRATT sparar`, article/gender agreement:
     TRATT is *en*-gender, `en tratt`, so `TRATT:s` for genitive).
   - `de` `der/die/das` agreement around the name; `zh`/`ko` — the name stays Latin-script,
     check the surrounding particles.
   - `it`/`nl` — straight substitution is usually fine.
3. Strings referencing the **OCTRA backend** as a system (`en.json:626-627`) keep "OCTRA backend" —
   that is the remote service's name, not ours.
4. Keep key names untouched in this phase (key renames are Phase 5).

Verify: `node apps/octra/scripts/validate-i18n.js` (existing locale validator) — must stay green;
key sets must remain identical across all 7 locales.

---

## Phase 3 — Docs & repo surface (T1c)

- `README.md` — title, body, the fork section (keep OCTRA attribution, see T4).
- `CLAUDE.md` — project description line.
- `libs/README.md`, `docs/plans/*` (7 files) — leave historical plans alone; only update if they
  describe current behaviour.
- `docs/assets/visp_octra_*.png` (7 screenshots) — stale branding. Re-capture after Phase 1–2 land,
  rename to `tratt_*.png`, update README links. Do this **after** the UI changes, not before.
- `docs/octra_core_workflow.{graphml,pdf}`, `images/octra_dependency_graph.png` — regenerate or leave;
  low value, mark as known-stale if skipped.
- `.run/OCTRA_START.run.xml`, `.run/OCTRA_DEBUG.run.xml` — IDE run configs, rename freely.

---

## Phase 4 — Persisted identifiers (T2) ⚠️ migration risk

**Read this before changing anything here: renaming a database or storage key orphans every existing
user's saved transcription session. The app's whole local-mode value proposition is "your last session
is still there".**

| Identifier | Location | Action |
|---|---|---|
| `'octra-recordings'` (Dexie DB) | `core/shared/octra-recording-database.ts:31` | Rename **only** with a migration that copies/opens the old DB name first; otherwise keep. |
| DB name from config `octra.database.name` = `"octra-2"` | `config/appconfig.json:9`, `appconfig_sample.json:5` | Same. Renaming = every deployed user loses their session. |
| `appconfig.json` top-level key `"octra"` | `config/*.json` + JSON schema in `libs/assets/src/lib/schemata/projectconfig.schema.{ts,json}` | Renameable, but breaks every existing deployment's config file. Needs schema change + accept-both-keys shim. |
| `octraBackend` config key | `appconfig.json:54` | Keep (T4, backend-owned). |
| localStorage/sessionStorage keys | `core/store/**`, `recording-devices.service.ts` | Audited: keys are generic (`cid`, `authType`, `language`) — **nothing to rename**. |
| Service worker cache | `apps/octra/ngsw-config.json` | Check for name-derived cache keys; a name change forces one extra cache bust. |

**Recommendation:** defer the whole of Phase 4 to a separate, explicitly-approved change. The product
rename does not require it. If it goes ahead, ship it as: read new name → fall back to old name →
copy → delete old, with a test that opens a DB seeded under the old name.

---

## Phase 5 — Code identifiers & structure (T3) — optional, do last, separate PRs

Cost estimate before committing to this:

| Item | Scale | Blast radius |
|---|---|---|
| `Octra*` classes (`OctraAnnotationSegment` 344, `OctraAnnotation` 82, `OctraModal` 49, `OctraAPIService` 28, …) | ~1000 refs | Pure rename, IDE-assisted. Public API of publishable libs → **semver-major for `@octra/annotation` etc.** |
| Component selector prefix `octra-` | every template + `eslint` `@angular-eslint/component-selector` rule | **`apps/web-components/` publishes these as custom element tags.** Renaming breaks external embedders. Needs a deprecation window or dual registration. |
| Nx project/dir `apps/octra` → `apps/tratt` | `project.json`, `nx.json`, `tsconfig*.json`, `jest.config.ts`, `eslint.config.cjs`, CI, npm scripts (`prestart:octra`, `analyze:octra`) | Use `nx g @nx/workspace:move`, not manual. One PR, nothing else in it. |
| `@octra/*` path aliases → `@tratt/*` | `tsconfig.base.json` + every import in 376 files | Collides conceptually with the real npm `@octra/api-types`. Doing this makes the two easier to tell apart — genuine upside. Still a huge diff. |
| Root `package.json` `"name": "octra-source"` | 1 line | Free. |
| File names (`octra-database.ts`, `octraAnnotationSegment.ts`, `octra-colors.ts`) | ~15 files | Free-ish, `git mv` + import fixups. |

**Recommended split:**
- 5a: root package name + file renames + `.run` configs. (cheap, no API change)
- 5b: `apps/octra` → `apps/tratt` via `nx g move`. (mechanical, isolated)
- 5c: `Octra*` symbols + `@octra/*` aliases. (major version bump of libs — only if the libs are not
  yet depended on externally)
- 5d: `octra-` selector prefix. (**breaking for web-components consumers — needs a product decision**)

If 5c/5d are not worth it, say so in the README instead: "TRATT is the product; `octra-` remains the
internal namespace for historical reasons." That is an honest, zero-risk outcome.

---

## Execution order & verification gates

```
Phase 1 (UI text)      → build:dev + manual smoke
Phase 2 (i18n)         → validate-i18n.js + switch each of 7 locales in the UI
Phase 3 (docs)         → re-capture screenshots
--- ship here; the rename is "done" for users ---
Phase 4 (persistence)  → separate approval, needs migration test
Phase 5a/b/c/d         → one PR each, npm test + build:libs + build green per PR
```

Gates for every phase: `npm run lint`, `npm test`, `npm run build`.
After Phase 5b/5c also `npm run build:libs`.

## Grep-based completion check

```bash
# should return only T4 hits (LICENSE, README provenance, @octra npm deps, octraBackend)
rg -i 'octra' -g '!node_modules' -g '!.git' -g '!CHANGELOG.md' \
   apps/*/src libs/*/src README.md CLAUDE.md

# user-visible: must return nothing
rg -i 'octra' apps/*/src/assets/i18n/ | grep -vi 'octraBackend'

# must return nothing anywhere
rg -i 'visp[ _-]?(tratt|octra)' -g '!node_modules'
```

## Status

- **Phase 1 — done.** UI strings, converter export headers, ELAN `_AUTHOR`, `main.ts` boot error,
  schema descriptions, `ocb_info.json`, bug-report protocol filename.
- **Phase 2 — done.** All 106 locale strings across 7 files; `sv` gender fix (`det` → `den`);
  `branding.tagline` added for de/it/ko/nl/zh (was en-only, the other locales fell back).
- **Phase 3 — done except screenshots.** README, CLAUDE.md, `Creating-Editors.md`,
  `.run/*.run.xml`, root package name (`octra-source` → `tratt-source`).
  `docs/assets/visp_octra_*.png` still show the old branding — re-capture needed.
- **Phase 4 — not started** (deliberate; needs a migration + approval).
- **Phase 5 — not started** (deliberate; internal identifiers, `@octra/*`, `octra-` selectors).

Kept as OCTRA on purpose: the upstream citation and translation-portal links in the About modal,
the "fork of OCTRA" provenance in README, the OCTRA backend service name in prose,
`OctraApplication` in `SupportedApplications.ts` (that entry *is* upstream OCTRA), `OCTRA_1` tier
names (annotation data format), `OCTRA_ASRqueueItem_*` temp filenames, `{{octraBackendURL}}`,
`@octra/*` npm deps and aliases, LICENSE.

## Open decisions (need an answer before the relevant phase)

1. **Manual URL** — is there a TRATT manual, or does the help link keep pointing at the OCTRA manual? (Phase 1)
2. **VISP slogan/logo** — stays in About + login footer as the organisation mark, or removed entirely? (Phase 1)
3. **Phase 4 at all?** — is losing existing users' local sessions acceptable, or do we write the migration? (Phase 4)
4. **`octra-` selector prefix** — are there external consumers of `apps/web-components`? If yes, 5d is off the table. (Phase 5d)
