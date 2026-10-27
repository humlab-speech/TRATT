# Språkbankens grafiska profil – alla ingångar och manualen (tillägg till huvudplanen)

> **För agenter:** Använd superpowers:subagent-driven-development (rekommenderas) eller superpowers:executing-plans och genomför planen uppgift för uppgift. Stegen använder kryssrutor (`- [ ]`) för att följa upp arbetet. Planen förutsätter att huvudplanen genomförs, så läs den först.

**Mål:** Alla ingångar till Tratt och manualens webbplats får utseendet som designdokumentet beskriver, inte bara `/local` och `/workbench`. WCAG 2.1 AA gäller i båda temana överallt där en person kan hamna.

**Huvudplan:** [`2026-10-12-sprakbanken-grafisk-profil.md`](2026-10-12-sprakbanken-grafisk-profil.md) (uppgift 0–29). Den här planen fortsätter numreringen med uppgift 30–44 och ändrar några av huvudplanens uppgifter (avsnittet _Ändringar i huvudplanen_).

**Spec:** [`docs/superpowers/specs/2026-10-12-sprakbanken-grafisk-profil-design.md`](../specs/2026-10-12-sprakbanken-grafisk-profil-design.md). Specen utesluter `/login`, `/intern/*`, Visp-inbäddningen och manualens webbplats (rad 9). Uppgift 30 stryker den raden.

**Arkitektur:** Huvudplanen lägger tokens, Bootstrap-konfiguration och skal på ett ställe. Här gäller tre principer. (1) Bootstrap är redan omkonfigurerat, så de flesta knappar, rutor och varningar byter färg utan ändring. Det som återstår är hårdkodade färger, klasser som inte följer temat och knappar vars _roll_ ändras. (2) Fyra gemensamma byggstenar (`.tratt-state-*`, `.tratt-page`, rubrikregeln och knapptabellen) ersätter ungefär 700 enskilda val. (3) Manualen får **samma palett- och tokenfiler** som appen, kompilerade med Sass vid bygget, så att de två inte kan glida isär.

**Teknik:** Som huvudplanen, plus Sass (`sass.compile` i `scripts/build-manual.mjs`), markdown-it, Playwright och axe-core för kontroller.

---

## Utgångsläge (uppmätt 2026-10-27, `main` @ `ac79c6133`)

Siffrorna kommer från skript som räknar hex- och `rgb()`-värden, namngivna färger, `font-size` i px och Bootstrap-färgklasser per mapp. Huvudplanens filer ingår i totalen men markeras.

| Ingång                                      | Var                                                                                                                                                      | Hårdkodade färger | Bootstrap-färgklasser | Täcks av            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------- | ------------------- |
| `/local`, `/login` (online)                 | `pages/login`                                                                                                                                            | 19 + 2 namngivna  | 25                    | 10–13 och 33        |
| `/workbench`                                | `pages/workbench`, `bundle-list`, `capacity-indicator`, `taskbar`, `audio-navigation`                                                                    | 23 + 25 + 10      | 14                    | 14–17, 20           |
| `/intern/projects`, `/intern/transcr/*`     | `pages/intern/*` (projects-list, transcription, transcription-end, reload-file, auth, auth-success)                                                      | 2 + 11 namngivna  | 28                    | **34, 35 (nya)**    |
| Redigerare i klassiskt läge                 | `editors/trn-editor`, `2D-editor` (+ `transcr-window`), `transcr-overview`, `transcr-editor`                                                             | 10 + 8 namngivna  | 14 + 23               | **35 (ny)**         |
| Dialoger (26 st)                            | `core/modals/*`                                                                                                                                          | 7 + 16 namngivna  | 85                    | **32 (ny)**         |
| Info- och verktygssidor                     | `/news`, `/features`, `/help-tools`, `/test`, `/stresstest`, `/404`, `/load`, `tools/*` (table-configurator, naming-drag-and-drop)                       | 7 + 20 namngivna  | 21                    | **36 (ny)**         |
| Aviseringar och småkomponenter              | `component/alert`, `alerts/error-occurred`, `maintenance`, `context-menu`, `transcription-feedback`, `shortcut`                                          | 3 + 5 namngivna   | 6                     | **31 (ny)**         |
| Visp-inbäddning                             | `/visp-task/project/:p/session/:s/bundle/:b`                                                                                                             | –                 | –                     | **37 (ny)**         |
| `@tratt/ngx-components`, `web-components`   | `libs/ngx-components` (utom signalvisningen), `apps/web-components`, `apps/web-components-demo`, `apps/json-sets-demo`                                    | ca 6 + 5 namngivna | 9                     | **38 (ny)**         |
| `apps/translations`                         | PHP-verktyg med inbyggd Bootstrap Material (2 547 träffar, nästan allt i leverantörsfiler)                                                               | –                 | –                     | utanför (beslut 12) |
| Manualens webbplats                         | `scripts/build-manual.mjs`, `scripts/manual-assets/manual.css` (28 färger, marinblå `#2a4765`, systemtypsnitt), `manual.js`                              | 28                | –                     | **39–40 (nya)**     |
| Manualens text och bilder                   | `docs/manual/*.md` (16 sidor), `docs/manual/sv/*.md` (16), `docs/manual/CONTRIBUTING.md`, `docs/assets/` (12 bilder), `README.md`                        | –                 | –                     | **41–42 (nya)**     |

**Klasser som inte följer `data-bs-theme`** och därför blir fel i mörkt läge: `bg-light` 2, `bg-white` 1, `text-dark` 2, `text-white` 2 (på ytor som blir ljusa), `btn-dark` 1, `navbar-dark` 1, `bg-primary` 2. Alla ligger i `apps/tratt/src/app`.

**Fyllda färgytor med text:** `bg-success`/`bg-info`/`bg-danger`/`bg-warning` används 34 gånger, mest i `transcr-overview` (segmentstatus) och i `alert.component.html` (aviseringar). Profilen förbjuder text på fylld färg (spec 3.2 regel 3–4), och vit text på `#5AA018` ger bara 3,4:1.

**Upptäckt som påverkar huvudplanen.** Ingenting i `navbar.component.*`, `app.component.*` eller `visp-task.component.ts` döljer sidhuvudet i Visp-inbäddningen (sökning efter `visp`, `embedded` och `LoginMode.URL` ger bara `app.component.ts:113`). Huvudplanens uppgift 7 steg 2 gör logotypen till en `routerLink` till `/local`. I inbäddningen skulle ett klick på logotypen ta bort uppgiften ur Visps ram. Uppgift 37 åtgärdar det.

## Globala villkor

Huvudplanens villkor gäller. Dessutom:

- **Bibliotek utan appens CSS.** `libs/ngx-components` publiceras och `apps/web-components` används på sidor utan Tratts tokens. Bibliotekskod läser CSS-variabler med literal reserv: `var(--tratt-danger-text, #aa1b1e)`. Kanvasfärger går via `resolveTrattColors()`.
- **Roll före färg.** Byt aldrig en klass mot en annan färg på känn. Avgör rollen (nästa steg, interaktion, hjälp, fel/förstörande, avvikelse, klart) enligt spec 3.1 och välj sedan klass enligt tabellen i uppgift 30.
- **Fyllda färgytor med text förbjuds.** Statusytor är ton plus kantlinje (`.tratt-state-*`), med textfärgen oförändrad.
- **Manualen är en statisk webbplats utan körning av Angular.** Den får inga externa anrop, inte heller typsnitt, och alla länkar till typsnitt är relativa så att de fungerar under både `/manual/` och `/manual/sv/` på GitHub Pages.
- **Verifiera varje uppgift** som i huvudplanen. För uppgift 39–43 används i stället `npm run build:manual`, `npm run validate:manual` och en visuell kontroll av `dist/manual/index.html` via `npx http-server dist/manual -p 8081 -c-1`.

## Granskningsfokus

Följande är sådant specen antyder men ingen uppgifts test täcker i huvudplanen. Varje punkt har ett test eller en kontroll i den uppgift som anges.

1. **Dialoger och aviseringar i mörkt läge.** De monteras utanför appens rot (`container="body"`, `tratt-alert`). De ska följa `data-bs-theme` på `<html>` och aldrig visa fyllda färgytor med text. Kontrolleras i uppgift 31, 32 och 44.
2. **Logotypen i Visp-inbäddningen.** Den får inte navigera bort från uppgiften. Test i uppgift 37.
3. **Bibliotek utan tokens.** `resolveTrattColors()` ska ge `TRATT_COLORS` när inga CSS-variabler finns (`web-components` på en främmande sida). Test i uppgift 38.
4. **Manualens typsnitt under underkatalog.** `dist/manual/sv/*.html` ska hämta typsnitt via `../assets/fonts/`, och bygget ska misslyckas om en `url()` i CSS inte leder till en fil. Kontroll i uppgift 39.
5. **Påståenden i manualen som slutar stämma.** Färger (_orange_, _blå_, _grön_), platser (_top bar_, _navigation bar_, _GitHub_) och varningen att Arbetsbänken bara nås via adressen. Sökning med förväntat tomt resultat i uppgift 41.

## Beslut (tillägg till huvudplanens tabell, uppgift 0)

Planen fungerar med standardvärdena. Ett senare beslut ändrar bara uppgiften som anges.

| #   | Beslut                                                                                                                              | Standardvärde i planen                                                                             | Påverkar |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| 12  | `apps/translations` (PHP-verktyg med eget Bootstrap Material)                                                                       | Utanför omfattningen. Rörs inte.                                                                   | 38       |
| 13  | Färger i **exporterade** dokument (DOCX/ODT: grön och orange verifieringsstreck)                                                    | Oförändrade. Det är data, inte gränssnitt. Manualen beskriver dem som i dag.                       | 41       |
| 14  | Manualens brödtext i `1rem` Noto Serif i stället för appens `0.875rem`                                                              | Ja. Långa sidor läses, och `0.875rem` gör 16 sidor tunga att läsa (spec 4, beslut 6 gäller appen). | 40       |
| 15  | Manualens sidfot är Språkbankens standardsidfot                                                                                     | Ja. Kräver att logotypfilen är godkänd (huvudplanens uppgift 0 steg 2).                            | 40       |
| 16  | Typedoc-sidorna (API-dokumentation) på GitHub Pages roten                                                                           | Utanför omfattningen.                                                                              | –        |
| 17  | Skärmbilder i mörkt läge i manualen                                                                                                 | Nej. Ljusa bilder med hårlinje i båda temana.                                                      | 42       |
| 18  | GitHub-länken i manualens sidhuvud                                                                                                  | Flyttas till sidfoten, som i appen (spec 5.1).                                                     | 40       |
| 19  | Knappar för kvalitetsbedömning (_bra_, _medel_, _dålig_ ljudkvalitet) i `overview-modal` och `transcription.component`              | Oförändrade (`btn-primary`, `btn-warning`, `btn-danger`). Skalan har inneboende betydelse.         | 32, 35   |

## Ändringar i huvudplanen

Gör ändringarna i huvudplanens uppgifter när du kommer dit. De påverkar inga andra steg.

| Uppgift | Ändring                                                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1       | Lägg till `@use '@fontsource/noto-serif/700.css';`. Brödtext och manual har fetstil (`<strong>`), och utan egen fet vikt fakar webbläsaren den.                                                                                                                                                                                 |
| 2       | `_typography.scss`: lägg till `h1 { font-weight: 300; text-align: start; }`. Resten av `_components.scss` är oförändrat. Tonklasserna och `.tratt-page` läggs till i uppgift 30.                                                                                                                                                |
| 3       | Ta bort globala `h1 { text-align: center }`. Rubriken på varje sida styrs nu av `_typography.scss`.                                                                                                                                                                                                                             |
| 10      | `.local-hero__title` behöver inte längre sätta `text-align`, `font-weight` eller `font-size`. Ta bort de tre raderna.                                                                                                                                                                                                           |
| 13      | Nivåmätarens mellanläge blir **gult** (`--tratt-warning`), inte orange. Manualen anger "orange" i dag. Det rättas i uppgift 41.                                                                                                                                                                                                 |
| 25      | Skapa skriptet (steg 1–2) **före** uppgift 31, med flaggan `--report` som skriver antal träffar per mapp och avslutar med 0. CI-steget (steg 3) och undantagslistan tas i Fas 7. Se uppgift 44 för skärpningen: fler rötter, `.ts`-filer och förbud mot tre klasser.                                                       |
| 26      | Körs **efter** uppgift 30–38. Sökningen täcker redan `apps` och `libs`.                                                                                                                                                                                                                                                         |
| 27      | Se uppgift 44. Ruttlistan utökas.                                                                                                                                                                                                                                                                                              |
| 28      | Ersätts av uppgift 41–43. Behåll bara README-delen (steg 1, tre bilder).                                                                                                                                                                                                                                                         |
| 29      | Lägg till raderna i uppgift 44 steg 4.                                                                                                                                                                                                                                                                                         |

## Ordning och beroenden

```
Fas 8   30 → 31, 32, 33, 34, 35, 36, 37, 38     parallellt efter Fas 2 (uppgift 30 först)
Fas 9   39 → 40 → 41 → 42 → 43                   kräver uppgift 2 (palett, tokens), 6 (symbol) och 9 (sidfotens logotyp).
                                                  Kan göras parallellt med Fas 3–8. 42 kräver att Fas 3–5 och 8 är klara.
Fas 10  44                                       efter alla andra
```

---

## Fas 8 – Appens övriga ingångar

### Uppgift 30: Gemensamma byggstenar och omfattning

**Filer:**

- Ändra: `docs/superpowers/specs/2026-10-12-sprakbanken-grafisk-profil-design.md` (rad 4 och 9)
- Ändra: `apps/tratt/src/styles/_components.scss`
- Ändra: `apps/tratt/src/styles/_typography.scss` och `apps/tratt/src/styles.scss` (se _Ändringar i huvudplanen_ för uppgift 2 och 3)

- [ ] **Steg 1: Specen.** Ändra raden **Omfattning** till "Hela applikationen (alla rutter, dialoger och inbäddningen i Visp) och manualens webbplats". Stryk meningen "Utanför omfattningen: …" på rad 9 och ersätt den med "Utanför omfattningen: `apps/translations` och Typedoc-sidorna, se beslut 12 och 16 i `plans/2026-10-27-…`". Lägg en länk till den här planen under **Implementeringsplan**.
- [ ] **Steg 2: Tonklasser och sidskal** i slutet av `_components.scss`:

```scss
// Tinted state surfaces (spec 3.2 rule 3–4): tint + 4 px edge, text keeps the
// text colour. Replaces bg-success / bg-info / bg-warning / bg-danger.
@each $name, $colour in (next: orange, info: blue, success: green, warning: yellow, danger: red) {
  .tratt-state-#{$name} {
    background: var(--sb-#{$colour}-tint);
    box-shadow: inset 0.25rem 0 0 var(--sb-#{$colour});
    color: var(--tratt-text-primary);
  }
}
.tratt-state-neutral {
  background: var(--tratt-surface-sunken);
  color: var(--tratt-text-primary);
}

// Reading column for plain pages (/news, /features, /help-tools, /404, /login).
.tratt-page {
  max-inline-size: 60rem;
  margin: 0 auto;
  padding: 3rem 1.5rem 2rem;
}
```

- [ ] **Steg 3: Knappregler** som gäller i alla uppgifter nedan (inget att ändra här, tabellen är beslutet):

| Roll i dialogen eller på sidan                                                      | Klass                                     |
| ------------------------------------------------------------------------------------ | ----------------------------------------- |
| Handlingen som tar nästa steg (skicka, exportera, starta, skapa, översätt, ladda ner) | `btn-next` (`btn-next-lg` bara på startsidan och i Arbetsbänkens kö) |
| Avbryt, Stäng, Tillbaka                                                              | `btn-secondary`, eller `btn-primary` om det är dialogens enda knapp   |
| Förstör eller skriver över data (_Radera_, _Lämna utan att spara_, _Använd ändå_)    | `btn-danger`                              |
| Hjälp och manual                                                                     | `btn-info` eller `btn-outline-primary`    |
| Övrigt (val, växling)                                                                | `btn-primary` eller `btn-outline-primary` |

- [ ] **Steg 4:** Kör `npm run build` och öppna `/local`. Inga synliga ändringar väntas, eftersom ingen markup använder klasserna ännu. Kontrollera att `.tratt-state-success` finns i `dist/apps/tratt/styles*.css`.
- [ ] **Steg 5: Commit** `style(shell): state tint classes, reading-column class and h1 rule; widen spec scope`

### Uppgift 31: Aviseringar och småkomponenter

**Filer:**

- Ändra: `apps/tratt/src/app/core/component/alert/alert.component.html`, `.scss` och `.spec.ts`
- Ändra: `apps/tratt/src/app/core/alerts/error-occurred/error-occurred.component.html`
- Ändra: `apps/tratt/src/app/core/component/{maintenance,context-menu,transcription-feedback}` (`.scss`, `.html`)
- Ändra: `apps/tratt/src/app/core/shortcut/shortcut.component.scss`
- Ändra: `apps/tratt/src/app/app.component.scss`

- [ ] **Steg 1: Aviseringar.** I `alert.component.html` ersätter du `ngClass` med:

```html
[ngClass]="{ 'tratt-state-danger': toast.type === 'danger', 'tratt-state-success': toast.type === 'success', 'tratt-state-warning': toast.type === 'warning' }"
```

Fyllda `bg-success text-light` ger 3,4:1. I `alert.component.scss` lägger du `.toast { color: var(--tratt-text-primary); }` och byter ut stängknappens färg om den är vit. Ikon framför texten är inte nödvändig, men färgen får inte vara det enda som skiljer typerna åt: lägg `aria-live="polite"` på `tratt-alert` om det saknas (`danger` får `role="alert"`).

- [ ] **Steg 2: Test** i `alert.component.spec.ts` (skapa filen om den saknas): köa en avisering av typen `success` och förvänta `ngb-toast.tratt-state-success` samt att `bg-success` saknas. Gör samma för `danger` och `warning`.
- [ ] **Steg 3:** `app.component.scss`: byt `box-shadow: 0 1px 6px #a0a0a0` (och de två prefixade raderna) mot `0 1px 6px rgba(0, 0, 0, 0.25)`. Ta bort de prefixade raderna.
- [ ] **Steg 4:** Gå igenom `error-occurred`, `maintenance`, `context-menu`, `transcription-feedback` och `shortcut` med `node scripts/check-style-tokens.mjs --report` (huvudplanens uppgift 25, skapad före den här uppgiften). Byt värden efter tabellen i uppgift 35 steg 1. `context-menu` och `shortcut` ligger över innehåll i `body`, så de ska ha `background: var(--tratt-surface-page)` och `border: 1px solid var(--tratt-border)`.
- [ ] **Steg 5:** Kör `npx nx test tratt --testPathPattern="alert|maintenance|context-menu|shortcut"`. Utlös alla tre aviseringstyperna i `/local` (ladda en ogiltig fil, spara, avbryt en nedladdning) i båda temana.
- [ ] **Steg 6: Commit** `style(shell): toasts as tinted state surfaces; small components on tokens`

### Uppgift 32: Dialoger

**Filer:** Ändra `.html` i `apps/tratt/src/app/core/modals/*` enligt tabellen, samt tillhörande `.spec.ts`.

Dialogramen (`.modal-content`, `.modal-header`, stängknappen) följer redan Bootstrap-konfigurationen och uppgift 3. Det som återstår är knapprollerna. Tabellen är uttömmande: dialoger som inte står här behåller sina knappar.

- [ ] **Steg 1: Knappar.**

| Dialog                                                                       | Ändring                                                                                                                       |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `add-translated-level-modal`                                                 | _Skapa och översätt_: `btn-primary` → `btn-next`. _Skapa_: `btn-secondary` oförändrad.                                         |
| `catalogue-export-modal`                                                     | _Exportera_: `btn-primary` → `btn-next`.                                                                                       |
| `export-files-modal`                                                         | _Exportera inspelning_: `btn-secondary` → `btn-next`. _Stäng_: `btn-primary` → `btn-secondary`.                                |
| `import-options-modal`                                                       | _Verkställ_ (`close('apply')`): `btn-secondary` → `btn-next`. _Avbryt_ oförändrad.                                             |
| `overview-modal`                                                             | _Skicka_ (`sendTranscription()`): `btn-primary` → `btn-next`. Kvalitetsknapparna oförändrade (beslut 19). Rad 66 är redan åtgärdad i uppgift 4. |
| `tools-modal`                                                                | _Kombinera fraser_ och _Klipp ljud_: `btn-primary` → `btn-next`. _Stoppa_ (`btn-danger`) oförändrad.                           |
| `transcription-backup-end`                                                   | _Ladda ner säkerhetskopia_ (`downloadClicked = true`): `btn-primary` → `btn-next`. _Ignorera_ (`btn-danger`) och _Fortsätt_ (`btn-primary`) oförändrade. |
| `translate-linked-level-modal`                                               | _Översätt_: `btn-primary` → `btn-next`.                                                                                        |
| `unsaved-recording-modal`                                                    | _Exportera inspelning_: `btn-primary` → `btn-next`. _Lämna_: `btn-warning` → `btn-danger` (inspelningen förloras).             |
| Övriga                                                                       | Oförändrade, inklusive `help-modal` (`btn-info`), `yes-no-modal`, `transcription-delete-modal` och `bundle-reattach-mismatch-modal`. |

- [ ] **Steg 2: Inlinade färger.** `tools-modal`, `export-files-modal` och `overview-modal` har sammanlagt 9 namngivna färger i `style="…"`. Byt efter tabellen i uppgift 35 steg 1. `projects-list` (`text-white` ×2) hör till uppgift 34.
- [ ] **Steg 3: Teman.** I `transcription-guidelines-modal.component.html` finns `bg-warning` och en `btn-danger`-markör. Byt `bg-warning` mot `tratt-state-warning`.
- [ ] **Steg 4: Specar.** Sök efter selektorer som påverkas:

```bash
grep -rnE "btn-(primary|secondary|warning|success)" apps/tratt/src/app/core/modals --include=*.spec.ts
```

Uppdatera varje träff som pekar på en knapp du har ändrat. Lägg till en rad i `catalogue-export-modal.component.spec.ts` (och i `export-files-modal`): _Exportera_ har klassen `btn-next`.

- [ ] **Steg 5:** Kör `npx nx test tratt --testPathPattern=modal`. Öppna varje dialog i ljust och mörkt läge (Alt+8 och Alt+0, _Om Tratt_, export, översikt). De som saknar uppenbar väg in (_Tools_) går att öppna via `TrattModalService` i en spec, vilket testerna redan gör.
- [ ] **Steg 6: Commit** `style(modals): next-step buttons per dialog; unsaved recording leaves as danger`

### Uppgift 33: Onlineläget (`/login`, `/intern/auth`)

**Filer:**

- Ändra: `apps/tratt/src/app/core/pages/login/login.component.html` (grenen `!localOnly`), `.scss`
- Ändra: `apps/tratt/src/app/core/pages/intern/auth/*`, `auth-success/*`
- Ändra: `apps/tratt/src/app/core/component/authentication-component/*`
- Ändra: `apps/tratt/src/app/core/modals/re-authentication-modal/*`

- [ ] **Steg 1: Kortet.** Onlinekortet får samma utseende som `local-card` men smalare. I `login.component.scss`:

```scss
.login-card {
  max-inline-size: 32rem;
  margin: 3rem auto;
  padding: 2rem;
  border: 0;
  border-radius: 0.5rem;
  background: var(--tratt-surface-subtle);
}
```

Ta bort huvudplanens `.login-card { padding: 3rem }`. Lägg `class="tratt-page"` på sidans yttre element så att h1 (om den finns) och kortet linjerar med `/local`.

- [ ] **Steg 2: Knappar.** Inloggningsknappen i formuläret (den som skickar formuläret) blir `btn-next`. _Registrera_ och länkar blir `btn-link`. Fel på fälten (`.ng-touched .ng-invalid`) är redan flyttade till `--tratt-danger` i uppgift 10.
- [ ] **Steg 3:** `auth`, `auth-success` och `authentication-component` har inga hårdkodade färger i dag. Kontrollera att de ser rimliga ut i båda temana. Byt `btn-primary` för den enda knappen som fortsätter flödet mot `btn-next`.
- [ ] **Steg 4:** `re-authentication-modal` är åtgärdad i uppgift 4. Kontrollera att texten _Du har loggats ut_ är läsbar i mörkt läge.
- [ ] **Steg 5:** Kör `npx nx test tratt --testPathPattern="login|auth"`. Aktivera onlineläget lokalt och gå igenom `/login`, `/intern/auth` och återautentisering.
- [ ] **Steg 6: Commit** `style(online): login card and auth pages per the profile`

### Uppgift 34: Projektlista, sändning och slut

**Filer:** Ändra `apps/tratt/src/app/core/pages/intern/{projects-list,transcription-end,reload-file}/*` och `projects-list/project-request-modal/*`.

- [ ] **Steg 1:** `projects-list.component.html`: byt `text-white` (2 ställen) mot texten i raden (ta bort klassen om raden inte längre har färgad bakgrund) eller `tratt-state-*` om raden visar status. _Starta_ (`onProjectClick`, `btn-primary`) → `btn-next`. Sidnumreringen, om den visas, får `chevron`-ikoner enligt spec 8 (`backward-fast`, `backward`, `forward`, `forward-fast`).
- [ ] **Steg 2:** `project-request-modal`: _Skicka e-post_ (`btn-success`) är åtgärdad i uppgift 4.
- [ ] **Steg 3:** `transcription-end`: `named=1`, `px=1`. Byt efter tabellen i uppgift 35 steg 1. _Tillbaka till projekten_ förblir `btn-primary`.
- [ ] **Steg 4:** `reload-file`: ingen ändring utöver granskning. _Stoppa_ förblir `btn-secondary`.
- [ ] **Steg 5:** Kör `npx nx test tratt --testPathPattern="projects-list|transcription-end|reload-file"`.
- [ ] **Steg 6: Commit** `style(intern): projects list, submission end and reload on tokens`

### Uppgift 35: Klassiska transkriptionsläget

**Filer:**

- Ändra: `apps/tratt/src/app/core/pages/intern/transcription/transcription.component.{html,scss}`
- Ändra: `apps/tratt/src/app/editors/trn-editor/trn-editor.component.{html,scss}` och `modals/permutations-replace-modal/*`
- Ändra: `apps/tratt/src/app/editors/2D-editor/2D-editor.component.scss`, `transcr-window/transcr-window.component.{html,scss}`
- Ändra: `apps/tratt/src/app/core/component/transcr-overview/transcr-overview.component.{html,css}`
- Ändra: `apps/tratt/src/app/core/component/transcr-editor/transcr-editor.component.ts` (bara om färger finns i `styles`)

Det här är läget som `/intern/transcr` använder och som Arbetsbänkens redigerare delar komponenter med. Ändra inte beteende.

- [ ] **Steg 1: Översättningstabell** för alla hårdkodade värden i uppgift 31–38:

| Gammalt                                                         | Nytt                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| `red`, `crimson`, `#d7263d`, `#e74c3c` (text eller ikon)         | `var(--tratt-danger-text)`                                    |
| `red` (kant, fyllning av fel)                                   | `var(--tratt-danger)`                                         |
| `green`, `forestgreen`, `#2ecc71`                               | `var(--tratt-success)` (text: `var(--tratt-success-text)`)    |
| `orange`, `#f39c12`                                             | `var(--tratt-warning)` om det betyder avvikelse, annars `var(--tratt-next)` |
| `blue`, marinblått                                              | `var(--tratt-interactive)` (text: `var(--tratt-interactive-text)`) |
| `gray`, `grey`, `dimgray`, `#667a90`                            | `var(--tratt-text-muted)` (text) eller `var(--tratt-border-control)` (kant) |
| `lightgray`, `lightgrey`, `#d4d9e0`, `#e6e8ed`                  | `var(--tratt-border)` (linje) eller `var(--tratt-surface-sunken)` (yta) |
| `black`, `#000`                                                 | `var(--tratt-text-primary)`                                   |
| `white`, `#fff` (bakgrund)                                      | `var(--tratt-surface-page)`                                   |
| `yellow`                                                        | `var(--sb-yellow-tint)` (yta) eller `var(--tratt-warning)` (kant) |
| `font-size: Npx`                                                | `N/16 rem`, avrundat till närmaste 0,0625                      |

- [ ] **Steg 2: Översikten (`transcr-overview`).** Cellerna och raderna använder `bg-success` (transkriberad), `bg-info` (paus) och `bg-danger` (tom). Byt:

```bash
perl -pi -e 's/\bbg-(success|info|danger)\b/tratt-state-$1/g' apps/tratt/src/app/core/component/transcr-overview/transcr-overview.component.html
```

Läs sedan `.css` och ta bort regler som matchar `.bg-success`, `.bg-info`, `.bg-danger` eller `.red`. Byt `.segment-number .btn-link { color: var(--tratt-chrome-hover) }` mot `var(--tratt-interactive-text)` och `.segment-warning` mot `var(--tratt-danger-text)`. Statistikraden (`#statistics`) får samma klasser.

- [ ] **Steg 3: Verifieringsmarkörerna.** Manualen säger att varje rad börjar med ett streck som är **orange** tills en människa har kontrollerat enheten och sedan **grönt**. Sök efter markören och byt färgerna till `var(--tratt-next)` (ej kontrollerad) respektive `var(--tratt-success)` (kontrollerad). Exporterade dokument ändras inte (beslut 13).

```bash
grep -rnE "verif" apps/tratt/src libs --include=*.scss --include=*.css --include=*.html --include=*.ts -il | grep -v spec
```

- [ ] **Steg 4: Knappar.** `transcription.component.html`: _Skicka_ (`onSendButtonClick`) → `btn-next`. Kvalitetsknapparna oförändrade (beslut 19). _Exportera data_ (`btn-primary`) och _Spara_ förblir `btn-primary`. Den andra _Skicka_-knappen i samma mall, om den finns, gör likadant.
- [ ] **Steg 5: Vita ytor.** `trn-editor.component.html` har `bg-white` och `transcr-window.component.html` har `bg-light`/`text-dark` på kort eller verktygsfält. Byt till `bg-body`, `bg-body-tertiary` och `text-body`. Samma regel för de två `bg-light` i `login.component.html` (huvudplanens uppgift 13 byter dem mot `.tratt-panel`).
- [ ] **Steg 6: Specar.** Kör `grep -rnE "bg-(success|info|danger)" apps/tratt/src --include=*.spec.ts` och uppdatera träffarna.
- [ ] **Steg 7:** Kör `npx nx test tratt --testPathPattern="transcr|trn-editor|2D-editor|transcription"`. Öppna `/intern/transcr` med lokala data (se `apps/tratt/src/config/localmode`) i ljust och mörkt läge och kontrollera: segmentlistan, popup-redigeraren, översikten, TRN-redigerarens permutationsdialog och kontextmenyn.
- [ ] **Steg 8: Commit** `style(intern): classic transcription mode and overview on state tints and tokens`

### Uppgift 36: Informationssidor och verktyg

**Filer:**

- Ändra: `apps/tratt/src/app/core/pages/{news,features,help-tools,error404,browser-test,loading}/*`
- Ändra: `apps/tratt/src/app/core/tools/{table-configurator,naming-drag-and-drop,stresstest}/*`

- [ ] **Steg 1: Sidskal.** Lägg `class="tratt-page"` på sidans yttersta element i `news`, `features`, `help-tools` och `error404`. Ta bort egna `max-width`/`padding`.
- [ ] **Steg 2: Knappar.** `help-tools`: fem `btn-success` är åtgärdade i uppgift 4. `btn-primary refreshApp()` oförändrad. _Rensa alla data_ (`btn-danger`) oförändrad. `features`: `btn-info` och `btn-outline-primary` för _Manual_ oförändrade (blå = hjälp).
- [ ] **Steg 3: Verktyg.** `table-configurator.component.scss` har 12 namngivna färger och `naming-drag-and-drop` 5 hex/namngivna. Byt efter tabellen i uppgift 35 steg 1. Rader som markerar dra-och-släpp-läget får `var(--sb-blue-tint)` och en kant i `var(--tratt-interactive)`. `table-configurator.component.html` har ett `font-size` i px: byt till rem.
- [ ] **Steg 4: Webbläsartestet** (`/test`). `browser-test.component.ts` använder `TRATT_COLORS.accentGreen`. Huvudplanens uppgift 18 byter det mot `accentSuccess`. Kontrollera här att rader som anger ett _stöd saknas_ får `tratt-state-danger`, _delvis_ `tratt-state-warning` och _stöds_ `tratt-state-success`, med ikon (✓ `fa-check`, ⚠ `fa-triangle-exclamation`, ✕ `fa-xmark`) så att färgen inte är enda bäraren.
- [ ] **Steg 5: Laddning.** `loading.component.scss` har tre namngivna färger. Byt till tokens.
- [ ] **Steg 6:** Kör `npx nx test tratt --testPathPattern="news|features|help-tools|error404|browser-test|loading|table-configurator|naming"`. Besök `/news`, `/features`, `/help-tools`, `/test`, `/stresstest`, `/404` och `/load` i båda temana.
- [ ] **Steg 7: Commit** `style(pages): info pages and tools on the reading column and tokens`

### Uppgift 37: Visp-inbäddningen

**Filer:**

- Ändra: `apps/tratt/src/app/core/component/navbar/navbar.component.{html,ts,spec.ts}`

Inbäddningen (`/visp-task/project/:p/session/:s/bundle/:b`, `LoginMode.URL`) ska bara få nya färger och typsnitt (huvudplanens villkor). Sidhuvudet visas även där i dag, eftersom ingen kod döljer det. Det ändras inte, men logotypen får inte vara en länk.

- [ ] **Steg 1: Test först** i `navbar.component.spec.ts`: med `useMode === LoginMode.URL` ska `a.tratt-header__brand` saknas och `span.tratt-header__brand` finnas. Utan URL-läge ska länken finnas. Hämta `useMode` på samma sätt som `app.component.ts` (`appStorage.useMode`). Följ hur specen redan mockar den.
- [ ] **Steg 2: Mallen.** Omslut logotypens `<a>` i `@if (appStorage.useMode === LoginMode.URL) { <span class="navbar-brand tratt-header__brand"><tratt-logo [tagline]="false" /></span> } @else { … }`. Gör ingenting åt menyn.
- [ ] **Steg 3: Sidornas förskjutning.** Huvudplanens uppgift 7 steg 6 ber om en jämförelse före och efter. Gör den här: öppna `/visp-task/project/1/session/1/bundle/1` före och efter, i 1440 och 400 px. Innehållet ska börja direkt under sidhuvudet.
- [ ] **Steg 4: Kontrollera** att inget i inbäddningen använder `--tratt-header-height` på ett sätt som skär bort innehåll (sök efter `100vh` i `visp-task` och redigerarna). Anteckna avvikelser i uppgiftens commit.
- [ ] **Steg 5: Commit** `fix(shell): logo is not a link when embedded in Visp`

### Uppgift 38: Bibliotek och fristående ingångar

**Filer:**

- Ändra: `libs/ngx-components/src/lib/components/**` (bugreport-modal, form-generator och övriga icke-kanvaskomponenter)
- Test: `libs/ngx-components/src/lib/obj/tratt-colors.spec.ts`
- Ändra: `apps/web-components/README.md`

- [ ] **Steg 1: Test först** i `tratt-colors.spec.ts` (huvudplanens uppgift 18 skapar filen):

```ts
it('resolveTrattColors falls back to TRATT_COLORS when the page defines no tokens', () => {
  // jsdom returns '' for undefined custom properties: the library must still draw.
  const c = resolveTrattColors(document.createElement('div'));
  expect(c.playhead).toBe(TRATT_COLORS.playhead);
  expect(c.surfaceBackground).toBe(TRATT_COLORS.surfaceBackground);
});
```

Funktionen läggs till i huvudplanens uppgift 23. Lägg testet där om uppgift 23 görs först.

- [ ] **Steg 2: Bibliotekskomponenter.** `bugreport-modal.component.{html,scss}` har 5 Bootstrap-färgklasser och 3 färger. `toolconfig-array-adder` har en hex. Byt efter tabellen i uppgift 35 steg 1 men med reservvärde i `var()` (globala villkor): `var(--tratt-danger-text, #aa1b1e)`. Skicka-knappen i bugrapporten blir `btn-next`.
- [ ] **Steg 3: `web-components`.** Appen har ingen CSS (`styles.scss` är tom) och ska ha det så. Lägg till en rad i README under _Installation_: "Spelaren och visaren ritas på en kanvas. De läser `--tratt-*`-variablerna om sidan definierar dem och faller annars tillbaka på Språkbankens färger. Typsnittet är Noto Sans om sidan laddar det, annars Arial." Kontrollera att `apps/web-components-demo/index.html` fortfarande bygger och ritar (`npx nx build web-components` om målet finns).
- [ ] **Steg 4: Utanför.** `apps/translations` (beslut 12) och `apps/json-sets-demo` (inga stilar) ändras inte. Kontrollera bara att `npx nx run-many -t build -p tratt,web-components,json-sets-demo` går igenom.
- [ ] **Steg 5:** Kör `npx nx test ngx-components`.
- [ ] **Steg 6: Commit** `style(libs): ngx-components leftovers on tokens with fallbacks; document web-components theming`

---

## Fas 9 – Manualens webbplats och innehåll

Manualen byggs av `scripts/build-manual.mjs` till `dist/manual` (en `.html` per sida och språk, CSS och JS inbäddade, bilder i `assets/`) och publiceras av `.github/workflows/main.yml`. Sidmallen, CSS:en och texterna ändras här.

### Uppgift 39: Bygget använder appens palett

**Filer:**

- Skapa: `scripts/manual-assets/manual.scss` (ersätter `manual.css`, som tas bort)
- Ändra: `scripts/build-manual.mjs`
- Ändra: `package.json` (`sass` som devDependency om `npm ls sass` visar att det bara finns transitivt)

- [ ] **Steg 1: Kontrollera `sass`.** Kör `npm ls sass`. Skriv in samma version som Angular drar in (huvudplanen anger 1.97.3) som `devDependency` så att `scripts/` inte beror på ett transitivt paket.
- [ ] **Steg 2: Bygg CSS med Sass.** Byt de rader i `build-manual.mjs` som läser `manual.css` mot:

```js
import * as sass from 'sass';
const CSS = sass.compile(join(repoRoot, 'scripts', 'manual-assets', 'manual.scss'), { style: 'compressed' }).css;
```

`manual.scss` börjar med `@use '../../apps/tratt/src/styles/palette' as p;` och `@use '../../apps/tratt/src/styles/tokens';`. Det ger manualen samma `--sb-*`, `--tratt-*` och mörka tokens (`[data-bs-theme='dark']`) som appen. Ingen färg får skrivas som hex i `manual.scss` (kontrolleras i uppgift 44).

- [ ] **Steg 3: Typsnitt.** Skriv `function buildFonts(outDir: string): string` i `build-manual.mjs`. Funktionen:
  1. läser `node_modules/@fontsource/{jost/{300,400,500,700},noto-sans/{400,600},noto-serif/{400,400-italic,700}}.css`,
  2. behåller bara `@font-face`-block vars `src` pekar på delmängderna `-latin-` och `-latin-ext-`,
  3. behåller bara `woff2`-källan, kopierar filen till `<outDir>/assets/fonts/` och skriver om `url()` till `__ASSETS__fonts/<fil>`,
  4. returnerar den sammanslagna CSS-strängen.

  `CSS` blir `fontCss + sassCss`. I `renderPage` ersätts `__ASSETS__` med `${env.assetPrefix}assets/` innan CSS:en läggs i `<style>`. Det ger `assets/fonts/…` på engelska sidor och `../assets/fonts/…` på svenska.

- [ ] **Steg 4: Kontrollera `url()`.** I stycket "verify the generated site" lägger du till: för varje `url(...)` i varje genererad HTML-fil som inte börjar med `data:` ska filen finnas relativt sidan, annars hamnar posten i `broken` med texten "(missing font)". Det gör att en saknad eller felsökvägad fil stoppar bygget.
- [ ] **Steg 5: Provbygge.** Kör `npm run build:manual` och sedan `ls dist/manual/assets/fonts | wc -l` (förvänta 12–16 filer). Öppna `dist/manual/sv/index.html` via `npx http-server dist/manual -p 8081 -c-1` med DevTools → Network och kontrollera att typsnitten hämtas från `/assets/fonts/` utan 404. Inga anrop till andra värdar.
- [ ] **Steg 6: Commit** `build(manual): compile manual CSS from the app palette; self-host fonts`

### Uppgift 40: Manualens sidmall

**Filer:**

- Ändra: `scripts/manual-assets/manual.scss`, `manual.js`
- Ändra: `scripts/build-manual.mjs` (`UI`, `renderPage`, `renderLangSwitch`, `md`-reglerna)

Följ designdokumentets avsnitt 3–5 och beslut 14–15 och 18.

- [ ] **Steg 1: Sidhuvud.** Vitt (`--tratt-surface-page`) med hårlinje, höjd `var(--tratt-header-height)`. Vänster: märket (inläst från `apps/tratt/src/assets/img/tratt/tratt-mark.svg` och inlinat i mallen), ordet _Tratt_ i Jost Light `2.125rem` och _manual_ / _manual_ i Jost Medium `0.75rem` under. Samma mått som `tratt-logo.component.scss` (håll dem i takt, skriv det i en kommentar). Höger: språkväxlaren (glob + `EN`/`SV`) och temaknappen. Ikonerna `globe` och `circle-half-stroke` läses från `node_modules/@fortawesome/fontawesome-free/svgs/solid/*.svg` vid bygget och inlinas, eftersom manualen inte laddar Font Awesome. Lägg licenstexten (Font Awesome Free, CC BY 4.0) som HTML-kommentar i sidfoten.
- [ ] **Steg 2: GitHub** (beslut 18) tas bort ur sidhuvudet och ligger i sidfotens länkrad tillsammans med _Redigera den här sidan_.
- [ ] **Steg 3: Tema.** Lägg före `<style>` i `<head>` samma skript som i huvudplanens uppgift 21 steg 4, men med nyckeln `tratt.manual.theme` (manualen och appen delar inte ursprung). `manual.js` får en knapp-lyssnare som växlar `data-bs-theme` på `<html>`, sparar valet (`try/catch` runt `localStorage`) och uppdaterar `aria-pressed`. Ta bort `@media (prefers-color-scheme: dark)`-blocket i CSS:en: skriptet sätter temat ur systeminställningen.
- [ ] **Steg 4: Färger och typsnitt.**

| Del                       | Nytt                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `body`                    | `background: var(--tratt-surface-page)`, `color: var(--tratt-text-primary)`, `font-family: var(--tratt-font-ui)`. Ingen basstorlek.                                |
| Brödtext i `article`      | `var(--tratt-font-body)`, `1rem`, radavstånd `1.65` (beslut 14). Fetstil använder Noto Serif 700.                                                                 |
| Rubriker                  | h1 Jost 300 `2.75rem`, h2 Jost 400 `1.5rem` (behåll hårlinjen ovanför), h3 Jost 500 `1.1875rem`                                                                  |
| Tabeller                  | Noto Sans `0.875rem`, `th` på `--tratt-surface-subtle`, hårlinjer                                                                                                 |
| Länkar i texten           | `color: var(--tratt-interactive-text)`, **understrukna** (`text-underline-offset: 0.2em`). Färg är inte ensam bärare (WCAG 1.4.1).                                   |
| Sidopanel                 | `--tratt-surface-subtle`, hårlinje till höger. Avsnittsrubriker i Jost Medium `0.8125rem` utan versaler. Aktiv sida: `--sb-blue-tint` med 3 px kant i `--tratt-interactive`, textfärg oförändrad, vikt 500. Hovring: `--tratt-surface-sunken`. |
| Innehållsyta              | Ingen ram och ingen rundning. Läsbredd `max-inline-size: 46rem` på `article`.                                                                                      |
| `code`, `pre`             | `--tratt-surface-sunken`, `ui-monospace`                                                                                                                          |
| Filtret i sidopanelen     | `border: 1px solid var(--tratt-border-control)`, fokus med `--tratt-interactive`                                                                                  |
| Skärmbilder               | Behåll hårlinjen. Ingen mörk variant (beslut 17).                                                                                                                 |
| Utskrift                  | Dölj som i dag. Tvinga ljust tema med `@media print { :root { color-scheme: light } }`.                                                                           |

- [ ] **Steg 5: Blockcitat.** Manualen använder `>` för tre sorters meddelanden: förklaringar, varningar om det som inte fungerar (_Caveats to delete when the app changes_) och språknotiser. Ge `blockquote` blå ton med blå kant (hjälp, profilens blå roll). I `md.renderer.rules` lägger du till en regel som sätter klassen `callout-warning` på ett blockcitat vars första ord är `Warning`, `Caution`, `Varning` eller `Observera` (en gemen jämförelse, eventuellt efter `**`), och ge den gul ton med gul kant. `.untranslated` är också gul.
- [ ] **Steg 6: Sidfot** (beslut 15). Byt `page-footer` mot Språkbankens sidfot: logotyp (läs `apps/tratt/src/assets/img/sprakbanken/sprakbanken_logo.svg` vid bygget och inlinat eller kopierat till `assets/`), länkarna _Om oss_, _Nyheter_, _Andra plattformar_, _Kontakta oss_, _Referera till oss_ och texten _Använder du våra plattformar …_. Hämta alla texter ur `shell.footer.*` i `apps/tratt/src/assets/i18n/{en,sv}.json` (huvudplanens uppgift 9) i stället för att skriva dem en gång till i `UI`. Under dem raden _Redigera den här sidan_ och _Källkod på GitHub_.
- [ ] **Steg 7: Titlar och namn.** I `build-manual.mjs` byter du varje "TRATT" mot "Tratt": `<title>`, `<meta name="description">`, märket och sidfoten (rad ca 366, 367, 374 och 398). Uppdatera kommentaren överst ("Renders the TRATT user manual").
- [ ] **Steg 8: Test.** Skapa `scripts/build-manual.test.mjs` (kör med `node --test`) som bygger till en tillfällig katalog och kontrollerar: `dist/…/index.html` innehåller `data-bs-theme`-skriptet och `Tratt`, inte `TRATT`; `sv/index.html` refererar `../assets/fonts/`; ett blockcitat som börjar med `**Warning` får `callout-warning`; inga `#`-färger finns i den kompilerade CSS:en utanför `:root`/`[data-bs-theme]`-blocken. Lägg `"test:manual": "node --test scripts/"` i `package.json`.
- [ ] **Steg 9:** Kör `npm run build:manual && npm run validate:manual && npm run test:manual`. Öppna `dist/manual/index.html` och `sv/workbench.html` i 1440, 900 och 400 px i båda temana. Menyknappen under 900 px, filtret och språkväxlaren ska fungera. Fokus (Tab) ska synas.
- [ ] **Steg 10: Commit** `style(manual): Språkbanken header, footer, theme toggle and type for the manual site`

### Uppgift 41: Manualens text

**Filer:** Ändra `docs/manual/*.md`, `docs/manual/sv/*.md` och `docs/manual/CONTRIBUTING.md`. Uppgiften görs **efter** Fas 3–5 och 8, eftersom texten ska beskriva det som faktiskt levereras.

Citera gränssnittet exakt (CONTRIBUTING, _Conventions_): kontrollera varje etikett mot `en.json` och `sv.json` när du ändrar.

- [ ] **Steg 1: Sök efter texter som påverkas.** Förväntat resultat efter ändringen är tomt, utom de träffar som anges som oförändrade.

```bash
grep -rnE -i "top bar|navigation bar|navigeringslist|toolbar under the top bar|\(blue\)|\(blå\)|GitHub link|marinblå|navy" docs/manual --include='*.md' | grep -v CONTRIBUTING
```

- [ ] **Steg 2: Ändringar per sida** (engelska och svenska):

| Sida                                                                                 | Ändra                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `index.md` (rad ca 32), `workbench.md` (13), `glossary.md` (32), `coming-from-octra.md` (55) | Arbetsbänken har nu en länk _Workbench_ / _Arbetsbänk_ i sidhuvudet på `/local` när funktionen är aktiverad (huvudplanens beslut 11). Ta bort påståendet att den bara nås via adressen, och ta bort raden i CONTRIBUTING-tabellen _Caveats to delete_ (rad 216–217). Behåll att den bara syns när `environment.workbenchEnabled`. Raden "Manual link in the navigation bar" i `coming-from-octra.md` kontrolleras mot `ManualLinkService`. |
| `quick-start.md` (114), `exporting.md` (8), `workbench.md` (211, 215)               | _Exportera_: nedladdningsikonen i sidhuvudet finns kvar i klassiskt läge. I Arbetsbänken ligger knappen i raden med redigerarflikarna. Beskriv var knappen sitter (huvudplanens uppgift 17).                                                                                                                                                         |
| `workbench.md` (56, 149–155)                                                         | Filnamnet och metadata visas i dataväljaren i sidhuvudets mitt, inte i en rubrik ovanför redigeraren. Dataväljaren öppnar fillistan (viktigt på smala skärmar). _Kortkommandon_, _Översikt_ och _Hjälp_ ligger i samma rad som redigerarflikarna.                                                                                                      |
| `loading-media.md` (69)                                                              | Nivåmätaren är nu **grön** (bra), **gul** (marginell) och **röd** (tyst eller överstyrd). Byt "orange" mot "gul" (sv: "gult"). Se huvudplanens uppgift 13.                                                                                                                                                                                          |
| `loading-media.md` (122–129)                                                         | Tabellen anger knappfärger: "(blue)". _Fortsätt transkription_, _Manuell transkription_, _Kör automatisk bearbetning_ och _Ersätt de lagrade annoteringarna_ delar nu den stora **orangea** knappen. Ändra till "(orange)" i tabellen och i meningen ovanför. Den röda knappen (_Ny transkription_) är oförändrad.                                    |
| `quick-start.md` (61), `automatic-transcription.md`                                  | "Klicka på knappen under rutan": knappen är nu orange och i full bredd. Lägg inte till färgen i texten om den inte hjälper läsaren att hitta knappen.                                                                                                                                                                                              |
| `quick-start.md` (106), `checking-your-work.md` (51–62), `troubleshooting.md` (158–164), `exporting.md` (68–72) | Verifieringsstrecken är **orange** (ej kontrollerad) och **gröna** (kontrollerad) som förut (uppgift 35 steg 3 behåller betydelsen). Ingen ändring. Kontrollera bara att texten stämmer med skärmbilden efter uppgift 42.                                                                                                                              |
| `transcribing.md` (51, 153), `troubleshooting.md` (212), `the-editors.md` (8)        | Sidhuvudet är nu vitt. "The save icon in the top bar", "the gear icon" och "the question-mark icon in the top bar" gäller bara om ikonerna ligger kvar. Kontrollera mot det som uppgift 7 levererade och rätta platsangivelserna. Behåll ordet _top bar_ bara om sidhuvudet kallas så i `shell.header.label` (_Main navigation_).             |
| `the-editors.md`, `workbench.md`                                                     | Redigeraromkopplaren och "Below 1400 px the editor switcher collapses to icons" (CONTRIBUTING, rad 202): kontrollera mot raden i uppgift 17 och rätta.                                                                                                                                                                                                  |
| `index.md`, `privacy.md`                                                             | Lägg till en mening om det nya temaväxlaren (_Växla mellan ljust och mörkt läge_) och att valet sparas på den egna enheten och inte skickas någonstans. Det hör hemma i `privacy.md` under _Vad som sparas i webbläsaren_ (eller motsvarande rubrik).                                                                                                  |
| `shortcuts.md`                                                                       | Ingen ändring i tangenterna. Bekräfta att `<kbd>Alt+8</kbd>` och `<kbd>Alt+0</kbd>` nu visas som tangenter och inte som `[ALT + 8]`.                                                                                                                                                                                                                  |

- [ ] **Steg 3: Gränssnittsmenyn och språket.** Raden _Language:_ finns inte längre (huvudplanen: glob och språknamn). Sök i manualen: `grep -rn -i "language:" docs/manual --include='*.md'`. Beskriv i stället "språkväljaren (globen)".
- [ ] **Steg 4: CONTRIBUTING.** Uppdatera: raden under _Screenshots_ om upplösning och bredd (kontrollera siffrorna i uppgift 42), tabellen _Caveats to delete_ (ta bort Arbetsbänkens två rader), meningen "Fixed since the manual was first written … the navbar GitHub link" (GitHub ligger nu under _Om Tratt_), och lägg till under _Conventions_: "Manualens utseende kommer från appens palett (`apps/tratt/src/styles/_palette.scss`). Ändra aldrig färger i `manual.scss`." samt en rad om att blockcitat som börjar med `**Warning`/`**Varning` blir gula.
- [ ] **Steg 5: Namnformen.** "Tratt" används redan i texterna (committen `docs: Tratt name update`). Kör `grep -rn "TRATT" docs/manual --include='*.md'`: de två träffarna i `troubleshooting.md` (URL till issues och GitHub-repot) och i `CONTRIBUTING.md` är adresser eller filvägar och ändras inte.
- [ ] **Steg 6:** Kör `npm run validate:manual` och `npm run build:manual`. Läs de tre mest ändrade sidorna (`workbench.md`, `loading-media.md`, `quick-start.md`) på båda språken i den byggda webbplatsen.
- [ ] **Steg 7: Commit** `docs(manual): describe the new header, data selector, buttons and colours`

### Uppgift 42: Skärmbilder

**Filer:**

- Skapa: `scripts/shoot-manual-screens.mjs`
- Ändra: `docs/assets/visp_tratt_*.png` (12 filer)
- Ändra: `docs/manual/CONTRIBUTING.md` (avsnittet _Screenshots_)
- Ändra: `package.json` (skript `docs:screens`)

Nio bilder används av manualen (18 referenser) och tre bara av `README.md`. Alla visar det gamla utseendet (marinblått sidhuvud, blå knappar). Gör om dem med ett skript, så att nästa ändring inte kräver handarbete.

- [ ] **Steg 1: Material.** Fixtur-filerna (fyra korta inspelningar och SRT-filer, se CONTRIBUTING _How to reproduce them_) finns inte i repot. Skriptet läser katalogen i miljövariabeln `MANUAL_FIXTURES` och avbryter med ett begripligt fel om den saknas eller saknar `interview-01-mixed.srt`. Dokumentera i CONTRIBUTING hur materialet skapas (`espeak-ng`-kommandona finns beskrivna där).
- [ ] **Steg 2: Skriptet** använder Playwright (huvudplanens uppgift 27) mot `BASE_URL` (standard `http://localhost:5321`) och sparar PNG med `deviceScaleFactor: 2`. Ljust tema (`localStorage['tratt.theme'] = 'light'` via `addInitScript`, beslut 17). Tabell över vad som ska tas:

| Fil                                         | Rutt och tillstånd                                                                                   | Viewport     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| `visp_tratt_main.png`                       | `/local`, tom, fram till startknappen (beskär vid knappen)                                           | 1360 × 820   |
| `visp_tratt_auto_transcription_options.png` | `/local`, panelen _Auto-transcribe_ utfälld. **Kräver riktig Chrome med WebGPU.** Tas för hand.      | utsnitt      |
| `visp_tratt_draft_automatic_transcription.png` | `/local`, förlopp pågår (README)                                                                  | 1360 × 820   |
| `visp_tratt_2d_editor.png`                  | klassiskt/Arbetsbänk, 2D-redigeraren med talarmarkörer                                               | 1440 × 820   |
| `visp_tratt_linear_editor.png`              | linjär redigerare, en enhet öppen                                                                    | 1440 × 820   |
| `visp_tratt_dictaphone_editor.png`          | diktafonredigeraren                                                                                  | 1440 × 820   |
| `visp_tratt_popup_editor_audio_only.png`    | popup-fönstret över 2D-redigeraren                                                                   | 1440 × 820   |
| `visp_tratt_popup_editor_audio_and_video.png` | popup med videofil (README)                                                                        | 1440 × 820   |
| `visp_tratt_overview.png`, `visp_tratt_overview_edit.png` | Översikten, de två första enheterna kontrollerade (SRT med `⍻` i resten)               | 1440 × 820   |
| `visp_tratt_export_formats.png`             | exportdialogen                                                                                       | 1440 × 820   |
| `visp_tratt_workbench.png`                  | `/workbench` med fyra inspelningar, en vald, en klar, en i kö                                        | 1480 × 900   |

Bilden med WebGPU tas för hand och är den enda som inte genereras. Skriptet hoppar över den och skriver ut en påminnelse.

- [ ] **Steg 3:** Kontrollera varje bild i full storlek: inga personuppgifter, inga felmeddelanden som inte hör till, rätt tema. Ersätt filerna (samma filnamn, så att 18 + 3 referenser ligger kvar).
- [ ] **Steg 4:** Uppdatera tabellen och meningen "The nine screenshots … 8 October build … 22 October build" i CONTRIBUTING med de nya datumen och vilken byggversion som användes.
- [ ] **Steg 5:** Kör `npm run validate:manual`, `npm run build:manual`. Bildernas storlek ska inte växa orimligt: håll varje fil under 400 kB utom de två popupbilderna (kör `npx sharp-cli` eller `optipng` om det behövs).
- [ ] **Steg 6: Commit** `docs(assets): re-shoot manual and README screenshots from the Språkbanken build`

### Uppgift 43: Manualens tillgänglighet

**Filer:**

- Skapa: `scripts/a11y-manual.mjs`
- Ändra: `package.json` (skript `a11y:manual`)

- [ ] **Steg 1: Skriptet.** Samma uppbyggnad som `scripts/a11y-contrast.mjs` (huvudplanens uppgift 27). Det läser alla `*.html` under `dist/manual` (rekursivt, 16 sidor × 2 språk), öppnar var och en från `BASE_URL` (standard `http://localhost:8081`) i båda temana (`localStorage['tratt.manual.theme']`) och kör axe-core med reglerna `color-contrast`, `link-in-text-block`, `html-has-lang`, `image-alt`, `landmark-one-main` och `skip-link`. Skriptet skriver `fil: selektor – sammanfattning` för varje överträdelse och avslutar med felkod 1 om det finns några.
- [ ] **Steg 2:** Kör:

```bash
npm run build:manual
npx http-server dist/manual -p 8081 -c-1 &
npm run a11y:manual
```

Rätta det som hittas. Vanliga orsaker: länkar i löptext utan understrykning, `--tratt-text-muted` på `--tratt-surface-sunken` i innehållsförteckningen och filtret, kodblock i mörkt läge.

- [ ] **Steg 3:** Lägg ett steg _Manual accessibility_ i `.github/workflows/ci.yml` först när teamet vill att det ska gå i CI (det kräver `npx playwright install --with-deps chromium`). Dokumentera i CONTRIBUTING att skriptet körs lokalt före en publicering.
- [ ] **Steg 4: Commit** `test(a11y): contrast and link checks for the built manual in both themes`

---

## Fas 10 – Verifiering

### Uppgift 44: Utökad kontroll och slutkontroll

**Filer:**

- Ändra: `scripts/check-style-tokens.mjs` (huvudplanens uppgift 25)
- Ändra: `scripts/a11y-contrast.mjs` (huvudplanens uppgift 27)

- [ ] **Steg 1: `--report`.** Kontrollera att flaggan från uppgift 25 finns (`node scripts/check-style-tokens.mjs --report` skriver `mapp: antal` och avslutar med 0). Kör den och bekräfta att varje mapp i utgångsläget är nere på noll utom undantagslistan.
- [ ] **Steg 2: Skärp stilkontrollen** (ändring av huvudplanens uppgift 25):
  - `roots`: lägg till `apps/tratt/src/index.html`, `apps/web-components/src` och `scripts/manual-assets`.
  - `exts`: lägg till `.ts` men flagga bara rader som liknar `color:`, `background`, `fill`, `stroke`, `style=` eller `styles:`. Undantag med skäl: `libs/ngx-components/src/lib/obj/tratt-colors.ts`, `speaker-colors.ts`, `audio-viewer.config.ts` (palettvärden).
  - I `libs/ngx-components` räknas inte ett hex-värde som ligger som andra argument i `var(--…, #hex)` (globala villkor).
  - Nya förbud i mallar: `btn-success`, `navbar-dark`, `bg-primary`. De tre ska inte återkomma.
  - Ta bort undantagen som steg 1–3 av uppgift 31–38 har gjort onödiga och kontrollera att undantagslistan nu bara innehåller förhandsvisningen i `recording-panel.component.html:190`.
- [ ] **Steg 3: Ruttlistan i kontrastkontrollen** (ändring av uppgift 27). Utöka listan med rutterna som går att nå utan inloggning: `/local`, `/workbench` (fil inläst), `/news`, `/features`, `/help-tools`, `/test`, `/404` och `/load`. Lägg även till tillståndet _Om Tratt_-dialogen öppen på `/local` och _export_-dialogen i `/workbench`, eftersom dialoger är de ytor där fylld färg och gamla klasser döljer sig. För onlinesidorna (`/login`, `/intern/*`) krävs en inloggad session: kör dem manuellt (steg 4) och inte i skriptet.
- [ ] **Steg 4: Slutkontroll** (tillägg till huvudplanens uppgift 29):
  - [ ] `npm run lint:styles`: noll träffar och en tillåtelselista med en rad
  - [ ] `npm run a11y:contrast` och `npm run a11y:manual`: noll överträdelser i båda temana
  - [ ] `npm run test:manual`, `npm run validate:manual`, `npm run build:manual`
  - [ ] `grep -rnE "bg-(white|light)|text-dark|btn-(dark|light)" apps/tratt/src/app libs --include=*.html --include=*.ts --exclude=*.spec.ts` är tomt eller varje träff är motiverad i en kommentar
  - [ ] Manuell genomgång i ljust och mörkt läge av `/login` (online), `/intern/projects`, `/intern/transcr` med lokala data, alla dialoger som uppgift 32 listar och `/visp-task/…` (logotypen är inte en länk)
  - [ ] Manualen på engelska och svenska i 1440, 900 och 400 px: sidhuvud, filter, språkväxlare, temaväxlare, blockcitat (blå och gula), tabeller, sidfot
  - [ ] Huvudplanens uppgift 29: offlinekontrollen med produktionsbygget omfattar nu även att `dist/apps/tratt/media/` innehåller `noto-serif-latin-700-normal.*.woff2`
  - [ ] Specen: avsnittet _Shipped shape_ (huvudplanens uppgift 29) lägger till en rad per beslut 12–19 och eventuella avsteg
- [ ] **Steg 5: Commit** `ci: widen style-token and contrast checks to every entry point`

---

## Självgranskning

**Täckning av önskemålet.** _Alla ingångar:_ rutterna `load`, `login`, `local`, `workbench`, `intern/*` (projects, transcr, transcr/end, transcr/reload-file, auth, auth-success), `test`, `404`, `news`, `features`, `help-tools`, `stresstest` och `visp-task` har var sin uppgift (30–38 med huvudplanens 3–20). Dialogerna har uppgift 32 och aviseringarna 31. Biblioteken och de fristående apparna har 38, där `apps/translations` uttryckligen står utanför med skäl. _Manualens sidor:_ webbplatsens mall, CSS, typsnitt och bygge (39–40), texten (41), bilderna (42) och tillgängligheten (43) är separata uppgifter.

**Typkonsistens.** Klassnamnen `.tratt-state-{next,info,success,warning,danger,neutral}` och `.tratt-page` definieras i uppgift 30 och används med samma namn i 31, 32, 35, 36 och 38. `--tratt-header-height`, `--tratt-interactive-text`, `--tratt-danger-text`, `--tratt-success-text`, `--tratt-text-muted`, `--tratt-border`, `--tratt-border-control`, `--tratt-surface-*` och `--sb-*-tint` kommer från huvudplanens uppgift 2. Nyckeln `tratt.manual.theme` i uppgift 40 och 43 är densamma. Skriptnamnen `lint:styles`, `a11y:contrast`, `a11y:manual`, `test:manual` och `docs:screens` är unika.

**Beroenden.** Uppgift 40 steg 6 behöver sidfotens logotyp och `shell.footer.*` (huvudplanens uppgift 9). Uppgift 41 och 42 beskriver och fotograferar det som levereras och kommer därför sist. Uppgift 37 ändrar logotypen från huvudplanens uppgift 7 och kan göras först när den är klar.

**Risker kvar.** (1) Grenen `!localOnly` i `login.component.html` (filen är 30 kB) har inte lästs rad för rad vid planeringen. Uppgift 33 anger beslut och klasser, inte rader, och den som genomför läser filen. (2) Kvalitetsknapparna (beslut 19) är det enda ställe där Bootstrap-färger bär betydelse utanför profilens roller. (3) Skärmbilden med WebGPU kan inte automatiseras (uppgift 42). (4) Planen har inte körts: kommandona i uppgift 31–44 är kontrollerade mot filstrukturen men inte exekverade.
