# Tratt enligt Språkbankens grafiska profil – implementeringsplan

> **För agenter:** Använd superpowers:subagent-driven-development (rekommenderas) eller superpowers:executing-plans och genomför planen uppgift för uppgift. Stegen använder kryssrutor (`- [ ]`) för att följa upp arbetet.

**Mål:** Ge `/local` och `/workbench`, med redigerarna och signalvisningen som visas i `/workbench`, det utseende som designdokumentet beskriver. Det innebär Språkbankens färger med fasta roller, neutral gråskala, Jost\*/Noto, sidhuvud och sidfot enligt profilen och mörkt läge. WCAG 2.1 AA ska uppfyllas i båda temana.

**Spec:** [`docs/superpowers/specs/2026-10-12-sprakbanken-grafisk-profil-design.md`](../specs/2026-10-12-sprakbanken-grafisk-profil-design.md). Avsnittsnumren i den här planen (t.ex. "spec 3.2") hänvisar dit. Skisserna och referens-HTML finns i `docs/superpowers/specs/reference/sprakbanken-profil/`.

**Arkitektur:** Allt utseende styrs från ett tokenlager. Profilens fem färger finns på ett ställe som Sass-variabler. Därifrån konfigureras Bootstrap med `@use … with (…)`, och samma värden exponeras som CSS-variabler för komponenterna. Kanvasen läser variablerna vid körning. De gamla tokennamnen lever kvar som alias tills alla komponenter har konverterats, så att varje uppgift kan levereras för sig utan att något går sönder. Sidhuvudet byggs om i den befintliga `NavigationComponent`, eftersom redigerarens menyer finns där. Mitten av sidhuvudet fylls av sidan som visas, via en mall som sidan lånar ut.

**Teknik:** Angular 21 (fristående komponenter, signals, OnPush), Bootstrap 5.3.8 som Sass, ng-bootstrap, Transloco, Font Awesome Free 7, Konva för kanvasen, Jest och `@fontsource/*` för typsnitten.

---

## Utgångsläge (uppmätt 2026-10-12, `main` @ `f97504adf`)

| Vad                                          | Var                                                                                  | Mängd                                                                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tokens som speglar Visp och Umeå universitet | `apps/tratt/src/styles.scss` rad 1–129                                               | 47 variabler, 7 knappregler med 8 `!important`                                                                                                                                                                         |
| Hårdkodade färger                            | appen + `libs/ngx-components` (`.scss`, `.html`)                                     | 97 i 18 filer (flest i `bundle-list` 25, `workbench` 21, `login.component.html` 19, `capacity-indicator` 10)                                                                                                           |
| `font-size` i px                             | samma                                                                                | 22                                                                                                                                                                                                                     |
| Hårdkodade kanvasfärger och typsnitt         | `audio-viewer-renderer.service.ts`                                                   | 13 färger, `'Arial'` 3 ställen                                                                                                                                                                                         |
| Sidhuvudet                                   | `navbar.component.html`                                                              | 984 rader, `navbar-dark bg-primary`, `<main style="margin-top: 40px">`                                                                                                                                                 |
| Bannern på `/local`                          | `login.component.html` rad 1–75                                                      | inlinad SVG med `#1F4477`, Archivo och IBM Plex Mono                                                                                                                                                                   |
| Kontrastfel                                  | `.alert-warning` 1,76:1 · CTA vit på `#D47752` 3,2:1 · `#667A90` på `#EEF0F4` 3,87:1 |                                                                                                                                                                                                                        |
| Servicearbetaren                             | `apps/tratt/ngsw-config.json`                                                        | cachar inte `/media/**`, där bygget lägger typsnitt som refereras från CSS. Det gäller redan Font Awesome: i senaste bygget ligger `fa-*.woff2` i `dist/apps/tratt/media/`, men `ngsw.json` har inga `/media/`-poster. |

## Globala villkor

- **Gren:** `feat/sprakbanken-profil`. En commit per uppgift enligt Conventional Commits (`style(ui): …`, `feat(shell): …`, `refactor(tokens): …`). Commitizen används som i resten av repot.
- **Inga externa anrop.** Typsnitt, logotyper och ikoner levereras med appen. Inga CDN-länkar och ingen Google Fonts.
- **Beteendet ändras inte**, med tre undantag: dataväljaren i sidhuvudet (uppgift 8), temaväljaren (uppgift 21) och sidfoten (uppgift 9). Allt annat är markup och stil.
- **All UI-text går via Transloco.** `npm run validate:i18n` kräver att **alla sju språkfilerna** (`en`, `sv`, `de`, `nl`, `it`, `ko`, `zh`) har exakt samma nycklar. Värden under `workbench.*` måste dessutom skilja sig från engelskan i varje språk. Nya skal-texter läggs därför under `shell.*`, där engelsk text är tillåten i de/nl/it/ko/zh tills de översätts.
- **Signals och OnPush** för nytt tillstånd. Ingen ny NgRx-state.
- **Komponentstilar:** budgeten är 6 kB (varning) och 10 kB (fel) per komponent (`apps/tratt/project.json`). Gemensamma regler hör hemma i de globala partialfilerna, inte i komponenterna.
- **`libs/ngx-components` publiceras som paket** (`@tratt/ngx-components`). Biblioteket får inte förutsätta att appens CSS finns. Läs CSS-variabler med en fallback till `TRATT_COLORS`.
- **Kanvas-tokens skrivs som hex eller `rgba()`, aldrig som `color-mix()`.** De läses som strängar och skickas vidare till canvas.
- **Efter uppgift 2 tillkommer inga hårdkodade färger i komponentstilar.** Uppgift 25 gör det till en kontroll i CI.
- **Verifiera varje uppgift** med `npx nx test tratt` (eller `npx nx test ngx-components`), `npm run lint`, `npm run validate:i18n` och en visuell kontroll på `http://localhost:5321/local` och `/workbench` (`npm start`).

## Granskningsfokus

- **Kontrast.** Varje text- och färgkombination ska klara reglerna i spec 3.2. Kontrolleras automatiskt i uppgift 27.
- **Offline.** Typsnitten ska fungera efter en omladdning utan nätverk (uppgift 1).
- **Redigerarens menyer i sidhuvudet** (nivåer, talare, info, export, inställningar, konto, feedback) ska fungera exakt som förut i `/workbench`, i det klassiska transkriptionsläget och i onlineläget.
- **Exportknapparna i `/workbench`** ska nås både med och utan session, alltså i välkommen tillbaka-läget (uppgift 17).
- **Temabyte** får inte tappa markering, uppspelningsposition eller osparad text i redigeraren (uppgift 23).
- **Visp-inbäddningen** (`/visp-task/...`, `LoginMode.URL`) får bara nya färger och typsnitt, ingen ny layout.

## Ordning och beroenden

```
Fas 0  Beslut ─────────────────────────────────────────────┐ (påverkar 6, 9, 19, 26 – inget blockerar Fas 1)
Fas 1  1 typsnitt → 2 tokens/Bootstrap → 3 globala stilar → 4 knappsemantik → 5 laddningsskärm/manifest
Fas 2  6 logotyp → 7 sidhuvud → 8 dataväljare ; 9 sidfot (parallellt med 7–8)
Fas 3  10 → 11 → 12 → 13           (/local)        ┐
Fas 4  14 → 15 → 16 → 17           (/workbench)    ├ parallellt efter Fas 2
Fas 5  18 → 19 → 20                (kanvas)        ┘
Fas 6  21 → 22 → 23 → 24           (mörkt läge, kräver Fas 5)
Fas 7  25 → 26 → 27 → 28 → 29      (städning och verifiering)
```

---

## Fas 0 – Beslut och material

### Uppgift 0: Samla beslut och filer

Ingen kod. Planen fungerar med standardvärdena i högra kolumnen. Ett senare beslut påverkar bara de uppgifter som anges.

- [ ] **Steg 1:** Gå igenom spec avsnitt 9 med teamet och Språkbankens kommunikation. Anteckna besluten i specens tabell.

| #   | Beslut                                          | Standardvärde i planen                                                                                                    | Påverkar             |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 1   | Tratts logotyp och slogan                       | Platshållarsymbolen från skissen. Slogan sv "Språkbankens transkriberingsverktyg", en "Språkbanken's transcription tool". | 6 (byt fil och text) |
| 2   | TRATT → Tratt                                   | Ja                                                                                                                        | 6                    |
| 3   | Nodens logotyp och länk                         | Konfigurerbar och tom som standard, så att kolumnen döljs                                                                 | 9                    |
| 4   | Ingen sidfot på `/workbench`                    | Ja                                                                                                                        | 9                    |
| 5   | Erkännanden som text                            | Ja                                                                                                                        | 9                    |
| 6   | Brödtext `0.875rem`                             | Ja                                                                                                                        | 2                    |
| 7   | Grön = klar/på                                  | Ja                                                                                                                        | 14–16                |
| 8   | Talarpalett                                     | Enligt uppgift 19                                                                                                         | 19                   |
| 9   | Dataväljaren på `/local`                        | Tom                                                                                                                       | –                    |
| 10  | Samordning med Visp                             | Tokenfilen kan delas, se uppgift 2 steg 7                                                                                 | –                    |
| 11  | Länk till Arbetsbänken i sidhuvudet på `/local` | Ja, när `environment.workbenchEnabled`                                                                                    | 7                    |

- [ ] **Steg 2: Logotypfiler.** Språkbankens wordmark (`sprakbanken_logo.svg`) finns i [spraakbanken/communication](https://github.com/spraakbanken/communication/tree/main/logotypes). Repot är licensierat **GPL-3.0**, medan Tratt är **MIT**. Fråga Språkbanken (kontakt enligt communication-repot: Staffan Melin) om logotypfilerna får ingå i Tratts repo som varumärke. Det brukar lösas med ett skriftligt OK som noteras i `apps/tratt/src/assets/img/sprakbanken/README.md`.
- [ ] **Steg 3: Nodens logotyp** som SVG, om beslut 3 är klart.

---

## Fas 1 – Grund

### Uppgift 1: Självhostade typsnitt

**Filer:**

- Ändra: `package.json` (dependencies)
- Ändra: `apps/tratt/src/styles.scss` (översta raderna)
- Ändra: `apps/tratt/ngsw-config.json`

- [ ] **Steg 1: Installera.**

```bash
npm i @fontsource/jost@^5.2.5 @fontsource/noto-sans@^5.2.7 @fontsource/noto-serif@^5.2.6 --legacy-peer-deps
```

- [ ] **Steg 2: Ladda typsnitten först i `styles.scss`.** Lägg raderna överst, före `@use 'bootstrap/scss/bootstrap'`. Fontsources viktfiler (`300.css` osv.) innehåller alla delmängder med `unicode-range`, så webbläsaren hämtar bara det som används. Per-delmängdsfilerna (`latin-300.css`) saknar `unicode-range` och får **inte** användas, eftersom latin-ext då skulle skugga latin.

```scss
// Fonts are self-hosted: TRATT promises no external requests once loaded.
// Jost* = headings and UI, Noto Sans = data, Noto Serif = body text
// (Språkbanken graphic profile, spec section 4).
@use '@fontsource/jost/300.css';
@use '@fontsource/jost/400.css';
@use '@fontsource/jost/500.css';
@use '@fontsource/jost/700.css';
@use '@fontsource/noto-sans/400.css';
@use '@fontsource/noto-sans/600.css';
@use '@fontsource/noto-serif/400.css';
@use '@fontsource/noto-serif/400-italic.css';
```

- [ ] **Steg 3: Låt servicearbetaren cacha `media/`.** Angular lägger filer som refereras från CSS i `media/`. Det gäller de nya typsnitten och redan i dag Font Awesomes webbtypsnitt. Lägg till i gruppen `assets`:

```json
"files": ["/assets/**", "/config/**", "/media/**", "/favicon.ico"]
```

(`apps/tratt/src/media` kopieras också till `media/` som exempelljud. Med `installMode: lazy` cachas de bara om de faktiskt hämtas.)

- [ ] **Steg 4: Verifiera bygget.**

```bash
npm run build
ls dist/apps/tratt/media | grep -c 'jost-latin-.*\.woff2'      # 4 eller fler
grep -c '"/media/' dist/apps/tratt/ngsw.json                   # > 0
```

- [ ] **Steg 5: Verifiera offline.** Kör `npx http-server dist/apps/tratt -p 8080 -c-1` och öppna `http://localhost:8080/local` i Chrome. Ladda om en gång. Välj sedan DevTools → Network → Offline och ladda om igen. Under Elements → Computed → _Rendered Fonts_ för en rubrik ska det stå "Jost", inte ett systemtypsnitt. Ikonerna ska också synas.

- [ ] **Steg 6: Commit** `build(fonts): self-host Jost and Noto via fontsource and cache media/ in the service worker`

### Uppgift 2: Tokens och Bootstrap konfigurerad med Sass

**Filer:**

- Skapa: `apps/tratt/src/styles/_palette.scss`
- Skapa: `apps/tratt/src/styles/_bootstrap-config.scss`
- Skapa: `apps/tratt/src/styles/_tokens.scss`
- Skapa: `apps/tratt/src/styles/_legacy-tokens.scss`
- Skapa: `apps/tratt/src/styles/_typography.scss`
- Skapa: `apps/tratt/src/styles/_buttons.scss`
- Skapa: `apps/tratt/src/styles/_components.scss`
- Ändra: `apps/tratt/src/styles.scss` (rad 1–129 ersätts)

Bootstrap-konfigurationen nedan är provkompilerad mot exakt Bootstrap 5.3.8 och Sass 1.97.3. `btn-primary` får vit text (5,09:1), och `--bs-warning-bg-subtle` blir profilens 20-procentiga ton.

- [ ] **Steg 1: `_palette.scss`.** Det här är den enda platsen där profilens färger står som värden.

```scss
@use 'sass:color';

// Språkbanken graphic profile – the five brand colours. Change them here only.
$sb-orange: #f0581a; // graphics, actions that take the next workflow step
$sb-blue: #1e989f; // interactive elements, help
$sb-red: #d42225; // results that stop the workflow, destructive actions
$sb-yellow: #f6c200; // results that change the workflow; never text on white
$sb-green: #5aa018; // no role in the profile; TRATT: done / on

// Derived with the profile's own 80:20 rule (spec 3.2).
// strong = 80 % colour + 20 % black: text and small filled buttons, ≥ 4.5:1 on white.
@function strong($c) {
  @return color.mix($c, #000, 80%);
}
// tint = 20 % colour + 80 % base: backgrounds only.
@function tint($c, $base: #fff) {
  @return color.mix($c, $base, 20%);
}

$sb-orange-strong: strong($sb-orange); // ≈ #c04615, 5.09:1
$sb-blue-strong: strong($sb-blue); //     ≈ #187a7f, 5.09:1
$sb-red-strong: strong($sb-red); //       ≈ #aa1b1e, 7.28:1
$sb-green-strong: strong($sb-green); //   ≈ #488013, 4.80:1

// Neutral greys, R = G = B.
$grey-0: #fff;
$grey-50: #f5f5f5;
$grey-100: #ebebeb;
$grey-200: #d9d9d9; // hairlines
$grey-400: #8c8c8c; // control borders, 3.36:1
$grey-600: #595959; // secondary text, 7.0:1
$grey-900: #1a1a1a; // text, 17.4:1

// Dark mode.
$dark-page: #121212;
$dark-subtle: #1e1e1e;
$dark-sunken: #2a2a2a;
$dark-border: #333;
$dark-border-control: #6b6b6b;
$dark-text: #ededed;
$dark-text-muted: #a6a6a6;
$dark-link: color.mix($sb-blue, #fff, 80%); //       ≈ #4badb2
$dark-danger-text: color.mix($sb-red, #fff, 70%); // ≈ #e16466

$font-ui: ('Jost', system-ui, -apple-system, 'Segoe UI', sans-serif);
$font-data: ('Noto Sans', system-ui, -apple-system, 'Segoe UI', sans-serif);
$font-body: ('Noto Serif', Georgia, 'Times New Roman', serif);
```

- [ ] **Steg 2: `_bootstrap-config.scss`.** Det här är den första och enda platsen där Bootstrap laddas.

```scss
@use 'palette' as p;

@use 'bootstrap/scss/bootstrap' with (
  // Filled .btn-primary must carry white text: brand blue gives only 3.47:1,
  // so Bootstrap's primary is the strong variant (5.09:1). Brand blue itself
  // is used for borders, focus and checked controls below.
  $primary: p.$sb-blue-strong,
  $secondary: p.$grey-600,
  $success: p.$sb-green,
  $info: p.$sb-blue,
  $warning: p.$sb-yellow,
  $danger: p.$sb-red,
  $light: p.$grey-50,
  $dark: p.$grey-900,
  $body-color: p.$grey-900,
  $body-secondary-color: p.$grey-600,
  $border-color: p.$grey-200,
  $link-color: p.$sb-blue-strong,
  $font-family-sans-serif: p.$font-ui,
  $headings-font-weight: 400,
  $h1-font-size: 2.75rem,
  $h2-font-size: 1.5rem,
  $h3-font-size: 1.1875rem,
  $h4-font-size: 1.0625rem,
  $input-border-color: p.$grey-400,
  $form-check-input-border: 1px solid p.$grey-400,
  $form-check-input-checked-bg-color: p.$sb-blue,
  $form-check-input-checked-border-color: p.$sb-blue,
  $focus-ring-color: rgba(p.$sb-blue, 0.4),
  $progress-bar-bg: p.$sb-orange,
  $progress-bar-color: p.$grey-900,
  $body-bg-dark: p.$dark-page,
  $body-color-dark: p.$dark-text,
  $body-secondary-color-dark: p.$dark-text-muted,
  $body-tertiary-bg-dark: p.$dark-subtle,
  $border-color-dark: p.$dark-border,
  $link-color-dark: p.$dark-link,
  $link-hover-color-dark: p.$dark-text
);
```

- [ ] **Steg 3: `_tokens.scss`** (ljust läge. Mörkt läge läggs till i uppgift 22.)

```scss
@use 'palette' as p;

:root {
  --sb-orange: #{p.$sb-orange};
  --sb-blue: #{p.$sb-blue};
  --sb-red: #{p.$sb-red};
  --sb-yellow: #{p.$sb-yellow};
  --sb-green: #{p.$sb-green};
  --sb-orange-strong: #{p.$sb-orange-strong};
  --sb-blue-strong: #{p.$sb-blue-strong};
  --sb-red-strong: #{p.$sb-red-strong};
  --sb-green-strong: #{p.$sb-green-strong};
  --tint-base: #{p.$grey-0};

  // Surfaces and text
  --tratt-surface-page: #{p.$grey-0};
  --tratt-surface-subtle: #{p.$grey-50};
  --tratt-surface-sunken: #{p.$grey-100};
  --tratt-border: #{p.$grey-200};
  --tratt-border-control: #{p.$grey-400};
  --tratt-text-primary: #{p.$grey-900};
  --tratt-text-muted: #{p.$grey-600};

  // Roles (spec 3.1)
  --tratt-next: var(--sb-orange);
  --tratt-next-strong: var(--sb-orange-strong);
  --tratt-interactive: var(--sb-blue);
  --tratt-interactive-text: var(--sb-blue-strong);
  --tratt-danger: var(--sb-red);
  --tratt-danger-text: var(--sb-red-strong);
  --tratt-warning: var(--sb-yellow);
  --tratt-success: var(--sb-green);
  --tratt-success-text: var(--sb-green-strong);
  --tratt-info: var(--sb-blue);
  --tratt-on-color: #fff;

  // Signal display. Literal values only – read as strings for <canvas>
  // (libs/ngx-components/src/lib/obj/tratt-colors.ts mirrors them).
  --tratt-waveform-background: #ffffff;
  --tratt-waveform-signal: #595959;
  --tratt-segment-transcribed: rgba(0, 0, 0, 0.05);
  --tratt-segment-selected: rgba(30, 152, 159, 0.14);
  --tratt-boundary: #1e989f;
  --tratt-playhead: #f0581a;
  --tratt-canvas-grid: #d9d9d9;
  --tratt-canvas-text: #1a1a1a;

  // Type and measures
  --tratt-font-ui: 'Jost', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --tratt-font-data: 'Noto Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --tratt-font-body: 'Noto Serif', Georgia, 'Times New Roman', serif;
  --tratt-header-height: 4.5rem;
  --tratt-radius: 0.375rem;
}

// Tints are declared on every theme root so they recompute when
// --tint-base changes (a value computed on :root would not follow a
// [data-bs-theme] set further down the tree).
:root,
[data-bs-theme] {
  --sb-orange-tint: color-mix(in srgb, var(--sb-orange) 20%, var(--tint-base));
  --sb-blue-tint: color-mix(in srgb, var(--sb-blue) 20%, var(--tint-base));
  --sb-red-tint: color-mix(in srgb, var(--sb-red) 20%, var(--tint-base));
  --sb-yellow-tint: color-mix(in srgb, var(--sb-yellow) 20%, var(--tint-base));
  --sb-green-tint: color-mix(in srgb, var(--sb-green) 20%, var(--tint-base));
}
```

- [ ] **Steg 4: `_legacy-tokens.scss`.** De gamla namnen pekar på de nya, så att komponenter som ännu inte konverterats får rätt färger direkt. Aliasen tas bort i uppgift 26.

```scss
// Deprecated aliases for the pre-profile token names. Remove in task 26.
:root {
  --tratt-surface-card: var(--tratt-surface-page);
  --tratt-surface-background: var(--tratt-surface-subtle);
  --tratt-chrome: var(--tratt-interactive-text);
  --tratt-chrome-hover: color-mix(in srgb, var(--sb-blue) 65%, black);
  --tratt-on-chrome: var(--tratt-on-color);
  --tratt-cta: var(--tratt-next-strong);
  --tratt-cta-hover: color-mix(in srgb, var(--sb-orange) 70%, black);
  --tratt-cta-contrast: var(--tratt-next-strong);
  --tratt-on-cta: var(--tratt-on-color);
  --tratt-danger-surface: var(--sb-red-tint);
  --tratt-note-surface: var(--sb-yellow-tint);
  --tratt-link: var(--tratt-interactive-text);
  --tratt-accent-green: var(--tratt-interactive-text);
  --tratt-accent-green-dark: var(--tratt-chrome-hover);
  --tratt-accent-error: var(--tratt-danger);
  --tratt-accent-warning: var(--tratt-warning);
}
```

- [ ] **Steg 5: `_typography.scss`.** Profilen kräver ingen basstorlek och bara `rem`.

```scss
// No base font size is set: the browser owns it (Språkbanken profile).
body {
  font-family: var(--tratt-font-ui);
}

// Body text: Noto Serif. 0.875rem matches Jost's x-height at 1rem
// (0.536 em vs 0.46 em) – spec 4, decision 6.
.tratt-prose {
  font-family: var(--tratt-font-body);
  font-size: 0.875rem;
  line-height: 1.65;

  a {
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
}

// Tables and data: Noto Sans.
.tratt-data,
.table {
  font-family: var(--tratt-font-data);
  font-size: 0.875rem;
}

.tratt-num {
  font-variant-numeric: tabular-nums;
}

.tratt-label {
  font-family: var(--tratt-font-ui);
  font-weight: 500;
  font-size: 0.8125rem;
  letter-spacing: 0.02em;
  color: var(--tratt-text-muted);
}

kbd {
  font-family: var(--tratt-font-data);
  font-size: 0.75rem;
  color: var(--tratt-text-muted);
  background: var(--tratt-surface-page);
  border: 1px solid var(--tratt-border-control);
  border-bottom-width: 2px;
  border-radius: 0.25rem;
  padding: 0 0.3rem;
}
```

- [ ] **Steg 6: `_buttons.scss`.** Knapparna bygger på Bootstrap 5.3:s knappvariabler, så att fokus, inaktiverat läge och aktivt läge fungerar som i övriga knappar.

```scss
// "Next step" (orange). Small/normal size uses the strong variant (5.09:1).
.btn-next,
.btn-next-lg {
  --bs-btn-color: var(--tratt-on-color);
  --bs-btn-bg: var(--sb-orange-strong);
  --bs-btn-border-color: var(--sb-orange-strong);
  --bs-btn-hover-color: var(--tratt-on-color);
  --bs-btn-hover-bg: color-mix(in srgb, var(--sb-orange) 70%, black);
  --bs-btn-hover-border-color: color-mix(in srgb, var(--sb-orange) 70%, black);
  --bs-btn-active-color: var(--tratt-on-color);
  --bs-btn-active-bg: color-mix(in srgb, var(--sb-orange) 62%, black);
  --bs-btn-active-border-color: color-mix(in srgb, var(--sb-orange) 62%, black);
  --bs-btn-disabled-color: var(--tratt-on-color);
  --bs-btn-disabled-bg: var(--sb-orange-strong);
  --bs-btn-disabled-border-color: var(--sb-orange-strong);
  --bs-btn-focus-shadow-rgb: 240, 88, 26;
  --bs-btn-font-weight: 700;
}

// Large CTA: pure brand orange is allowed because ≥ 1.1875rem bold is WCAG
// "large text" (3:1 suffices; white on #f0581a is 3.43:1).
.btn-next-lg {
  --bs-btn-bg: var(--sb-orange);
  --bs-btn-border-color: var(--sb-orange);
  --bs-btn-hover-bg: var(--sb-orange-strong);
  --bs-btn-hover-border-color: var(--sb-orange-strong);
  --bs-btn-disabled-bg: var(--sb-orange);
  --bs-btn-disabled-border-color: var(--sb-orange);
  --bs-btn-font-size: 1.1875rem;
  --bs-btn-padding-y: 0.7rem;
  --bs-btn-padding-x: 1.25rem;
}

// Text-only buttons: blue for interaction, red for destructive actions.
.btn-text,
.btn-text-danger {
  --bs-btn-bg: transparent;
  --bs-btn-border-color: transparent;
  --bs-btn-hover-border-color: transparent;
  --bs-btn-active-border-color: transparent;
  --bs-btn-disabled-bg: transparent;
  --bs-btn-disabled-border-color: transparent;
  --bs-btn-disabled-color: var(--tratt-text-muted);
}
.btn-text {
  --bs-btn-color: var(--tratt-interactive-text);
  --bs-btn-hover-color: var(--tratt-interactive-text);
  --bs-btn-hover-bg: var(--sb-blue-tint);
  --bs-btn-active-color: var(--tratt-interactive-text);
  --bs-btn-active-bg: var(--sb-blue-tint);
}
.btn-text-danger {
  --bs-btn-color: var(--tratt-danger-text);
  --bs-btn-hover-color: var(--tratt-danger-text);
  --bs-btn-hover-bg: var(--sb-red-tint);
  --bs-btn-active-color: var(--tratt-danger-text);
  --bs-btn-active-bg: var(--sb-red-tint);
}

// Square icon button (player toolbar, header).
.btn-icon {
  --bs-btn-color: var(--tratt-text-primary);
  --bs-btn-bg: transparent;
  --bs-btn-border-color: transparent;
  --bs-btn-hover-color: var(--tratt-text-primary);
  --bs-btn-hover-bg: var(--sb-blue-tint);
  --bs-btn-hover-border-color: transparent;
  --bs-btn-active-bg: var(--sb-blue-tint);
  --bs-btn-padding-x: 0;
  --bs-btn-padding-y: 0;
  inline-size: 2.25rem;
  block-size: 2.25rem;
}
```

- [ ] **Steg 7: `_components.scss`** med flikar, varningsrutor, paneler och chips. Förlopps-staplarna styrs av Bootstrap-konfigurationen.

```scss
// Underline tabs used on /local and /workbench (add class="tratt-tabs").
.nav-tabs.tratt-tabs {
  --bs-nav-tabs-border-width: 0;
  --bs-nav-link-color: var(--tratt-interactive-text);
  --bs-nav-link-hover-color: var(--tratt-interactive-text);
  gap: 0.25rem;
  border-bottom: 1px solid var(--tratt-border);

  .nav-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: -1px;
    border: 0;
    border-bottom: 3px solid transparent;
    border-radius: 0;

    &:hover {
      background: var(--sb-blue-tint);
    }

    &.active {
      color: var(--tratt-text-primary);
      font-weight: 500;
      background: transparent;
      border-bottom-color: var(--tratt-interactive);
    }
  }
}

// Alerts: tint + coloured left edge; text keeps the text colour (spec 3.2 rule 3–4).
.alert {
  --bs-alert-color: var(--tratt-text-primary);
  --bs-alert-link-color: var(--tratt-interactive-text);
  border-width: 0 0 0 4px;
  border-radius: 0 var(--tratt-radius) var(--tratt-radius) 0;
}
.alert-warning {
  --bs-alert-bg: var(--sb-yellow-tint);
  --bs-alert-border-color: var(--sb-yellow);
}
.alert-danger {
  --bs-alert-bg: var(--sb-red-tint);
  --bs-alert-border-color: var(--sb-red);
}
.alert-success {
  --bs-alert-bg: var(--sb-green-tint);
  --bs-alert-border-color: var(--sb-green);
}
.alert-info {
  --bs-alert-bg: var(--sb-blue-tint);
  --bs-alert-border-color: var(--sb-blue);
}

.tratt-panel {
  background: var(--tratt-surface-subtle);
  border-radius: 0.5rem;
  padding: 1rem;
}

.tratt-chip {
  display: inline-block;
  padding: 0 0.55rem;
  border-radius: 999px;
  background: var(--tratt-surface-sunken);
  color: var(--tratt-text-primary);
  font-family: var(--tratt-font-data);
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: nowrap;
}
```

- [ ] **Steg 8: Ersätt rad 1–129 i `styles.scss`.** Det gäller de gamla `:root`-blocken, Bootstrap-mappningen och alla `.btn.btn-*`-regler med `!important`. Ersätt dem med:

```scss
@use '@fontsource/jost/300.css'; // … (block from task 1, unchanged)
@use 'styles/bootstrap-config';
@use '@fortawesome/fontawesome-free/css/all.css';
@use 'styles/tokens';
@use 'styles/legacy-tokens';
@use 'styles/typography';
@use 'styles/buttons';
@use 'styles/components';
```

Ta också bort raden `@use 'bootstrap/scss/bootstrap';`. Bootstrap laddas nu i `bootstrap-config`.

- [ ] **Steg 9: Kontrollera.** Kör `npm start` och öppna `/local`. Texten ska vara i Jost, och länkar och flikar i stark blå. Knappen _Manuell transkription_ är fortfarande `btn-primary` och alltså blå (den blir orange i uppgift 13). I DevTools ska `getComputedStyle(document.body).getPropertyValue('--bs-primary')` ge `rgb(24, 121.6, 127.2)`. Sass ≥ 1.79 skriver blandade färger med decimaler, vilket är giltig CSS.

- [ ] **Steg 10: Commit** `refactor(tokens): introduce Språkbanken palette, configure Bootstrap via Sass, keep legacy aliases`

**Delning med Visp (beslut 10):** `_palette.scss` och `_tokens.scss` har inga beroenden på Tratt. Om Visp-teamet vill ha samma tokens kan filerna flyttas till `libs/assets/src/styles/` och användas därifrån. Det görs inte i den här planen.

### Uppgift 3: Globala regler i `styles.scss`

**Filer:** Ändra `apps/tratt/src/styles.scss` (reglerna som är kvar efter uppgift 2).

- [ ] **Steg 1:** Gör följande ändringar regel för regel:

| Regel                                                                                              | Ändring                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `body`, `main` – `background-color: var(--tratt-surface-background)`                               | `var(--tratt-surface-page)`                                                                                                     |
| `footer { text-align: center; font-size: 10px }`                                                   | Ta bort. Kör först `grep -rn "<footer" apps/tratt/src/app` och kontrollera att bara `login.component.html` använder `<footer>`. |
| `.alert-warning { color: …; background-color: …; border-color: … }`                                | Ta bort. Ersätts av `.alert-warning` i `_components.scss`.                                                                      |
| `.bg-white, .bg-light, .card, .dropdown-menu, .panel { background-color: … !important }`           | Ta bort. Bootstraps standardvärden gäller (vitt, och `$light` = `#F5F5F5`).                                                     |
| `.btn-info, .bg-info, .btn-info:hover { … }`                                                       | Ta bort. Bootstrap genererar dem från `$info` (blå med svart text, 5,0:1).                                                      |
| `.modal-content { border-radius: 20px !important; background-color: … }`                           | `border-radius: 0.5rem;`, ingen bakgrund                                                                                        |
| `.highlighted { background-color: yellow; border: 1px solid dimgray }`                             | `background-color: var(--sb-yellow-tint); border: 1px solid var(--tratt-border-control);`                                       |
| `.val-error { border: 1px solid red }`                                                             | `var(--tratt-danger)`                                                                                                           |
| `.seg-popover { border: 1px solid var(--tratt-accent-warning) }`                                   | `var(--tratt-border-control)`                                                                                                   |
| `.note-toolbar button…{ color: black }` och `:hover { background-color: lightgrey; color: black }` | `var(--tratt-text-primary)` och `var(--tratt-surface-sunken)`                                                                   |
| `.column…gu-mirror` (`gray`, `lightgray`, `rgba(0,0,0,.87)`, `font-size: 14px`)                    | `var(--tratt-text-muted)`, `var(--tratt-border)`, `var(--tratt-text-primary)` och `0.875rem`                                    |
| `#editor-change-font-btn { border: 1px solid gray }`                                               | `var(--tratt-border-control)`                                                                                                   |
| `.beta_mark { color: red; … }`                                                                     | Kvar tills vidare. Tas bort i uppgift 7.                                                                                        |

- [ ] **Steg 2:** Gå igenom alla sidor i omfattningen samt `/news`, `/features`, `/help-tools` och onlineinloggningen (`/login`) med `npm start`. Inget ska ha blivit oläsligt. Färgerna får skilja sig från förut.
- [ ] **Steg 3: Commit** `style(global): move global rules onto the new tokens`

### Uppgift 4: Knappsemantik

**Filer:**

- Ändra: `apps/tratt/src/app/core/modals/overview-modal/overview-modal.component.html:66`
- Ändra: `apps/tratt/src/app/core/modals/re-authentication-modal/re-authentication-modal.component.html:32`
- Ändra: `apps/tratt/src/app/core/pages/help-tools/help-tools.component.html` (rad 8, 33, 58, 81 och 118)
- Ändra: `apps/tratt/src/app/core/pages/intern/projects-list/project-request-modal/project-request-modal.component.html:65`

- [ ] **Steg 1:** `btn-success` användes som "rubrik-CTA" (enligt kommentaren i gamla `styles.scss`). Byt de 8 förekomsterna mot `btn-next`. På `overview-modal:66` står `btn btn-primary btn-outline btn-success`. Där blir det `btn btn-next`.
- [ ] **Steg 2:** Kör `grep -rn "btn-success" apps/tratt/src/app libs/ngx-components/src --include=*.html --include=*.ts | grep -v spec`. Resultatet ska vara tomt.
- [ ] **Steg 3: Commit** `style(buttons): map headline CTAs to the orange next-step button`

### Uppgift 5: Laddningsskärm, manifest och favicon

**Filer:**

- Skapa: `apps/tratt/src/assets/img/tratt/tratt-mark.svg`
- Ändra: `apps/tratt/src/index.html`
- Ändra: `apps/tratt/src/manifest.json`
- Ändra: `apps/tratt/src/app/core/pages/loading/loading.component.html`
- Skapa: `scripts/render-icons.mjs`
- Ändra: `package.json` (`sharp` som devDependency, eftersom det i dag bara finns transitivt)

- [ ] **Steg 1: Symbolen (platshållare, beslut 1).** Vågformsstaplarna är riktiga hål (`evenodd`), så filen fungerar på alla bakgrunder, också som `<img>`.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 40" width="48" height="40" role="img" aria-label="Tratt">
  <!-- Placeholder until Språkbanken delivers the logo (decision 1). -->
  <path fill="#F0581A" fill-rule="evenodd" d="M3 2h42a2 2 0 0 1 1.5 3.3L29 24.5V37l-6 2.8V24.5L1.5 5.3A2 2 0 0 1 3 2zM11 9.7a1.1 1.1 0 0 1 2.2 0v0.8a1.1 1.1 0 0 1-2.2 0zM15 7.5a1.1 1.1 0 0 1 2.2 0v5.2a1.1 1.1 0 0 1-2.2 0zM19 6.3a1.1 1.1 0 0 1 2.2 0v7.6a1.1 1.1 0 0 1-2.2 0zM23 8a1.1 1.1 0 0 1 2.2 0v4.2a1.1 1.1 0 0 1-2.2 0zM27 6.7a1.1 1.1 0 0 1 2.2 0v6.8a1.1 1.1 0 0 1-2.2 0zM31 8.5a1.1 1.1 0 0 1 2.2 0v3.2a1.1 1.1 0 0 1-2.2 0zM35 10a1.1 1.1 0 0 1 2.2 0v0.2a1.1 1.1 0 0 1-2.2 0z"/>
</svg>
```

Kopiera filen till `tratt-favicon.svg` och `tratt-favicon-transparent.svg`, så att befintliga referenser i `index.html`, `manifest.json`, `loading.component.html` och `auth.component.html` fungerar utan ändring.

- [ ] **Steg 2: PNG-ikoner** i 16, 24, 32, 48, 64, 128, 256 och 512 px till `apps/tratt/src/assets/img/tratt/icons/`. Kör `npm i -D sharp@^0.35` och skapa sedan `scripts/render-icons.mjs`:

```js
// Renders the PNG app icons from the SVG mark. Run: node scripts/render-icons.mjs
import sharp from 'sharp';
const src = 'apps/tratt/src/assets/img/tratt/tratt-mark.svg';
const out = 'apps/tratt/src/assets/img/tratt/icons';
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  // Maskable icons need a safe zone: pad the mark to 80 % on white.
  const inner = Math.round(size * 0.8);
  const mark = await sharp(src, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(`${out}/${size}x${size}.png`);
}
```

- [ ] **Steg 3: `index.html`.** Det inlinade `<style>`-blocket gäller innan appens CSS har laddats, så variablerna behöver fallback-värden:

```css
.progress {
  height: 4px !important;
  background: var(--tratt-surface-sunken, #ebebeb) !important;
  border: 0 !important;
  border-radius: 0;
}
.progress-bar {
  background-color: var(--sb-orange, #f0581a) !important;
}
```

Byt texterna `TRATT - Orthographic Transcription` → `Tratt – Språkbankens transkriberingsverktyg` (`<title>`, `og:title`, `twitter:title`) och `Please wait... TRATT is loading...` → `Tratt laddas …`. Byt "TRATT" mot "Tratt" i `description`-metataggarna (beslut 2).

- [ ] **Steg 4: `manifest.json`.** Sätt `"theme_color": "#ffffff"`, `"background_color": "#ffffff"`, `"name": "Tratt"`, `"short_name": "Tratt"` och byt "TRATT" mot "Tratt" i `description`.
- [ ] **Steg 5: `loading.component.html`.** Byt `'background-color': 'red'` mot `'background-color': 'var(--tratt-danger)'`.
- [ ] **Steg 6:** Ladda om `/load` och kontrollera att laddningsskärmen visar den orange symbolen och en orange stapel.
- [ ] **Steg 7: Commit** `style(branding): placeholder Tratt mark, icons, loading screen and manifest`

---

## Fas 2 – Skal

### Uppgift 6: Logotypkomponent och namnform

**Filer:**

- Skapa: `apps/tratt/src/app/core/component/tratt-logo/tratt-logo.component.ts`
- Skapa: `apps/tratt/src/app/core/component/tratt-logo/tratt-logo.component.scss`
- Skapa: `apps/tratt/src/app/core/component/tratt-logo/tratt-logo.component.spec.ts`
- Ändra: `apps/tratt/src/app/core/component/index.ts` (export)
- Ändra: `apps/tratt/src/assets/i18n/*.json` (7 filer)
- Ändra: `apps/tratt/src/app/core/modals/about-modal/about-modal.component.html` (rubriken)

- [ ] **Steg 1: Test först.**

```ts
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { TrattLogoComponent } from './tratt-logo.component';

describe('TrattLogoComponent', () => {
  const create = (tagline: boolean) => {
    TestBed.configureTestingModule({
      imports: [
        TrattLogoComponent,
        TranslocoTestingModule.forRoot({
          langs: { en: { branding: { tagline: 'Språkbanken’s transcription tool' } } },
          translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
    });
    const f = TestBed.createComponent(TrattLogoComponent);
    f.componentRef.setInput('tagline', tagline);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  };

  it('renders the name, the mark and the tagline', () => {
    const el = create(true);
    expect(el.querySelector('.tratt-logo__name')?.textContent?.trim()).toBe('Tratt');
    expect(el.querySelector('img.tratt-logo__mark')?.getAttribute('alt')).toBe('');
    expect(el.querySelector('.tratt-logo__tagline')?.textContent).toContain('transcription tool');
  });

  it('can omit the tagline', () => {
    expect(create(false).querySelector('.tratt-logo__tagline')).toBeNull();
  });
});
```

Kontrollera hur andra spec-filer i repot sätter upp Transloco, till exempel `bundle-list.component.spec.ts`, och gör likadant om repot har en egen hjälpare.

- [ ] **Steg 2: Komponenten.**

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Platform logo per the Språkbanken profile: name in Jost Light, the orange
 * mark, tagline in Jost Medium. Until Språkbanken delivers the logo as an SVG
 * (decision 1), the name and tagline are live text so the tagline follows the
 * interface language.
 */
@Component({
  selector: 'tratt-logo',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tratt-logo__name">Tratt</span>
    <img class="tratt-logo__mark" src="assets/img/tratt/tratt-mark.svg" alt="" width="44" height="37" />
    @if (tagline()) {
      <span class="tratt-logo__tagline">{{ 'branding.tagline' | transloco }}</span>
    }
  `,
  styleUrl: './tratt-logo.component.scss',
  host: { class: 'tratt-logo' },
})
export class TrattLogoComponent {
  readonly tagline = input(true);
}
```

```scss
:host {
  display: inline-grid;
  grid-template-columns: auto 1fr;
  column-gap: 0.2rem;
  align-items: end;
  color: var(--tratt-text-primary);
  line-height: 1;
}
.tratt-logo__name {
  font-family: var(--tratt-font-ui);
  font-weight: 300;
  font-size: 2.125rem;
  line-height: 0.9;
  letter-spacing: -0.01em;
}
.tratt-logo__mark {
  justify-self: start;
  inline-size: 2.75rem;
  block-size: auto;
  margin: 0 0 -0.15rem 0.1rem;
}
.tratt-logo__tagline {
  grid-column: 1 / -1;
  margin-top: 0.3rem;
  font-family: var(--tratt-font-ui);
  font-weight: 500;
  font-size: 0.75rem;
}
@media (max-width: 575.98px) {
  .tratt-logo__name {
    font-size: 1.75rem;
  }
  .tratt-logo__tagline {
    display: none;
  }
}
```

- [ ] **Steg 3: Texter.** Ändra `branding.tagline` till `"Språkbankens transkriberingsverktyg"` i `sv.json` och `"Språkbanken's transcription tool"` i `en.json` och de fem övriga filerna.
- [ ] **Steg 4: TRATT → Tratt (beslut 2)** i **värden**, aldrig i nycklar. Kör från repots rot:

```bash
node -e '
const fs=require("fs"),dir="apps/tratt/src/assets/i18n";
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith(".json"))) {
  const p=dir+"/"+f, j=JSON.parse(fs.readFileSync(p,"utf8"));
  const walk=o=>{for(const k in o){if(typeof o[k]==="string")o[k]=o[k].replace(/\bTRATT\b/g,"Tratt");else if(o[k]&&typeof o[k]==="object")walk(o[k]);}};
  walk(j); fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
}'
git diff --stat apps/tratt/src/assets/i18n
```

Antalet ändrade rader ska ligga nära 20 (en), 21 (sv), 19 (de), 11 (nl), 12 (it), 12 (ko) och 11 (zh). Jämför med `git diff` och kontrollera att filernas formatering (indrag och radslut) är oförändrad, så att bara värdena ändras. Kör annars `npx prettier --write apps/tratt/src/assets/i18n`. Byt också `About TRATT` → `Om Tratt` / `About Tratt` i `about-modal.component.html`. Rubriken är hårdkodad på engelska, så gör den till nyckeln `shell.about.title`.

- [ ] **Steg 5:** Kör `npm run validate:i18n` och `npx nx test tratt --testPathPattern=tratt-logo`.
- [ ] **Steg 6: Commit** `feat(branding): Tratt logo component; TRATT → Tratt in UI texts`

### Uppgift 7: Sidhuvudet

**Filer:**

- Ändra: `apps/tratt/src/app/core/component/navbar/navbar.component.html`
- Ändra: `apps/tratt/src/app/core/component/navbar/navbar.component.scss`
- Ändra: `apps/tratt/src/app/core/component/navbar/navbar.component.ts`
- Ändra: `apps/tratt/src/app/app.component.html`
- Ändra: `apps/tratt/src/app/app.component.scss`
- Ändra: `apps/tratt/src/app/core/modals/about-modal/about-modal.component.html` och `.ts`
- Ändra: `apps/tratt/src/styles.scss` (ta bort `.beta_mark`)
- Ändra: `apps/tratt/src/assets/i18n/*.json`

Strukturen behålls. Menyinnehållet (nivåer, talare, info, export, inställningar, konto, feedback och språk) flyttas inte. Bara skalet runt det byts.

- [ ] **Steg 1: `<nav>`.** Ersätt öppningstaggen:

```html
<nav class="navbar fixed-top navbar-expand-md tratt-header" [attr.aria-label]="'shell.header.label' | transloco" #navbar id="navbar"></nav>
```

- [ ] **Steg 2: Varumärket.** Ersätt `<a [ngbPopover]="versionPopover" … class="navbar-brand …"> <img …/>TRATT … </a>` och `<ng-template #versionPopover>` med:

```html
<a class="navbar-brand tratt-header__brand" [routerLink]="homeLink" [queryParamsHandling]="'merge'">
  <tratt-logo [tagline]="true" />
  @if (environment.beta_version && !localOnly) {
  <span class="badge rounded-pill text-bg-secondary ms-2 align-self-center">beta</span>
  }
</a>
```

I `navbar.component.ts` lägger du till `TrattLogoComponent` och `RouterLink` (om den saknas) i `imports` och lägger till

```ts
/** The logo links to the start of the current mode (Språkbanken profile). */
public get homeLink(): string {
  return isWorkbenchRoute(this.router.url) ? '/workbench' : '/local';
}
```

`isWorkbenchRoute` importeras från `../../store/login-mode/annotation/annotation-load.effects`. Om den importen drar in för mycket kod, flytta funktionen till `core/shared/` och importera den från båda ställena.

- [ ] **Steg 3: Mitten.** Precis efter `</a>` lägger du till platsen som uppgift 8 fyller:

```html
<div class="tratt-header__center">
  @if (headerSlots.center(); as tpl) {
  <ng-container [ngTemplateOutlet]="tpl" />
  }
</div>
```

Injicera `public headerSlots: HeaderSlotService` (skapas i uppgift 8. Gör uppgift 8 steg 1–2 först om du arbetar sekventiellt.)

- [ ] **Steg 4: Höger.**
  - `<div class="collapse navbar-collapse" …>`: lägg till klassen `justify-content-md-end`. Byt `me-auto` mot `ms-md-auto` på båda `ul.navbar-nav`.
  - Den utloggade listan ska innehålla, i ordning: _Login_ (bara `!localOnly`, som i dag); _Arbetsbänk_ (ny, `@if (environment.workbenchEnabled && localOnly && homeLink === '/local')`, `routerLink="/workbench"`, ikon `fa-layer-group`, text `'shell.header.workbench' | transloco`); _Manual_ med ikon `fa-book`; _Om Tratt_.
  - **Ta bort _GitHub_** härifrån. Den läggs i Om-dialogen i steg 7.
  - **Ta bort** `<li class="nav-item d-flex align-items-center me-1"><span class="nav-link">{{ 'p.language selector short label' | transloco }}</span></li>`. Nyckeln `p.language selector short label` kan tas bort ur alla sju språkfilerna.
  - Språkväljarens knapp ska visa globen och det aktiva språkets namn:

```html
<i class="fa-solid fa-globe" aria-hidden="true"></i>
<span class="d-none d-lg-inline">{{ nativeLanguageName(langService.getActiveLang()) }}</span>
<span class="d-lg-none">{{ langService.getActiveLang() | uppercase }}</span>
<i class="fa-solid fa-chevron-down tratt-header__chevron" aria-hidden="true"></i>
```

- Feedbackikonen: byt `style="color: #fcffba"` och `[ngStyle]="{ color: errorsFound ? 'red' : '#fcffba' }"` mot `[class.text-danger]="errorsFound"`, som annars ärver länkfärgen.
- Lämna en tom `<li class="nav-item" id="tratt-theme-slot"></li>` före språkväljaren. Temaknappen läggs dit i uppgift 21.

- [ ] **Steg 5: `navbar.component.scss`.** Ta bort `.bg-primary { … }` och `.dropdown-toggle::after { content: unset; }`. Det senare görs nu via `.tratt-header__chevron` och regeln nedan. Lägg till:

```scss
.tratt-header {
  --bs-navbar-color: var(--tratt-interactive-text);
  --bs-navbar-hover-color: var(--tratt-interactive-text);
  --bs-navbar-active-color: var(--tratt-text-primary);
  --bs-navbar-brand-color: var(--tratt-text-primary);
  --bs-navbar-brand-hover-color: var(--tratt-text-primary);
  --bs-navbar-toggler-border-color: var(--tratt-border-control);
  min-block-size: var(--tratt-header-height);
  padding-block: 0;
  background: var(--tratt-surface-page);
  border-bottom: 1px solid var(--tratt-border);
  font-family: var(--tratt-font-ui);

  .nav-link {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border-radius: var(--tratt-radius);
    padding-inline: 0.6rem;

    &:hover {
      background: var(--sb-blue-tint);
    }
  }

  .dropdown-toggle::after {
    display: none;
  }
}

.tratt-header__chevron {
  font-size: 0.7em;
}

.tratt-header__brand {
  display: inline-flex;
  align-items: center;
  margin: 0;
  padding: 0.35rem 0;
}

@media (min-width: 768px) {
  .tratt-header > .container-fluid {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    block-size: var(--tratt-header-height);
  }
  .tratt-header__center {
    justify-self: center;
  }
  .tratt-header .navbar-collapse {
    justify-self: end;
  }
}

@media (max-width: 767.98px) {
  .tratt-header__center {
    order: 3;
    inline-size: 100%;
  }
}
```

Kontrollera rullgardinerna i menyn (nivåer, talare, info, konto). De har egna inlinade stilar med `color: black` i `navbar.component.scss` (`.dropdown-menu.options-menu.show label`, `.dropdown-menu h4`, `.level-row div`). Byt dem mot `var(--tratt-text-primary)`, och byt `.level-row.selected * { background-color: rgb(165, 250, 190) }` mot `var(--sb-blue-tint)`.

- [ ] **Steg 6: Sidans förskjutning.** I `app.component.html` byter du `<main style="margin-top: 40px">` mot `<main class="tratt-main">` och tar bort `beta_mark`-diven. I `app.component.scss` lägger du till:

```scss
.tratt-main {
  margin-top: var(--tratt-header-height);
}
```

Ta bort `.beta_mark` ur `styles.scss`. Jämför sedan Visp-inbäddningen (`/visp-task/project/1/session/1/bundle/1`) före och efter. Innehållet ska börja direkt under sidhuvudet, varken under det eller med ett glapp. Om sidhuvudet inte visas i inbäddningen, ska `.tratt-main` ha samma förskjutning som i dag (40 px) där.

- [ ] **Steg 7: Om-dialogen** får det som togs bort ur sidhuvudet:
  - en länk _Källkod på GitHub_ (`https://github.com/humlab-speech/TRATT`, ikonen `fa-brands fa-github`)
  - versionsinformationen från den gamla `versionPopover` (`AppInfo.BUILD.version`, `.timestamp`, `.hash`) längst ner i `modal-body` (`AboutModalComponent` får en getter `AppInfo`, som i navbaren)
  - logotyperna får klassen `tratt-logo-on-light`, som används för mörkt läge i uppgift 24.
- [ ] **Steg 8: Texter** (alla sju filerna): `shell.header.label` (en "Main navigation", sv "Huvudnavigering"), `shell.header.workbench` (en "Workbench", sv "Arbetsbänk"), `shell.about.title` (från uppgift 6), `shell.about.source_code` (en "Source code on GitHub", sv "Källkod på GitHub") och `shell.about.version` (en "Version", sv "Version").
- [ ] **Steg 9: Kontrollera manuellt:**
  - `/local` i 1440, 1024, 768 och 400 px. Under 768 px ska menyn fällas ihop bakom knappen och logotypen visas utan slogan under 576 px.
  - `/workbench` med en fil inläst: nivåer, talare, info, export och inställningar ska öppnas och fungera.
  - Det klassiska transkriptionsläget (`/intern/transcr`): redigerarknapparna i menyn ska fungera.
  - `/login` med onlineläget aktiverat: _Login_ syns och kontomenyn fungerar efter inloggning.
- [ ] **Steg 10: Commit** `feat(shell): white header per the Språkbanken profile (logo, centre slot, right-hand menu)`

### Uppgift 8: Dataväljaren

**Filer:**

- Skapa: `apps/tratt/src/app/core/shared/service/header-slot.service.ts`
- Skapa: `apps/tratt/src/app/core/shared/directive/header-center.directive.ts`
- Skapa: `apps/tratt/src/app/core/component/data-selector/data-selector.component.ts`, `.html`, `.scss` och `.spec.ts`
- Skapa: `apps/tratt/src/app/core/component/bundle-list/select-local-bundle.ts` och `.spec.ts`
- Ändra: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.ts` (`selectBundle`)
- Ändra: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`, `.html` och `.spec.ts`
- Ändra: `apps/tratt/src/assets/i18n/*.json`

Sidan behåller både data och logik. Arbetsbänken lånar ut en `TemplateRef` till sidhuvudet, och mallens bindningar körs i arbetsbänkens kontext. Det betyder att getter-beräkningen `selectedBundleHeader` gäller precis som i dag, utan att något tillstånd flyttas.

- [ ] **Steg 1: Tjänsten.**

```ts
import { Injectable, signal, TemplateRef } from '@angular/core';

/** Lets a page lend the header its centre (the data selector, per profile). */
@Injectable({ providedIn: 'root' })
export class HeaderSlotService {
  private readonly _center = signal<TemplateRef<unknown> | null>(null);
  readonly center = this._center.asReadonly();

  setCenter(tpl: TemplateRef<unknown>): void {
    this._center.set(tpl);
  }

  /** Only clears if `tpl` is still the registered one (route transitions overlap). */
  clearCenter(tpl: TemplateRef<unknown>): void {
    if (this._center() === tpl) {
      this._center.set(null);
    }
  }
}
```

- [ ] **Steg 2: Direktivet.**

```ts
import { Directive, inject, OnDestroy, OnInit, TemplateRef } from '@angular/core';
import { HeaderSlotService } from '../service/header-slot.service';

/** `<ng-template trattHeaderCenter>…</ng-template>` renders in the header's centre. */
@Directive({ selector: '[trattHeaderCenter]' })
export class HeaderCenterDirective implements OnInit, OnDestroy {
  private readonly tpl = inject(TemplateRef);
  private readonly slots = inject(HeaderSlotService);

  ngOnInit(): void {
    this.slots.setCenter(this.tpl);
  }

  ngOnDestroy(): void {
    this.slots.clearCenter(this.tpl);
  }
}
```

Test i `header-slot.service.spec.ts`: att `setCenter` och sedan `clearCenter(annan)` inte rensar, och att `clearCenter(samma)` gör det.

- [ ] **Steg 3: Gemensam val-funktion.** Den här logiken finns i dag bara i `BundleListComponent.selectBundle()` (rad 344–354). Dataväljaren behöver samma beteende, inklusive att skrivning som väntar sparas innan valet flyttas.

```ts
import { Store } from '@ngrx/store';
import { LoginMode } from '../../store';
import { LoginModeActions } from '../../store/login-mode';
import { PendingEditsService } from '../../shared/service/pending-edits.service';

/**
 * Selects a LOCAL bundle. Flushes the editor's debounced typing first –
 * afterwards it would be routed into the newly selected bundle.
 */
export function selectLocalBundle(store: Store<any>, pendingEdits: PendingEditsService, currentId: string | undefined, bundleId: string): void {
  if (currentId === bundleId) return;
  pendingEdits.flush();
  store.dispatch(LoginModeActions.selectBundle({ mode: LoginMode.LOCAL, bundleId }));
}
```

Kopiera importvägarna exakt från `bundle-list.component.ts`. Låt `BundleListComponent.selectBundle()` anropa funktionen. Det befintliga beteendetestet i `bundle-list.component.spec.ts` ska fortsätta gå igenom utan ändring. Skriv `select-local-bundle.spec.ts` med tre fall: samma id gör ingenting, `flush` anropas före `dispatch`, och rätt action skickas.

- [ ] **Steg 4: Komponenten `DataSelectorComponent`.**

```ts
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { TranslocoPipe } from '@jsverse/transloco';

export interface DataSelectorHeader {
  name: string;
  durationText?: string;
  sampleRateKhz?: number;
  channels?: number;
  sizeText?: string;
}

@Component({
  selector: 'tratt-data-selector',
  imports: [NgbDropdownModule, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-selector.component.html',
  styleUrl: './data-selector.component.scss',
})
export class DataSelectorComponent {
  readonly header = input.required<DataSelectorHeader>();
  readonly files = input<{ id: string; name: string }[]>([]);
  readonly selectedId = input<string | undefined>(undefined);
  readonly selectFile = output<string>();

  readonly position = computed(() => {
    const i = this.files().findIndex((f) => f.id === this.selectedId());
    return i < 0 ? undefined : { index: i + 1, total: this.files().length };
  });
}
```

```html
<div ngbDropdown class="tratt-data-selector" placement="bottom" display="dynamic" container="body">
  <button ngbDropdownToggle type="button" class="tratt-data-selector__toggle" [attr.aria-label]="('workbench.data_selector.label' | transloco) + ': ' + header().name">
    <i class="fa-solid fa-file-audio tratt-data-selector__icon" aria-hidden="true"></i>
    <span class="tratt-data-selector__name">{{ header().name }}</span>
    <span class="tratt-data-selector__meta"> @if (header().durationText !== undefined) { {{ header().durationText }} · {{ header().sampleRateKhz }} kHz {{ (header().channels === 1 ? 'workbench.editor_header.mono' : 'workbench.editor_header.stereo') | transloco }} · {{ header().sizeText }} } @else { {{ 'workbench.editor_header.audio_not_attached' | transloco }} } </span>
    @if (position(); as pos) {
    <span class="tratt-data-selector__position">{{ 'workbench.data_selector.position' | transloco: pos }}</span>
    }
    <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
  </button>
  <div ngbDropdownMenu class="tratt-data-selector__menu">
    @for (f of files(); track f.id) {
    <button ngbDropdownItem type="button" [class.active]="f.id === selectedId()" [attr.aria-current]="f.id === selectedId() ? 'true' : null" (click)="selectFile.emit(f.id)">{{ f.name }}</button>
    }
  </div>
</div>
```

```scss
.tratt-data-selector__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  max-inline-size: min(40rem, 50vw);
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--tratt-border-control);
  border-radius: var(--tratt-radius);
  background: var(--tratt-surface-page);
  color: var(--tratt-text-primary);
  font-family: var(--tratt-font-ui);

  &::after {
    display: none;
  }
  &:hover {
    background: var(--sb-blue-tint);
  }
}
.tratt-data-selector__icon {
  color: var(--tratt-next);
}
.tratt-data-selector__name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tratt-data-selector__meta,
.tratt-data-selector__position {
  font-family: var(--tratt-font-data);
  font-size: 0.8125rem;
  color: var(--tratt-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.tratt-data-selector__position {
  padding-left: 0.6rem;
  border-left: 1px solid var(--tratt-border);
}
@media (max-width: 991.98px) {
  .tratt-data-selector__meta {
    display: none;
  }
}
```

Spec (`data-selector.component.spec.ts`): visar namn och metadata. Utan `durationText` visas nyckeln `audio_not_attached`. Positionen blir `{ index: 2, total: 3 }` när den andra filen är vald. Ett klick på ett menyalternativ ger `selectFile` med rätt id.

- [ ] **Steg 5: Arbetsbänken lånar ut mitten.** I `workbench.component.html`, direkt under `<div class="workbench">`:

```html
<ng-template trattHeaderCenter>
  @if (hasAnyBundles() && selectedBundleHeader; as header) {
  <tratt-data-selector [header]="header" [files]="headerFiles()" [selectedId]="selectedBundleId()" (selectFile)="selectFileFromHeader($event)" />
  }
</ng-template>
```

I `workbench.component.ts` lägger du till `HeaderCenterDirective` och `DataSelectorComponent` i `imports` samt:

```ts
/** The data selector's list – same order as the bundle list. */
readonly headerFiles = computed(() => {
  const bundles = this.localMode()?.bundles;
  return (bundles?.ids ?? []).map((id) => ({
    id: String(id),
    name: bundles!.entities[id]?.sessionFile?.name ?? String(id),
  }));
});

selectFileFromHeader(bundleId: string): void {
  selectLocalBundle(this.store, this.pendingEdits, this.selectedBundleId(), bundleId);
}
```

Kontrollera att `localMode()?.bundles` verkligen är en NgRx-entity med `ids` och `entities`. `selectedBundleHeader` läser redan `bundles.entities[...]`. Kontrollera också att ordningen stämmer med den som `BundleListComponent` visar. Om fillistan sorteras på annat sätt, använd samma selektor som den.

- [ ] **Steg 6: Ta bort namn och metadata ur `#fileHeader`.** Byt namn på mallen till `#fileActions`. Den ska bara innehålla `<div class="workbench__editor-header-actions">…</div>` med de två befintliga knapparna. Exportknappen ändras från `btn btn-sm btn-primary` till `btn btn-sm btn-next`. Mallen placeras i uppgift 17. Tills dess används den där `fileHeader` användes. Ta bort `.workbench__editor-header`, `-name` och `-meta` ur `workbench.component.scss`.
- [ ] **Steg 7: Uppdatera `workbench.component.spec.ts`.**

| Rad (ca)   | Före                                                                                        | Efter                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1101       | `'.workbench__right:not(.workbench__empty) .workbench__editor-header-actions .btn-primary'` | `… .workbench__editor-header-actions .btn-next`                                                                                                         |
| 1116       | `'.workbench__editor-header .workbench__editor-header-actions .btn-primary'`                | `'.workbench__pane-bar .workbench__editor-header-actions .btn-next'` (efter uppgift 17. Fram till dess `'.workbench__editor-header-actions .btn-next'`) |
| 1153, 1196 | `'.workbench__editor-header-actions .btn-primary'`                                          | `'.workbench__editor-header-actions .btn-next'`                                                                                                         |
| 1241       | `By.css('.workbench__editor-header')` ska vara `null`                                       | `By.css('.workbench__editor-header-actions')` ska vara `null`                                                                                           |
| 1567–1576  | läser namn och "audio not attached" ur `.workbench__empty .workbench__editor-header`        | se nedan                                                                                                                                                |

Det nya testet för välkommen tillbaka-läget renderar den utlånade mallen:

```ts
const slots = TestBed.inject(HeaderSlotService);
const tpl = slots.center();
expect(tpl).toBeTruthy();
const view = tpl!.createEmbeddedView({});
view.detectChanges();
const text = view.rootNodes.map((n: Node) => n.textContent ?? '').join(' ');
expect(text).toContain('restored.wav');
expect(text).toContain('workbench.editor_header.audio_not_attached');
expect(fixture.debugElement.query(By.css('.workbench__empty .workbench__editor-header-actions .btn-next'))).toBeTruthy();
view.destroy();
```

Lägg till ett test som visar att mitten rensas när arbetsbänken förstörs: `fixture.destroy(); expect(slots.center()).toBeNull();`. `DataSelectorComponent` och `HeaderCenterDirective` behöver finnas i testmodulen. Om testerna använder `overrideComponent` för att skala bort importer, lägg till de två där.

- [ ] **Steg 8: Texter** (alla sju filerna. Nycklarna ligger under `workbench.*`, så varje språk måste översättas):

| Nyckel                             | en                     | sv                     | de                      | nl                      | it                     | ko                       | zh                               |
| ---------------------------------- | ---------------------- | ---------------------- | ----------------------- | ----------------------- | ---------------------- | ------------------------ | -------------------------------- |
| `workbench.data_selector.label`    | Choose file            | Välj fil               | Datei wählen            | Bestand kiezen          | Scegli file            | 파일 선택                | 选择文件                         |
| `workbench.data_selector.position` | {{index}} of {{total}} | {{index}} av {{total}} | {{index}} von {{total}} | {{index}} van {{total}} | {{index}} di {{total}} | {{total}}개 중 {{index}} | 第 {{index}} 个，共 {{total}} 个 |

- [ ] **Steg 9:** Kör `npx nx test tratt --testPathPattern="workbench|data-selector|select-local-bundle|header-slot|bundle-list"` och `npm run validate:i18n`. Kontrollera manuellt att dataväljaren i `/workbench` visar filen, byter fil via menyn och att det du just skrev sparas när du byter.
- [ ] **Steg 10: Commit** `feat(shell): data selector in the header centre; workbench lends it the active file`

### Uppgift 9: Sidfot och tackrad

**Filer:**

- Skapa: `apps/tratt/src/assets/img/sprakbanken/sprakbanken_logo.svg` (från communication-repot, efter OK enligt uppgift 0 steg 2) och `README.md` med källa och tillstånd
- Skapa: `apps/tratt/src/app/core/component/tratt-footer/tratt-footer.component.ts`, `.html`, `.scss` och `.spec.ts`
- Skapa: `apps/tratt/src/app/core/component/tratt-credits/tratt-credits.component.ts`, `.html` och `.scss`
- Ändra: `apps/tratt/src/app/core/pages/login/login.component.html` (de två `<div class="section order-3 …">` och `order-4` med `fieldset`)
- Ändra: `apps/tratt/src/app/core/pages/login/login.component.scss` (`footer`, `footer .logo`, `.section.order-4 footer`)
- Ändra: `apps/tratt/src/app/core/obj/Settings/app-settings.ts`, `apps/tratt/src/app/core/schemata/appconfig.schema.ts` och `apps/tratt/src/config/appconfig.json`
- Ändra: `apps/tratt/src/assets/i18n/*.json`

Sidfoten placeras i inloggningssidan och inte i app-skalet, eftersom det är `LoginComponent`s värdelement som rullar (`overflow-y: auto`). Den syns därför på `/local` och `/login` men inte på `/workbench` (beslut 4).

- [ ] **Steg 1: Konfiguration för nodens logotyp (beslut 3).**

```ts
// app-settings.ts, inside tratt: { … }
branding?: {
  /** Logo of the hosting node in the footer (Språkbanken profile). Omitted: no logo column. */
  node?: { name: string; logo: string; url: string };
};
```

I `appconfig.schema.ts`, bredvid `manual`:

```ts
branding: {
  properties: {
    node: {
      properties: {
        name: { type: 'string', description: 'Name of the hosting node, used as the logo’s alt text.' },
        logo: { type: 'string', description: 'URL or asset path of the node’s logo (SVG preferred).' },
        url: { type: 'string', description: 'Where the logo links to.' },
      },
      required: ['name', 'logo', 'url'],
      type: 'object',
    },
  },
  type: 'object',
},
```

`appconfig.json` får ingen `branding`. Den sätts per driftsättning.

- [ ] **Steg 2: Test för sidfoten.** De fyra länkarna enligt profilen finns (`/om`, `/aktuellt`, `/plattformar`, `/kontakt`, `/om/referera-till-oss` under `https://sprakbanken.se`). Alla externa länkar har `target="_blank"` och `rel="noopener"`. Nodkolumnen saknas när `branding.node` inte är satt och finns med rätt `alt` när den är satt.
- [ ] **Steg 3: `TrattFooterComponent`.**

```ts
@Component({
  selector: 'tratt-footer',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tratt-footer.component.html',
  styleUrl: './tratt-footer.component.scss',
})
export class TrattFooterComponent {
  private readonly settings = inject(SettingsService); // same service LoginComponent uses
  readonly base = 'https://sprakbanken.se';
  get node() {
    return this.settings.appSettings?.tratt?.branding?.node;
  }
}
```

```html
<footer class="tratt-footer">
  <div>
    <a [href]="base + '/'" target="_blank" rel="noopener" class="tratt-footer__logo">
      <img src="assets/img/sprakbanken/sprakbanken_logo.svg" alt="Språkbanken" height="26" />
    </a>
    <ul class="tratt-footer__links">
      <li><a [href]="base + '/om'" target="_blank" rel="noopener">{{ 'shell.footer.about_us' | transloco }}</a></li>
      <li><a [href]="base + '/aktuellt'" target="_blank" rel="noopener">{{ 'shell.footer.news' | transloco }}</a></li>
      <li><a [href]="base + '/plattformar'" target="_blank" rel="noopener">{{ 'shell.footer.other_platforms' | transloco }}</a></li>
    </ul>
  </div>
  <div class="tratt-footer__mid">
    <p class="tratt-prose">{{ 'shell.footer.feedback' | transloco }}</p>
    <p class="tratt-footer__inline">
      <a [href]="base + '/kontakt'" target="_blank" rel="noopener">{{ 'shell.footer.contact' | transloco }}</a>
      <a [href]="base + '/om/referera-till-oss'" target="_blank" rel="noopener">{{ 'shell.footer.cite' | transloco }}</a>
    </p>
  </div>
  @if (node; as n) {
  <div class="tratt-footer__node">
    <a [href]="n.url" target="_blank" rel="noopener"><img [src]="n.logo" [alt]="n.name" height="48" /></a>
  </div>
  }
</footer>
```

```scss
.tratt-footer {
  display: grid;
  grid-template-columns: 1fr 1.3fr 1fr;
  gap: 2.5rem;
  align-items: start;
  padding: 2rem 1.5rem 2.25rem;
  background: var(--tratt-surface-subtle);
  border-top: 1px solid var(--tratt-border);

  a {
    color: var(--tratt-interactive-text);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
}
.tratt-footer__logo img {
  display: block;
  block-size: 1.6rem;
  inline-size: auto;
  margin-bottom: 0.9rem;
}
.tratt-footer__links {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.35rem;
}
.tratt-footer__mid .tratt-prose {
  font-size: 0.9375rem;
  margin-bottom: 0.6rem;
}
.tratt-footer__inline {
  display: flex;
  gap: 1.25rem;
  margin: 0;
}
.tratt-footer__node {
  justify-self: end;
}
@media (max-width: 767.98px) {
  .tratt-footer {
    grid-template-columns: 1fr;
    gap: 1.5rem;
  }
  .tratt-footer__node {
    justify-self: start;
  }
}
```

- [ ] **Steg 4: `TrattCreditsComponent`** (tackraden, beslut 5). Den har två kolumner med rubrikerna `login.funding support and development` och `login.groups that developed the language models` (befintliga nycklar). Under rubrikerna finns länklistor i Noto Sans `0.8125rem`, separerade med `·`. Använd samma namn och länkar som de nuvarande `fieldset`-blocken i `login.component.html`. Visp saknar länk i dag och får ingen. Komponenten har en hårlinje överst, maxbredd `60rem` och är centrerad.
- [ ] **Steg 5: Byt ut** de två `fieldset`-sektionerna i `login.component.html` mot `<tratt-credits />` och `<tratt-footer />`. Ta bort de tillhörande `footer`-reglerna ur `login.component.scss`.
- [ ] **Steg 6: Texter** (`shell.footer.*` i alla sju filerna. de/nl/it/ko/zh får engelsk text):

| Nyckel            | sv (profilen)                                                                                           | en                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `about_us`        | Om oss                                                                                                  | About us                                                                                     |
| `news`            | Nyheter från Språkbanken                                                                                | News from Språkbanken                                                                        |
| `other_platforms` | Andra plattformar                                                                                       | Other platforms                                                                              |
| `feedback`        | Använder du våra plattformar, datamängder eller analyser i ditt arbete? Då vill vi gärna höra från dig! | Do you use our platforms, datasets or analyses in your work? We would love to hear from you! |
| `contact`         | Kontakta oss                                                                                            | Contact us                                                                                   |
| `cite`            | Referera till oss                                                                                       | Cite us                                                                                      |

- [ ] **Steg 7:** Kör `npx nx test tratt --testPathPattern="tratt-footer|login"` och `npm run validate:i18n`. Kontrollera manuellt `/local` med och utan `branding.node` i `apps/tratt/src/config/appconfig.json`. Ändra tillfälligt och återställ sedan.
- [ ] **Steg 8: Commit** `feat(shell): Språkbanken footer and credits row on /local`

---

## Fas 3 – `/local`

### Uppgift 10: Introduktion och arbetskort

**Filer:** Ändra `apps/tratt/src/app/core/pages/login/login.component.html`, `.scss` och `apps/tratt/src/assets/i18n/*.json`.

- [ ] **Steg 1: Ersätt `@if (localOnly) { <section class="order-1 order-md-1"> … </section> }`** (raderna 1–75, med `<hr>`, den inlinade SVG-bannern och `app description`) med:

```html
@if (localOnly) {
<section class="local-hero">
  <p class="local-hero__context">{{ 'login.hero.part_of' | transloco }}</p>
  <h1 class="local-hero__title">{{ 'login.local mode' | transloco }}</h1>
  <p class="local-hero__lead tratt-prose">{{ 'login.app description' | transloco }}</p>
  <p class="local-hero__privacy">
    <i class="fa-solid fa-user-lock" aria-hidden="true"></i>
    {{ 'login.hero.privacy' | transloco }}
  </p>
</section>
}
```

`login.local mode` ("Transkribera samtal lokalt i din webbläsare") används nu som h1 och är redan översatt till alla sju språken. Ta därför bort `<h4>{{ 'login.local mode' | transloco }}</h4>` ur kortet i `localOnly`-läget. Låt det stå kvar när `!localOnly`, med `@if (!localOnly)`.

- [ ] **Steg 2: Kortet** (`<div class="card login-card position-relative" #localmode>`): lägg till klassen `local-card` när `localOnly` (`[class.local-card]="localOnly"`). Flytta _Öppna demo_ från den absolut positionerade `<p>` in i flikraden som sista `<li class="nav-item ms-auto align-self-center">` med en `<button class="btn btn-link p-0">` (Bootstrap 5.3 stryker under `.btn-link`). På flik-`ul` ändras `class="nav-tabs"` till `class="nav-tabs tratt-tabs"`. Ta bort `style="color: #000"` på de två `ngbNavLink`-knapparna. Lägg `class="tratt-prose"` på `<div [innerHTML]="'login.local mode description' | transloco">`.
- [ ] **Steg 3: Stilar** i `login.component.scss`:

```scss
.local-hero {
  max-inline-size: 60rem;
  margin: 0 auto;
  padding: 3rem 1.5rem 1.5rem;
}
.local-hero__context {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--tratt-text-muted);
  margin-bottom: 0.75rem;
}
.local-hero__title {
  text-align: start;
  font-weight: 300;
  font-size: 2.75rem;
  line-height: 1.1;
  margin-bottom: 1rem;
}
.local-hero__lead {
  font-size: 1rem;
  max-inline-size: 46rem;
}
.local-hero__privacy {
  display: flex;
  gap: 0.55rem;
  align-items: center;
  font-size: 0.9375rem;
}
.local-hero__privacy i {
  color: var(--tratt-next);
}

.local-card {
  max-inline-size: 60rem;
  margin: 0 auto 3rem;
  padding: 1.25rem 2rem 2rem;
  border: 0;
  border-radius: 0.5rem;
  background: var(--tratt-surface-subtle);
}
```

Behåll `.login-card { padding: 50px }` för onlinekortet men gör den till `padding: 3rem`. Byt `.ng-touched .ng-invalid { border-bottom: 2px solid red }` mot `var(--tratt-danger)`, och `#login-disabled { border: 1px solid gray }` mot `var(--tratt-border-control)`. Den globala regeln `h1 { text-align: center }` i `styles.scss` står kvar. `.local-hero__title` åsidosätter den.

- [ ] **Steg 4: Texter:** `login.hero.part_of` (sv "Ett verktyg i Visp – Språkbankens talforskningsplattform", en "A tool in Visp – Språkbanken's speech research platform") och `login.hero.privacy` (sv "Inspelningen lämnar aldrig din dator. Även den automatiska transkriberingen körs lokalt.", en "Your recording never leaves your computer. Automatic transcription runs locally too."), i alla sju filerna.
- [ ] **Steg 5:** Kör `npx nx test tratt --testPathPattern=login`. Kontrollera `/local` mot skissen `local-ljust.png` i 1440 och 400 px.
- [ ] **Steg 6: Commit** `style(local): hero, privacy line and card per the profile; drop the banner`

### Uppgift 11: Släppytan

**Filer:** Ändra `apps/tratt/src/app/core/component/drop-zone/drop-zone.component.scss`, `.html` och `.ts` samt `apps/tratt/src/app/core/component/tratt-dropzone/tratt-dropzone.component.scss` och `.html`.

- [ ] **Steg 1: `drop-zone.component.scss`.**

```scss
.dropzone {
  border: 2px dashed var(--tratt-border-control);
  border-radius: 0.5rem;
  background-color: var(--tratt-surface-page);
  // …keep padding, min-height, overflow, flex as today

  &:hover,
  &.dropzone--over {
    border-color: var(--tratt-interactive);
    background-color: var(--sb-blue-tint);
  }
}

.dropzone .dragndrop {
  color: var(--tratt-next);
  font-size: 2.75rem;
}
```

- [ ] **Steg 2: Läge för drag-över.** Mallen har `(dragover)="onDragOver($event)"`. Lägg till `isOver = signal(false)` i `.ts`. Sätt `true` i `onDragOver` och `false` i `(dragleave)` och `(drop)`. Lägg sedan `[class.dropzone--over]="isOver()"` på `.dropzone`.
- [ ] **Steg 3: `tratt-dropzone`.** Gör följande ändringar:
  - `.icon-invalid { color: red }` → `var(--tratt-danger)`
  - `.fa-check { color: green }` → `var(--tratt-success-text)`
  - `.fa-trash { color: red }` → `var(--tratt-danger-text)`
  - `.dropzone-placeholder { color: black }` → `var(--tratt-text-primary)` med `font-weight: 500`
  - `.dropzone-error { color: var(--bs-danger, red) }` → `var(--tratt-danger-text)`
  - I `.html`: byt de inlinade `style="font-size: 16px; color: var(--tratt-accent-warning)"` och `style="… color: gray"` (spinnare) mot klasserna `.dz-icon-warning` (färg `var(--tratt-text-primary)`, eftersom gul ikon på vitt bara ger 1,66:1) och `.dz-spinner` (`var(--tratt-text-muted)`, `1rem`).
  - `style="font-size: 14px; color: dimgray"` på knapparna blir `.dz-row-btn` (`0.875rem`, `var(--tratt-text-muted)`).
  - Länken _Filformat som stöds_ (`style="… font-size: 0.85rem"`) behåller layouten men får `font-size: 0.875rem` i klassen `.dz-supported`.
- [ ] **Steg 4:** Kontrollera på `/local` och `/workbench` att uppladdning med drag och med klick fungerar. Testa också en ogiltig fil (röd ikon och felmeddelande) och en fil som avkodas (spinnare).
- [ ] **Steg 5: Commit** `style(dropzone): neutral dashed border, orange icon, blue drag-over state`

### Uppgift 12: Automatisk transkribering och översättning

**Filer:** Ändra `apps/tratt/src/app/core/component/tratt-dropzone/auto-transcribe-options.component.ts` (inline-mall och `styles`) och `auto-translate-options.component.ts`.

- [ ] **Steg 1: Kryssruta → växlare med chevron.** I `auto-transcribe-options` ersätter du `<div class="form-check mb-1">` runt `autoTranscribeCheck` med:

```html
<div class="ato-head">
  <i class="fa-solid ato-chevron" [class.fa-chevron-down]="enabled" [class.fa-chevron-right]="!enabled" aria-hidden="true"></i>
  <label class="ato-title" [attr.for]="idPrefix() + 'autoTranscribeCheck'"> {{ 'login.auto-transcription.auto-transcribe label' | transloco }} </label>
  <div class="form-check form-switch ms-auto mb-0">
    <input class="form-check-input" type="checkbox" role="switch" [id]="idPrefix() + 'autoTranscribeCheck'" [(ngModel)]="enabled" (ngModelChange)="emitChange()" [disabled]="isSafari()" [class.safari-disabled]="isSafari()" />
  </div>
</div>
```

Chevronen visar om detaljerna är utfällda (`chevron-right` när de är stängda, `chevron-down` när de är öppna, enligt profilen). Detaljerna visas redan bara när `enabled` är sant, så inget beteende ändras. Kontrollera det i mallen (`@if (enabled …)`).

- [ ] **Steg 2: Stilar** (i komponentens `styles`). Byt `background-color: var(--tratt-surface-background); font-size: 0.9rem` mot:

```css
.auto-transcribe-options {
  background: var(--tratt-surface-page);
  border-color: var(--tratt-border) !important;
  border-radius: 0.5rem !important;
}
.ato-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.ato-chevron {
  color: var(--tratt-interactive-text);
  font-size: 0.85em;
}
.ato-title {
  font-weight: 500;
  font-size: 1.0625rem;
  margin: 0;
}
```

Ta bort `mt-2 p-2 border rounded` från diven och använd `class="auto-transcribe-options mt-3 p-3 border"`. Fältens etiketter (`form-label`) får `fw-medium`.

- [ ] **Steg 3:** Gör samma sak i `auto-translate-options` (`#autoTranslateCheck`).
- [ ] **Steg 4:** Kör de befintliga testerna. De letar efter `#…autoTranscribeCheck` som `input[type=checkbox]` och ska fortfarande gå igenom eftersom id och typ är oförändrade: `npx nx test tratt --testPathPattern="auto-transcribe|auto-translate"`.
- [ ] **Steg 5: Commit** `style(local): auto-transcription as a fold-out with a switch`

### Uppgift 13: Förlopp, varningar och knappar på `/local`

**Filer:** Ändra `apps/tratt/src/app/core/pages/login/login.component.html` och `apps/tratt/src/app/core/component/recording-panel/recording-panel.component.scss` och `.html`.

- [ ] **Steg 1: Förloppspanelerna.** Byt `class="transcription-progress mt-3 p-3 border rounded bg-light"` → `class="transcription-progress tratt-panel mt-3"`, och gör likadant för `translation-progress`.
- [ ] **Steg 2: Förloppsstaplar:** ta bort `bg-success` och `bg-info` på de fyra `progress-bar` som har dem. Färgen kommer nu från `$progress-bar-bg` (orange), och texten i staplarna från `$progress-bar-color` (mörk, 5,07:1 på orange).
- [ ] **Steg 3: Nästa steg:** `#offline-submit`: `class="btn btn-raised btn-primary"` → `class="btn btn-next-lg"`. `.offline-delete-btn` behåller `btn-danger`, eftersom knappen skriver över sessionen.
- [ ] **Steg 4: Notisen om gammal version:** `<div class="alert mb-0 py-1" style="font-size: 0.8rem">` → `class="alert alert-info mb-0 py-1 small"`.
- [ ] **Steg 5: Inspelningspanelen:** `.level-light--green` → `var(--tratt-success)`, `--orange` → `var(--tratt-warning)` (nära överstyrning ändrar arbetsflödet) och `--red` → `var(--tratt-danger)`. På rad 190 i `.html` står `style="… background: #000"`. Behåll den: förhandsvisningen är avsiktligt svart i båda temana. Lägg raden i tillåtelselistan i uppgift 25. Kontrollera ritfärgerna i `recording-panel.component.ts` och byt dem mot `TRATT_COLORS` om de är hårdkodade.
- [ ] **Steg 6:** Kontrollera på `/local`: ladda ner en modell (förlopp), avbryt, avvisa ett fel och spela in i 10 s. Jämför med skissen.
- [ ] **Steg 7: Commit** `style(local): progress panels, next-step button, recording levels on tokens`

---

## Fas 4 – `/workbench`

### Uppgift 14: Fillistan

**Filer:** Ändra `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.scss` och `.html`.

Klassnamnen behålls, eftersom specen letar efter `.bundle-list__status`.

- [ ] **Steg 1: Rubrik och räknare.** `.bundle-list__title` byter `font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase` mot samma värden som `.tratt-label`: `font-weight: 500; font-size: 0.8125rem; letter-spacing: 0.02em; color: var(--tratt-text-muted)`. `.bundle-list__count`: `background: var(--tratt-surface-sunken)` och `font-family: var(--tratt-font-data)`.
- [ ] **Steg 2: Raderna.**

```scss
.bundle-list__item {
  border: 1px solid var(--tratt-border);
  border-left: 3px solid transparent;
  border-radius: var(--tratt-radius);
  background: var(--tratt-surface-page);
  // …layout as today

  &.active {
    border-left-color: var(--tratt-interactive);
    background-color: var(--sb-blue-tint);
    .bundle-list__item-btn {
      font-weight: 600;
    }
  }
  &:hover:not(.active) {
    background-color: var(--tratt-surface-subtle);
  }
}
.bundle-list__item-btn {
  font-family: var(--tratt-font-data);
  font-size: 0.875rem;
  // …rest as today (drop the `opacity: 0.7` hover rule)
}
```

- [ ] **Steg 3: Statusar.** Texten har alltid textfärgen, och färgen ligger i tonen (spec 3.2 regel 3):

```scss
.bundle-list__status {
  font-family: var(--tratt-font-data);
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 999px;
  background: var(--tratt-surface-sunken);
  color: var(--tratt-text-primary);
}
.bundle-list__status--running {
  background: var(--sb-blue-tint);
}
.bundle-list__status--done {
  background: var(--sb-green-tint);
}
.bundle-list__status--error {
  background: var(--sb-red-tint);
}
.bundle-list__status--queued,
.bundle-list__status--cancelled {
  background: var(--tratt-surface-sunken);
  color: var(--tratt-text-muted);
}

.bundle-list__progress {
  background: var(--tratt-next);
}
.bundle-list__error {
  color: var(--tratt-danger-text);
}
.bundle-list__error--neutral {
  color: var(--tratt-text-muted);
}
.bundle-list__cancel {
  color: var(--tratt-text-muted);
  &:hover {
    color: var(--tratt-danger-text);
  }
}
.bundle-list__reattach-label {
  color: var(--tratt-interactive-text);
}
```

Ta bort `#fbeed9`, `#8a5a1f`, `#e2ede8`, `#f9dde1`, `#e3e9f3`, `#2a4765`, `#c98a2e`, `#e9e9ec` och `#4a4a55`. I `.html` lägger du till en ikon i statusarna `done` (`fa-check`) och `error` (`fa-triangle-exclamation`). Använd `aria-hidden="true"` och färga ikonen med `--tratt-success-text` respektive `--tratt-danger-text`. Raden som väntar på media (`awaitingMedia`) får klassen `bundle-list__item--awaiting` med en gul vänsterkant (`border-left-color: var(--tratt-warning)`), eftersom det är ett resultat som ändrar arbetsflödet.

- [ ] **Steg 4: Massknappar.** Ge knapparna Bootstrap-klasser i `.html` i stället för den egna `.bundle-list__bulk-btn`-stilen:
  - `bundle-list__export-catalogue` → `btn btn-sm btn-outline-primary`
  - `bundle-list__clear-finished` → `btn btn-sm btn-text`
  - `bundle-list__remove` → `btn btn-sm btn-text-danger`

  Behåll klassnamnen `bundle-list__…` bredvid, eftersom de används i tester och i manualen. Ta bort reglerna för `.bundle-list__bulk-btn`.

- [ ] **Steg 5: Kryssrutor:** lägg till `form-check-input` på `.bundle-list__select-all` och `.bundle-list__item-checkbox`, så att de blir blå när de är markerade.
- [ ] **Steg 6:** Kör `npx nx test tratt --testPathPattern=bundle-list` och kontrollera alla statusar. Ett sätt att framkalla dem: kör kön med tre filer (_kör_, _klar_ och _i kö_), avbryt en (_avbruten_) och ladda om mitt i en körning (_avbruten_ eller _fel_).
- [ ] **Steg 7: Commit** `style(workbench): file list rows, statuses and bulk actions on tokens`

### Uppgift 15: Behandlingskortet och knappen Kör

**Filer:** Ändra `apps/tratt/src/app/core/pages/workbench/workbench.component.scss` och `.html`.

- [ ] **Steg 1:**
  - `.workbench__queue-title`: samma stil som `.tratt-label`, så ta bort `11px`, `uppercase` och `#667a90`.
  - `.workbench__pipeline`: `border: 1px solid var(--tratt-border)` och `border-radius: var(--tratt-radius)`.
  - `.workbench__pipeline-dot`: `background: var(--tratt-success)`. När det är avstängt: `var(--tratt-border-control)`.
  - `.workbench__pipeline-detail`: `color: var(--tratt-text-muted)`.
  - `.workbench__pipeline-chips li`: samma stil som `.tratt-chip`, utan kant.
- [ ] **Steg 2: Knappen Kör.** Byt `class="btn btn-outline-primary workbench__queue-run"` mot `[class]="queueRunning() ? 'btn btn-outline-secondary workbench__queue-run' : 'btn btn-next-lg workbench__queue-run'"`. Pausa är neutral, och Transkribera N filer är nästa steg.
- [ ] **Steg 3: Dialogen:** `border-bottom` och `border-top: 1px solid #d4d9e0` → `var(--tratt-border)`. `box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3)` behålls. `::backdrop` behålls.
- [ ] **Steg 4: Vänsterspalten:** `border-right: 1px solid #d4d9e0` → `var(--tratt-border)`. Gör likadant i mediefrågan. Ge flik-`ul` `class="nav-tabs tratt-tabs"`.
- [ ] **Steg 5:** Kontrollera att specen på rad ca 3269 (`.workbench__queue-run`) går igenom: `npx nx test tratt --testPathPattern=workbench`.
- [ ] **Steg 6: Commit** `style(workbench): pipeline card, run button as next step`

### Uppgift 16: Kapacitetsindikatorn

**Filer:** Ändra `apps/tratt/src/app/core/component/capacity-indicator/capacity-indicator.component.scss`.

- [ ] **Steg 1:** Ersätt alla tio hex-värden:

| Regel                                       | Nytt                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `.capacity-indicator` bakgrund och kant     | `var(--tratt-surface-page)`, `1px solid var(--tratt-border)`, `border-radius: var(--tratt-radius)`, `padding: 0.7rem 0.8rem`                  |
| `__row` `font-size: 11px; color: #667a90`   | `0.8125rem`, `var(--tratt-text-muted)`                                                                                                        |
| `__label` (`700`, `uppercase`)              | `font-weight: 500`, utan versaler                                                                                                             |
| `__value`                                   | `font-family: var(--tratt-font-data)`                                                                                                         |
| `__bar` (`8px`, `#e6e8ed`)                  | `0.4rem`, `var(--tratt-surface-sunken)`, `border-radius: 999px`                                                                               |
| `__storage-models` `#2a4765`                | `var(--tratt-next)`, grafik                                                                                                                   |
| `__storage-annotations` `#3d6b5c`           | `var(--tratt-text-muted)`, neutral                                                                                                            |
| `__memory-fill--ok` / `--warn` / `--danger` | `var(--tratt-success)` / `var(--tratt-warning)` / `var(--tratt-danger)`. Trösklarna (55 % och 80 %) ligger i komponentens TS och ändras inte. |
| `__note` `11px; #6b7c90`                    | `0.75rem`, `var(--tratt-text-muted)`, `font-family: var(--tratt-font-data)`                                                                   |

- [ ] **Steg 2:** Kör `npx nx test tratt --testPathPattern=capacity-indicator`. Testet letar efter klasser, inte färger.
- [ ] **Steg 3: Commit** `style(workbench): capacity indicator on tokens`

### Uppgift 17: Högerpanelens rad (flikar, genvägar och export)

**Filer:**

- Ändra: `apps/tratt/src/app/core/pages/workbench/workbench.component.html`, `.scss` och `.spec.ts`
- Ändra: `apps/tratt/src/app/core/component/taskbar/taskbar.component.ts`, `.html` och `.scss`

- [ ] **Steg 1: Snabbfältet med radvariant.** I `taskbar.component.ts` lägger du till `@Input() variant: 'stacked' | 'inline' = 'stacked';` (samma stil som `buttonLabels`). I `.html` lägger du till `[class.fastbar--inline]="variant === 'inline'"` på `#fastbar`. Byt hakparentes-texterna `[ALT + 8]` och `[ALT + 0]` mot `<kbd>Alt+8</kbd>` och `<kbd>Alt+0</kbd>` (i båda varianterna). Stilar:

```scss
#fastbar .btn-link {
  color: var(--tratt-interactive-text);
}
.fastbar--inline .btn-group {
  inline-size: auto !important;
  padding: 0 !important;
  gap: 1.25rem;
}
.fastbar--inline .btn-link {
  inline-size: auto !important;
  padding: 0;
  font-size: 0.9375rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
```

Det klassiska transkriptionsläget behåller `stacked`.

- [ ] **Steg 2: En rad.** I `workbench.component.html` (grenen `sessionReady`, `hasAnyBundles()`) ersätter du `fileHeader`-outleten, `<div class="workbench__editor-tabs">…</div>` och `<tratt-fastbar …>` med:

```html
<div class="workbench__pane-bar">
  <div class="workbench__editor-tabs nav nav-tabs tratt-tabs" role="toolbar">
    @for (entry of editorComponentsList; track entry.name) {
    <button type="button" class="nav-link workbench__editor-tab" [class.active]="activeEditorName() === entry.name" [class.workbench__editor-tab--active]="activeEditorName() === entry.name" [attr.aria-pressed]="activeEditorName() === entry.name" (click)="changeEditor(entry.name)">
      <i [class]="entry.icon" aria-hidden="true"></i>
      {{ entry.translate | transloco }}
    </button>
    }
  </div>
  <tratt-fastbar variant="inline" class="workbench__fastbar" (overviewbtnclicked)="openOverview()" (shortcutbtnclicked)="openShortcutsModal()" [buttonLabels]="{ shortcuts: 'g.shortcuts' | transloco, overview: 'g.overview' | transloco, help: 'g.help' | transloco }"></tratt-fastbar>
  @if (selectedBundleHeader; as header) {
  <ng-container *ngTemplateOutlet="fileActions; context: { $implicit: header, showExport: useMode === 'local' }"></ng-container>
  }
</div>
```

Behåll klassen `workbench__editor-tab--active`, eftersom testerna letar efter den. I välkommen tillbaka-läget (`workbench__empty-header`) används `fileActions` i stället för `fileHeader`.

- [ ] **Steg 3: Stilar.**

```scss
.workbench__pane-bar {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  min-block-size: 3.25rem;
  padding: 0 1rem 0 0.75rem;
  border-bottom: 1px solid var(--tratt-border);
}
.workbench__pane-bar .workbench__editor-tabs {
  align-self: stretch;
  border-bottom: 0;
  padding: 0;
}
.workbench__fastbar {
  margin-left: auto;
}
.workbench__editor-header-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}
.workbench__empty-header {
  position: absolute;
  top: 0.75rem;
  right: 1rem;
}
@media (max-width: 991.98px) {
  .workbench__pane-bar {
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    padding-block: 0.25rem;
  }
}
```

Ta bort `.workbench__editor-tab` (alla regler, eftersom `.tratt-tabs .nav-link` nu styr), `.workbench__editor-tab--active` och `.workbench__editor-tabs`, utom i det som står ovan. I `.workbench__placeholder` och `.workbench__empty-*` byter du `#667a90`, `#4a5a6c` och `#9aa8b8` mot `var(--tratt-text-muted)`, och `.workbench__empty-icon` får `var(--tratt-next)`.

- [ ] **Steg 4: Specen.** Byt till `'.workbench__pane-bar .workbench__editor-header-actions .btn-next'` på rad ca 1116, så som det förbereddes i uppgift 8 steg 7. Kör `npx nx test tratt --testPathPattern=workbench`.
- [ ] **Steg 5:** Kontrollera manuellt i `/workbench`:
  - Byt redigerare.
  - Öppna Kortkommandon (Alt+8) och Översikt (Alt+0).
  - Exportera och Exportera inspelning ska synas både med och utan session.
  - Kontrollera i 1024 px att raden bryts snyggt.
- [ ] **Steg 6: Commit** `style(workbench): one pane bar – editor tabs, shortcuts, export`

---

## Fas 5 – Redigerare och kanvas

### Uppgift 18: Kanvasfärger och typsnitt

**Filer:**

- Ändra: `libs/ngx-components/src/lib/obj/tratt-colors.ts`
- Ändra: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.config.ts`
- Ändra: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer-renderer.service.ts`
- Ändra: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts` (rad ca 1023)
- Ändra: `libs/ngx-components/src/lib/components/audio/audioplayer/audioplayer.component.ts`
- Ändra: `apps/tratt/src/app/core/pages/browser-test/browser-test.component.ts`
- Test: `libs/ngx-components/src/lib/obj/tratt-colors.spec.ts` (ny)

- [ ] **Steg 1: `TRATT_COLORS`** med samma värden som kanvas-tokens i `_tokens.scss`:

```ts
/**
 * Canvas colours for the signal displays (Språkbanken profile).
 *
 * <canvas> cannot read CSS custom properties directly, so these mirror the
 * literal canvas tokens in apps/tratt/src/styles/_tokens.scss. At runtime
 * `resolveTrattColors()` (task 23) prefers the CSS values, so the two only
 * have to agree for the library's standalone fallback.
 */
export const TRATT_COLORS = {
  surfaceBackground: '#FFFFFF',
  surfacePage: '#FFFFFF',
  border: '#D9D9D9',
  grid: '#D9D9D9',
  textPrimary: '#1A1A1A',
  textMuted: '#595959',
  /** Interactive elements (scroll selector, sliders). Brand blue. */
  interactive: '#1E989F',
  /** The audio signal itself. Neutral grey: data, not interaction. */
  waveformSignal: '#595959',
  segmentTranscribed: 'rgba(0, 0, 0, 0.05)',
  segmentSelected: 'rgba(30, 152, 159, 0.14)',
  /** Segment boundaries are draggable, hence interactive blue. */
  boundary: '#1E989F',
  /** Playhead: a graphic element, hence brand orange (red is for errors). */
  playhead: '#F0581A',
  accentSuccess: '#5AA018',
  accentWarning: '#F6C200',
  accentError: '#D42225',
  /** @deprecated Use `interactive`. */
  chrome: '#187A7F',
  /** @deprecated Use `interactive`. */
  chromeHover: '#187A7F',
  /** @deprecated Use `playhead` or `accentSuccess`. */
  cta: '#C04615',
  /** @deprecated Use `accentSuccess`. */
  accentGreen: '#5AA018',
  /** @deprecated */
  accentGreenDark: '#488013',
} as const;

export const TRATT_FONTS = {
  data: '"Noto Sans", Arial, sans-serif',
} as const;
```

- [ ] **Steg 2: `audio-viewer.config.ts`.**
  - `cursor.color` → `TRATT_COLORS.playhead`
  - `playcursor.color` → `TRATT_COLORS.playhead`
  - `scrollbar.selector.color` → `TRATT_COLORS.interactive`
  - `scrollbar.*.stroke: 'gray'` → `TRATT_COLORS.border`
  - `boundaries.color` → `TRATT_COLORS.boundary`
  - `grid.color` → `TRATT_COLORS.grid`
  - `selection.color: 'gray'` → `TRATT_COLORS.segmentSelected`
  - `timeline.font: 'Arial'` → `TRATT_FONTS.data`
  - `timeline.foreColor: 'black'` → `TRATT_COLORS.textPrimary`
- [ ] **Steg 3: Renderaren.**
  - `DEFAULT_RENDER_SETTINGS` (rad ca 127–152): byt alla hex-värden, `'gray'` och `'#000000'` mot motsvarande `TRATT_COLORS` (bakgrund `surfaceBackground`, markör `playhead`, data `waveformSignal`, ram `border`, gränser `boundary`, markering `segmentSelected`). Renderaren importerar redan inte `AudioviewerConfig` (se filens dokumentation), men den kan importera `TRATT_COLORS` och `TRATT_FONTS` från `../../../obj`.
  - Rad ca 343–349 (`'#b5b5b5'`, `'gray'`) → `TRATT_COLORS.textMuted` och `TRATT_COLORS.border`.
  - Rad ca 1031 (`stroke: 'black'`) → `TRATT_COLORS.textPrimary`.
  - Rad ca 1076–1143 (`'#555555'`, `shadowColor: 'gray'`, gränsernas grepp) → `TRATT_COLORS.boundary` för stroke. Skuggan behålls som `rgba(0, 0, 0, 0.25)`.
  - Rad ca 1507, 1770 och 1851 (`fontFamily: 'Arial'`) → `TRATT_FONTS.data`. Rad 1850 (`fill: 'black'`) → `TRATT_COLORS.textPrimary`.
  - Rad ca 2775 (`stroke: 'red'`, markören i redigeraren) → `TRATT_COLORS.playhead`.
- [ ] **Steg 4: Rita om när typsnitten har laddats.** I `AudioViewerComponent` (där `redraw()` finns, rad ca 470), efter att vyn har initierats:

```ts
// Konva measures text with whatever font is loaded at draw time; redraw once
// Noto Sans is available so labels don't stay in the fallback font.
if (typeof document !== 'undefined' && document.fonts) {
  document.fonts
    .load('400 10px "Noto Sans"')
    .then(() => this.redraw())
    .catch(() => undefined);
}
```

- [ ] **Steg 5:** `audio-viewer.service.ts` rad ca 1023: `this.settings.selection.color = 'gray'` → `TRATT_COLORS.segmentSelected`. `audioplayer.component.ts`: `slider fill: TRATT_COLORS.chrome` → `TRATT_COLORS.interactive`. `browser-test.component.ts`: `TRATT_COLORS.accentGreen` → `TRATT_COLORS.accentSuccess`.
- [ ] **Steg 6: Test** (`tratt-colors.spec.ts`): varje kanvasvärde i `TRATT_COLORS` är hex eller `rgba()`, aldrig `color-mix(`. Kör också `npx nx test ngx-components`, där renderarens smoke test ska gå igenom.
- [ ] **Steg 7:** Kontrollera alla fyra redigerarna (diktafon, linjär, 2D och popup) med `Bahnauskunft.mp3` (finns i `apps/tratt/src/media`). Vågformen ska vara grå, gränserna blå och uppspelningsmarkören orange. Tidsetiketterna ska vara i Noto Sans: `document.fonts.check('10px "Noto Sans"')` ska ge `true` i konsolen, och etiketterna ska ha samma typsnitt som filnamnen i fillistan.
- [ ] **Steg 8: Commit** `style(signal): canvas colours and fonts per the profile`

### Uppgift 19: Talarfärger

**Filer:** Ändra `libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.ts` och `speaker-colors.spec.ts`.

- [ ] **Steg 1: Ny palett** (beslut 8). Röd och gul ingår inte, eftersom de har betydelse i UI:t. Textfärgen räknas fram av den befintliga `getSpeakerTextColor`. Alla ytor nedan ger ≥ 4,5:1 med den texten.

```ts
/**
 * Categorical speaker colours from the Språkbanken palette. Red and yellow
 * are excluded – they carry UI meaning (errors, warnings). Brand colours
 * first, then their strong variants, neutrals and tints.
 */
export const SPEAKER_COLORS: readonly string[] = [
  '#1E989F', // blue          → black text 6.1:1
  '#5AA018', // green         → black text 6.5:1
  '#595959', // dark grey     → white text 7.0:1
  '#187A7F', // blue strong   → white text 5.1:1
  '#488013', // green strong  → white text 4.8:1
  '#D2EAEC', // blue tint     → black text
  '#DEECD1', // green tint    → black text
  '#FCDED1', // orange tint   → black text
  '#8C8C8C', // mid grey      → black text 6.2:1
  '#EBEBEB', // light grey    → black text
];
```

- [ ] **Steg 2: Specen.** Byt `toHaveLength(17)` → `toHaveLength(10)` och `SPEAKER_COLORS[17 % 17]` → `SPEAKER_COLORS[17 % 10]`. Testet `getSpeakerTextColor('#2A4765')` ändras till `'#187A7F'`, som ger `LIGHT_TEXT`. Lägg till ett test som visar att varje färg, med den text `getSpeakerTextColor` väljer, ger en kontrast på minst 4,5. Gör det med en liten kontrastfunktion i testfilen (WCAG-formeln, samma linjärisering som i `getSpeakerTextColor`).
- [ ] **Steg 3:** Kör `npx nx test ngx-components --testPathPattern=speaker-colors`.
- [ ] **Steg 4: Commit** `style(speakers): speaker palette from the Språkbanken colours`

### Uppgift 20: Ljudspelarens verktygsrad

**Filer:** Ändra `apps/tratt/src/app/core/component/audio-navigation/audio-navigation.component.css` och `.html`.

- [ ] **Steg 1:** I `.html` byter du `btn btn-info` (och `waves-light btn btn-info`) på de sex knapparna mot `btn btn-icon`. Ikonen `fa-arrow-rotate-left` med texten `- 2s` får `style`-fri text i en `<span class="an-step">2 s</span>`.
- [ ] **Steg 2:** I `.css`:

```css
.audio-nav {
  background: var(--tratt-surface-subtle);
  border-bottom: 1px solid var(--tratt-border);
}
.slider {
  accent-color: var(--tratt-interactive);
}
.audio-nav .btn-group .audio-nav-panel {
  min-height: 40px;
  color: var(--tratt-text-primary);
  background-color: transparent;
  border: 0;
}
.an-step {
  font-family: var(--tratt-font-data);
  font-size: 0.8125rem;
  margin-left: 0.3rem;
}
.slider-descr,
.shortcut-descr {
  font-family: var(--tratt-font-data);
  font-size: 0.75rem;
  color: var(--tratt-text-muted);
}
```

Byt `0.7em` och `0.6em` mot rem. Ta bort `.btn { border-radius: unset }`.

- [ ] **Steg 3:** Kontrollera alla knappar i spelaren (spela, paus, stopp, tillbaka, upprepa och −2 s), volym, hastighet och tooltip-texterna med kortkommandon.
- [ ] **Steg 4: Commit** `style(player): light toolbar, blue sliders`

---

## Fas 6 – Mörkt läge

### Uppgift 21: Tematjänst och växlare

**Filer:**

- Skapa: `apps/tratt/src/app/core/shared/service/theme.service.ts` och `.spec.ts`
- Ändra: `apps/tratt/src/app/core/component/navbar/navbar.component.html` och `.ts`
- Ändra: `apps/tratt/src/index.html` (tidigt skript)
- Ändra: `apps/tratt/src/assets/i18n/*.json`

- [ ] **Steg 1: Test först** (`theme.service.spec.ts`). jsdom saknar `matchMedia`, så stubba det i testet.

```ts
describe('ThemeService', () => {
  let listeners: ((e: { matches: boolean }) => void)[];
  const stubMatchMedia = (dark: boolean) => {
    listeners = [];
    window.matchMedia = jest.fn().mockReturnValue({
      matches: dark,
      addEventListener: (_: string, l: any) => listeners.push(l),
    }) as any;
  };
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-bs-theme');
  });

  it('follows the system preference by default', () => {
    stubMatchMedia(true);
    const s = TestBed.inject(ThemeService);
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    listeners.forEach((l) => l({ matches: false }));
    TestBed.tick();
    expect(s.effective()).toBe('light');
  });

  it('toggles and remembers the choice', () => {
    stubMatchMedia(false);
    const s = TestBed.inject(ThemeService);
    s.toggle();
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
    expect(localStorage.getItem('tratt.theme')).toBe('dark');
  });

  it('survives storage that throws', () => {
    stubMatchMedia(false);
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => TestBed.inject(ThemeService)).not.toThrow();
  });
});
```

- [ ] **Steg 2: Tjänsten.**

```ts
import { computed, effect, Injectable, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'tratt.theme';

/** Light/dark theme (Språkbanken profile). Sets data-bs-theme on <html>. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly preference = signal<ThemePreference>(read());
  private readonly systemDark = signal(false);
  readonly effective = computed<'light' | 'dark'>(() => (this.preference() === 'system' ? (this.systemDark() ? 'dark' : 'light') : (this.preference() as 'light' | 'dark')));

  constructor() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemDark.set(mq.matches);
      mq.addEventListener?.('change', (e) => this.systemDark.set(e.matches));
    }
    effect(() => document.documentElement.setAttribute('data-bs-theme', this.effective()));
  }

  toggle(): void {
    const next = this.effective() === 'dark' ? 'light' : 'dark';
    this.preference.set(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode / blocked storage: the choice lasts for this session */
    }
  }
}

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}
```

- [ ] **Steg 3: Knappen** i `#tratt-theme-slot` (från uppgift 7):

```html
<li class="nav-item">
  <button type="button" class="nav-link btn btn-link" (click)="theme.toggle()" [attr.aria-label]="'shell.header.theme_toggle' | transloco" [attr.aria-pressed]="theme.effective() === 'dark'" [attr.title]="'shell.header.theme_toggle' | transloco">
    <i class="fa-solid fa-circle-half-stroke" aria-hidden="true"></i>
  </button>
</li>
```

Injicera `public theme: ThemeService` i `NavigationComponent`. Texten `shell.header.theme_toggle` blir sv "Växla mellan ljust och mörkt läge" och en "Switch between light and dark mode".

- [ ] **Steg 4: Inget vitt blixtljus vid start.** Lägg till i `<head>` i `index.html`, före allt annat:

```html
<script>
  // Apply the stored theme before Angular boots (ThemeService takes over).
  try {
    var t = localStorage.getItem('tratt.theme');
    if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-bs-theme', t);
  } catch (e) {}
</script>
```

- [ ] **Steg 5:** Kör `npx nx test tratt --testPathPattern=theme`. Växlingen fungerar redan nu, men mörka tokens saknas tills uppgift 22.
- [ ] **Steg 6: Commit** `feat(theme): theme service and header toggle (circle-half-stroke)`

### Uppgift 22: Mörka tokens

**Filer:** Ändra `apps/tratt/src/styles/_tokens.scss` (Bootstrap-delen är redan konfigurerad i uppgift 2).

- [ ] **Steg 1:**

```scss
[data-bs-theme='dark'] {
  --tint-base: #{p.$dark-page};
  --tratt-surface-page: #{p.$dark-page};
  --tratt-surface-subtle: #{p.$dark-subtle};
  --tratt-surface-sunken: #{p.$dark-sunken};
  --tratt-border: #{p.$dark-border};
  --tratt-border-control: #{p.$dark-border-control};
  --tratt-text-primary: #{p.$dark-text};
  --tratt-text-muted: #{p.$dark-text-muted};
  --tratt-interactive-text: #{p.$dark-link}; //      6.3:1 on #1e1e1e
  --tratt-danger-text: #{p.$dark-danger-text}; //    4.8:1 on the dark red tint
  --tratt-success-text: #{color.mix(p.$sb-green, #fff, 80%)};

  // Canvas (literal values, see global constraints)
  --tratt-waveform-background: #121212;
  --tratt-waveform-signal: #a6a6a6;
  --tratt-segment-transcribed: rgba(255, 255, 255, 0.06);
  --tratt-segment-selected: rgba(30, 152, 159, 0.22);
  --tratt-canvas-grid: #333333;
  --tratt-canvas-text: #ededed;

  color-scheme: dark;
}
```

Lägg till `@use 'sass:color';` överst i filen.

- [ ] **Steg 2:** I mörkt läge ska `.btn-next`, `.btn-next-lg` och `.btn-primary` behålla vit text. Det stämmer redan, eftersom bakgrunderna är desamma. `.btn-outline-primary` använder `$primary` (stark blå) och har för låg kontrast mot `#121212` (≈ 3,7:1 för text). Lägg därför till `[data-bs-theme='dark'] .btn-outline-primary { --bs-btn-color: var(--tratt-interactive-text); --bs-btn-border-color: var(--tratt-interactive); }` i `_buttons.scss`.
- [ ] **Steg 3:** Gå igenom `/local` och `/workbench` i mörkt läge och jämför med `workbench-morkt.png`. Inga vita ytor får finnas kvar (sök i DevTools efter element vars beräknade bakgrund är `rgb(255, 255, 255)`).
- [ ] **Steg 4: Commit** `feat(theme): dark-mode tokens`

### Uppgift 23: Kanvasen följer temat

**Filer:**

- Ändra: `libs/ngx-components/src/lib/obj/tratt-colors.ts` (lägg till funktioner)
- Ändra: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.config.ts` (lägg till `applyThemeColors`)
- Ändra: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts`
- Ändra: `libs/ngx-components/src/lib/components/audio/audioplayer/audioplayer.component.ts`
- Test: `tratt-colors.spec.ts` och `audio-viewer.config.spec.ts` (ny)

- [ ] **Steg 1: Läs från CSS och följ temat.**

```ts
type CanvasKey = 'surfaceBackground' | 'waveformSignal' | 'segmentTranscribed' | 'segmentSelected' | 'boundary' | 'playhead' | 'border' | 'grid' | 'textPrimary' | 'textMuted' | 'interactive';

const CSS_VARS: Record<CanvasKey, string> = {
  surfaceBackground: '--tratt-waveform-background',
  waveformSignal: '--tratt-waveform-signal',
  segmentTranscribed: '--tratt-segment-transcribed',
  segmentSelected: '--tratt-segment-selected',
  boundary: '--tratt-boundary',
  playhead: '--tratt-playhead',
  border: '--tratt-border',
  grid: '--tratt-canvas-grid',
  textPrimary: '--tratt-canvas-text',
  textMuted: '--tratt-text-muted',
  interactive: '--tratt-interactive',
};

export type TrattCanvasColors = Record<CanvasKey, string>;

/** Current canvas colours: CSS custom properties win, TRATT_COLORS is the fallback. */
export function resolveTrattColors(el: Element = document.documentElement): TrattCanvasColors {
  const cs = getComputedStyle(el);
  const out = {} as TrattCanvasColors;
  for (const key of Object.keys(CSS_VARS) as CanvasKey[]) {
    out[key] = cs.getPropertyValue(CSS_VARS[key]).trim() || TRATT_COLORS[key];
  }
  return out;
}

/** Calls `cb` whenever <html data-bs-theme> changes. Returns an unsubscribe. */
export function observeTheme(cb: () => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => undefined;
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
  return () => mo.disconnect();
}
```

`getPropertyValue` returnerar värdet med `var()` utbytt. För `--tratt-boundary`, som är en literal, fungerar det direkt. Därför står kanvas-tokens som literaler (globala villkor).

- [ ] **Steg 2: Ren funktion som skriver in färgerna.**

```ts
/** Writes theme colours into a viewer config in place (the renderer shares the reference). */
export function applyThemeColors(s: AudioviewerConfig, c: TrattCanvasColors): void {
  s.backgroundcolor = c.surfaceBackground;
  s.cursor.color = c.playhead;
  s.playcursor.color = c.playhead;
  s.scrollbar.background.color = c.surfaceBackground;
  s.scrollbar.background.stroke = c.border;
  s.scrollbar.selector.color = c.interactive;
  s.scrollbar.selector.stroke = c.border;
  s.boundaries.color = c.boundary;
  s.grid.color = c.grid;
  s.data.color = c.waveformSignal;
  s.selection.color = c.segmentSelected;
  s.frame.color = c.border;
  s.timeline.foreColor = c.textPrimary;
}
```

Testa den med ett fejkat `TrattCanvasColors`-objekt där alla fält är `'x'`. Varje färgfält i konfigurationen ska då bli `'x'`.

- [ ] **Steg 3: Koppla in i `AudioViewerService`.** I `set settings(value)` anropas `applyThemeColors(value, resolveTrattColors())` innan `this.canvasRenderer.settings = value`. I `initialize(...)` sparas `this.stopThemeObserver = observeTheme(() => { applyThemeColors(this._settings, resolveTrattColors()); this.redraw(); })`. I `destroy()` anropas `this.stopThemeObserver?.()`. Ersätt också de hårdkodade färgerna från uppgift 18 i renderaren (`fill`, `stroke`) med `this.settings.*` där sådana fält finns. Där de saknas läser du `resolveTrattColors()` en gång per ritning.
- [ ] **Steg 4:** Gör på samma sätt i `AudioplayerComponent` (`playHead.backgroundColor`, `border.color`, `background.color`, slider-`fill`), med samma observer, och rita om.
- [ ] **Steg 5: Kontrollera manuellt** i 2D-redigeraren:
  1. Markera ett segment och starta uppspelningen.
  2. Byt tema mitt i uppspelningen.
  3. Kontrollera att markeringen, uppspelningen och texten i transkriptionsfältet finns kvar och att kanvasen har ritats om i det nya temat.

  Gör samma sak i den linjära redigeraren och i popup-redigeraren.

- [ ] **Steg 6: Commit** `feat(theme): signal displays follow the theme at runtime`

### Uppgift 24: Tredjepartskomponenter i mörkt läge

**Filer:** `styles.scss` och de redigerare som skapar Jodit (sök på `jodit` i `apps/tratt/src/app/editors` och `core/component/transcr-editor`).

- [ ] **Steg 1: Jodit.** Lägg till `theme: this.theme.effective() === 'dark' ? 'dark' : 'default'` i Jodit-konfigurationen. Lyssna på `ThemeService` med `effect()` och sätt `editor.options.theme` och `editor.container.classList` (`jodit_theme_dark`) när temat byts. Om det kräver att editorn skapas om, skapa om den på samma sätt som vid byte av typsnitt (`#editor-change-font-btn`).
- [ ] **Steg 2:** De globala Jodit-reglerna i `styles.scss` (`.jodit-toolbar__box … background: var(--tratt-surface-background) !important`) fungerar via aliaset. Kontrollera dem.
- [ ] **Steg 3:** video.js i popup-redigeraren har mörka kontroller från början. Kontrollera bara att de syns.
- [ ] **Steg 4:** Partnerlogotyperna i Om-dialogen (PNG med vit bakgrund) får `[data-bs-theme='dark'] .tratt-logo-on-light { background: #fff; padding: 0.25rem; border-radius: 0.25rem; }`. Språkbankens orange wordmark i sidfoten fungerar på mörk bakgrund som den är. Nodens logotyp kan behöva en ljus variant, så notera det i `README.md` i `assets/img/sprakbanken/`.
- [ ] **Steg 5: Commit** `style(theme): third-party widgets in dark mode`

---

## Fas 7 – Städning och verifiering

### Uppgift 25: Kontroll av stil-tokens i CI

**Filer:**

- Skapa: `scripts/check-style-tokens.mjs`
- Ändra: `package.json` (skript `lint:styles`)
- Ändra: `.github/workflows/ci.yml` (nytt steg efter `validate:manual`)

- [ ] **Steg 1: Skriptet.** Det använder bara Node 20:s inbyggda funktioner, eftersom CI kör Node 20.

```js
#!/usr/bin/env node
// Fails on hard-coded colours or px font sizes in component styles and inline
// styles. Colours belong in apps/tratt/src/styles/_palette.scss (Språkbanken profile).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['apps/tratt/src/app', 'libs/ngx-components/src'];
const exts = /\.(scss|css|html)$/;
// "file:line" entries that are deliberate, each with a reason.
const allow = new Set([
  // Recording preview is intentionally black in both themes.
  'apps/tratt/src/app/core/component/recording-panel/recording-panel.component.html:190',
]);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;
const NAMED = /\b(?:color|background(?:-color)?|border(?:-[a-z]+)*|fill|stroke|accent-color)\s*:[^;]*\b(red|green|blue|black|white|gray|grey|yellow|lightgr[ae]y|dimgr[ae]y)\b/i;
const PX_FONT = /font-size\s*:\s*\d+(?:\.\d+)?px/;

let failures = 0;
for (const root of roots) {
  for (const rel of readdirSync(root, { recursive: true })) {
    const file = join(root, String(rel));
    if (!exts.test(file)) continue;
    const isHtml = file.endsWith('.html');
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (allow.has(`${file}:${i + 1}`)) return;
        // In templates only inline styles count (incl. multi-line style="…" and
        // [ngStyle] objects); `#ref` template variables are not colours.
        if (isHtml && !/style|^\s*'?[a-z-]+'?\s*:/i.test(line)) return;
        // Token names such as var(--tratt-accent-green) are not named colours.
        const bare = line.replace(/var\([^)]*\)/g, 'var()');
        const hit = (HEX.test(line) && 'hex colour') || (NAMED.test(bare) && 'named colour') || (PX_FONT.test(line) && 'px font-size');
        if (hit) {
          console.error(`${file}:${i + 1}  ${hit}: ${line.trim()}`);
          failures++;
        }
      });
  }
}
if (failures) {
  console.error(`\n${failures} style violation(s). Use tokens from apps/tratt/src/styles/_tokens.scss.`);
  process.exit(1);
}
console.log('Style tokens OK');
```

- [ ] **Steg 2:** Lägg till `"lint:styles": "node scripts/check-style-tokens.mjs"`. Kör skriptet och åtgärda det som är kvar. Mot `main` i dag ger skriptet ungefär 200 träffar, de flesta i filerna som fas 3–5 redan konverterar. Det som fortfarande finns efter fas 3–5 ligger utanför omfattningen, till exempel `/intern`, `trn-editor` och `transcr-window`: konvertera det eller lägg det i tillåtelselistan med en kommentar som hänvisar till en uppföljning.
- [ ] **Steg 3:** I `ci.yml`, efter steget `validate:manual`:

```yaml
- name: Style tokens
  run: npm run lint:styles
- name: Translations
  run: npm run validate:i18n
```

- [ ] **Steg 4: Commit** `ci: check that component styles use tokens`

### Uppgift 26: Ta bort aliasen

- [ ] **Steg 1:** Kör `grep -rnE "\-\-tratt-(surface-card|surface-background|chrome|on-chrome|cta|on-cta|danger-surface|note-surface|link|accent-)" apps libs --include=*.scss --include=*.css --include=*.html --include=*.ts`. Byt varje träff mot den nya tokenen (tabellen i uppgift 2 steg 4).
- [ ] **Steg 2:** Ta bort `_legacy-tokens.scss` och raden `@use 'styles/legacy-tokens';`. Ta bort de `@deprecated` fälten i `TRATT_COLORS` och ersätt användningarna.
- [ ] **Steg 3:** Kör `npm run build`, `npm test`, `npm run lint` och `npm run lint:styles`.
- [ ] **Steg 4: Commit** `refactor(tokens): drop pre-profile aliases`

### Uppgift 27: Automatisk kontrastkontroll

**Filer:**

- Ändra: `package.json` (devDependencies `playwright` och `@axe-core/playwright`, skript `a11y:contrast`)
- Skapa: `scripts/a11y-contrast.mjs`

- [ ] **Steg 1:** Installera paketen:

```bash
npm i -D playwright @axe-core/playwright --legacy-peer-deps
npx playwright install chromium
```

- [ ] **Steg 2: Skriptet.** Det körs mot en server som redan är igång (`BASE_URL`, standard `http://localhost:5321`).

```js
#!/usr/bin/env node
// WCAG colour-contrast check for /local and /workbench in both themes.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const base = process.env.BASE_URL ?? 'http://localhost:5321';
const audio = 'apps/tratt/src/media/Bahnauskunft.mp3';
const browser = await chromium.launch();
let violations = 0;

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => localStorage.setItem('tratt.theme', t), theme);
  const page = await ctx.newPage();

  for (const [name, path, prepare] of [
    ['/local', '/local', async () => {}],
    [
      '/workbench (file loaded)',
      '/workbench',
      async () => {
        await page.setInputFiles('tratt-drop-zone input[type=file]', audio);
        await page.waitForSelector('.bundle-list__item', { timeout: 30_000 });
      },
    ],
  ]) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await prepare();
    const res = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    for (const v of res.violations) {
      for (const n of v.nodes) {
        console.error(`[${theme}] ${name}: ${n.target.join(' ')} – ${n.failureSummary?.split('\n')[1]?.trim()}`);
        violations++;
      }
    }
  }
  await ctx.close();
}
await browser.close();
if (violations) {
  console.error(`\n${violations} contrast violation(s)`);
  process.exit(1);
}
console.log('Contrast OK in both themes');
```

Kontrollera selektorn för filinmatningen (`tratt-drop-zone input[type=file]`) mot `drop-zone.component.html` (`class="fileinput"`). Om arbetsbänken kräver att en session startas innan filen visas, lägg till det klicket i `prepare`.

- [ ] **Steg 3:** Kör `npm start` i ett fönster och `npm run a11y:contrast` i ett annat. Rätta de överträdelser som skriptet hittar. De vanligaste orsakerna är inlinade färger som har missats och ren blå eller orange som används som text.
- [ ] **Steg 4: Commit** `test(a11y): automated contrast check for /local and /workbench in both themes`

### Uppgift 28: Dokumentation och skärmbilder

- [ ] **Steg 1:** Ta nya skärmbilder med samma filnamn till `docs/assets/`. Manualen refererar till 9 av dem på sv och en (18 referenser): `visp_tratt_main`, `_workbench`, `_2d_editor`, `_linear_editor`, `_dictaphone_editor`, `_auto_transcription_options`, `_export_formats`, `_overview_edit` och `_popup_editor_audio_only`. README använder dessutom `_draft_automatic_transcription`, `_overview` och `_popup_editor_audio_and_video`.
- [ ] **Steg 2:** I `docs/manual/*.md` och `docs/manual/sv/*.md`: byt beskrivningar av färger och platser som har ändrats. Exempel: knappen som tidigare var blå eller grön är nu orange, _Språk:_ har blivit en glob, GitHub ligger under _Om Tratt_ och filnamnet visas i sidhuvudet. Sök på `navbar`, `blue`, `blå`, `green`, `grön`, `Language`, `GitHub` och `TRATT`. Namnformen i manualen (beslut 2) kan tas i en egen commit.
- [ ] **Steg 3:** Kör `npm run validate:manual` och `npm run build:manual`.
- [ ] **Steg 4: Commit** `docs: screenshots and manual for the Språkbanken profile`

### Uppgift 29: Slutkontroll

- [ ] `npm run build`: inga nya budgetvarningar. Komponentstilar ska vara under 6 kB.
- [ ] `npm test`, `npx nx test ngx-components`, `npm run lint`, `npm run lint:styles`, `npm run validate:i18n` och `npm run validate:manual`
- [ ] `npm run a11y:contrast`: 0 överträdelser i båda temana
- [ ] Offlinekontroll enligt uppgift 1 steg 5 med produktionsbygget
- [ ] Manuell genomgång mot skisserna i 1440, 1024, 768 och 400 px, i ljust och mörkt läge:
  - `/local`: ladda upp, spela in, automatisk transkribering och demo
  - `/workbench`: flera filer, kö, paus, avbryt, välkommen tillbaka efter omladdning, export och export av alla
- [ ] Visp-inbäddningen och `/login` (onlineläget) fungerar och har bara fått nya färger och typsnitt
- [ ] Specen uppdateras: besluten i avsnitt 9 och eventuella avsteg som upptäckts under arbetet förs in som "Shipped shape" i designdokumentet, som i de tidigare planerna
