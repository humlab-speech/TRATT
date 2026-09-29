# Workbench Visual Polish + Editor Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the visual gap between `/workbench` and its reference mockup (`docs/superpowers/specs/reference/TRATT Workbench.dc.html`) — bundle-list cards, pipeline-settings section label, a right-pane title/metadata header — and add a real, working editor-switcher tab row, which does not exist anywhere in this app today (not even on `/local`).

**Architecture:** Four independent, sequential tasks. Tasks 1-2 are pure CSS/template changes to existing components (`bundle-list.component.scss`, `workbench.component.html`'s pipeline-settings block) — no new logic, no state, verified by manual smoke check against the running dev server rather than unit tests, matching this codebase's own precedent for style-only fixes (commit `39327f20f`, "stop dropzone icon and recording toolbar overlapping," shipped with no spec changes). Task 3 adds a small pure read of already-resident data (`AudioService.current`, the selected bundle's `AudioInfo`) into a new header, reusing `formatMinutesSeconds`/`getFileSize` from `@tratt/utilities` rather than writing new formatting logic. Task 4 is the one task with real logic: `WorkbenchComponent.changeEditor()` currently has a known, code-commented gap ("If an editor-switcher UI ever calls `changeEditor()` directly, editor selection will silently stop persisting") — closing it and wiring a tab row on top of it is TDD'd.

**Tech Stack:** Angular 19 standalone components, NgRx (read-only selectors, no new state), Transloco, existing `@tratt/utilities` formatting helpers.

**Spec:** `docs/superpowers/specs/2026-09-10-workbench-conversion-design.md` — see its "Finding + design (2026-09-29)" section, point 5 in particular for the editor-switcher decision and design.

## Global Constraints

- No new NgRx state — Task 4's "active editor" tracking is component-local (a signal on `WorkbenchComponent`), matching how `sessionReady`/`sessionStarting` are already tracked there.
- Every new user-facing string gets Transloco keys in both `en.json` and `sv.json`; `npm run validate:i18n` must stay green.
- `OnPush` change detection is already in effect on `WorkbenchComponent` and `BundleListComponent` — new signals/computed values must be read via the template (not imperative DOM writes) to stay compatible.
- Do not touch `TranscriptionComponent`/`/local` — this plan is `/workbench`-only, matching every prior step of this conversion.
- Do not add the `timer(20)`/`editorloaded`/`openModal`-rewiring machinery from `TranscriptionComponent.changeEditor()` — confirmed unexercised by any current editor in a live `/workbench` session (Finding, 2026-09-29); Task 4 closes only the persistence gap, not a full port of that method.

## Review Focus

- **Switching editors while mid-edit must not silently drop an in-progress annotation change.** All four editors are store-backed (no local-only buffered state — confirmed via `TrattEditorRequirements`/`TRATTEditor` base class: no flush/save hook exists because none is needed), so `viewContainerRef.clear()` disposing the old instance is safe — but Task 4 must assert this with a real test, not just cite the reasoning.
- **Repeated switches must each fully dispose the previous editor**, not leak one on top of another — `clear()` before `createComponent()` on every call, not just the first.
- **`appStorage.interface` must reflect the last-clicked tab**, and survive a subsequent `mountDefaultEditor()` call (e.g. a second session start) picking it back up — not just update transiently in the component.
- **The active-tab highlight must track the real mounted editor**, not just "whatever was last clicked" — if `changeEditor()` is ever called from `mountDefaultEditor()` at startup (it already is), the tab row must show the correct tab highlighted from the very first render, not only after a manual click.
- **A restored/awaiting-media bundle with no resident audio must not crash the new title/metadata header** — `AudioService.current` can be `undefined` for a bundle that exists in the list but was never selected/decoded this session (step 2.8's whole premise); the header must degrade gracefully, not throw.

---

### Task 1: Bundle-list card and status-badge restyle

**Files:**
- Modify: `apps/tratt/src/app/core/component/bundle-list/bundle-list.component.scss`

**Interfaces:**
- Consumes: the existing template classes already emitted by `bundle-list.component.html` — `.bundle-list__item` (with `.active` modifier), `.bundle-list__item-checkbox`, `.bundle-list__status` (with `--running`/`--done`/`--error` modifiers), `.bundle-list__item-btn`. No template changes in this task — every hook this task needs already exists.
- Produces: no new classes or selectors other consumers rely on — purely a visual restyle of existing ones.

- [ ] **Step 1: Read the current rendered state for a baseline**

Run: `npm start` (skip if already running), then in a browser open `http://localhost:5321/workbench`, drop an audio file, click "Start session" so at least one bundle row renders. Take a screenshot or just look — this is the "before" to compare against.

- [ ] **Step 2: Give `.bundle-list__item` a bordered card treatment with a status-colored left accent**

```scss
// apps/tratt/src/app/core/component/bundle-list/bundle-list.component.scss

.bundle-list__item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid var(--tratt-border, #d4d9e0);
  border-left: 3px solid transparent;
  border-radius: 4px;
  padding: 0.4rem 0.5rem;
  margin-bottom: 0.375rem;

  &.active {
    border-left-color: var(--tratt-accent-green, #3d6b5c);
    background-color: var(--tratt-surface-background);

    .bundle-list__item-btn {
      background-color: transparent;
      font-weight: 600;
    }
  }

  &:hover:not(.active) .bundle-list__item-btn {
    background-color: var(--tratt-surface-background);
    opacity: 0.7;
  }
}
```

Remove the old `border-radius: 4px;` declaration that was directly on `.bundle-list__item` before this step (it's now part of the block above) and the old `&.active`/`&:hover` nested rules it contained — replace the whole existing `.bundle-list__item { ... }` block with the one above rather than appending a second one.

- [ ] **Step 3: Turn `.bundle-list__status` into a colored pill instead of plain inline text**

```scss
.bundle-list__status {
  margin-left: auto;
  padding: 0.1rem 0.5rem;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
  background: var(--tratt-surface-muted, #e6e8ed);
  color: var(--tratt-text-muted, #667a90);
}

.bundle-list__status--running {
  background: #fbeed9;
  color: var(--tratt-accent-warning);
}

.bundle-list__status--done {
  background: #e2ede8;
  color: var(--tratt-accent-green);
}

.bundle-list__status--error {
  background: #f9dde1;
  color: var(--tratt-accent-error);
}
```

Delete the old `.bundle-list__status`/`--running`/`--done`/`--error` rules (currently just `margin-left`/`font-size`/`opacity`/`color`) — replace them with the block above.

- [ ] **Step 4: Give the checkbox breathing room inside the card**

```scss
.bundle-list__item-checkbox {
  margin: 0;
  flex-shrink: 0;
}
```

Replace the existing `.bundle-list__item-checkbox { margin-right: 0.375rem; }` rule with this (the `gap: 0.5rem` on `.bundle-list__item` from Step 2 now provides the spacing instead).

- [ ] **Step 5: Let the primary button/label fill remaining row width without its own padding fighting the card's**

```scss
.bundle-list__item-btn,
.bundle-list__reattach-label {
  flex: 1;
  min-width: 0;
  padding: 0;
  border-radius: 0;
}
```

Remove the `padding: 0.25rem 0.5rem;` and `border-radius: 4px;` lines from the existing `.bundle-list__item-btn` and `.bundle-list__reattach-label` rules (the card itself now owns padding/radius from Step 2) — keep every other existing declaration on those two rules (`display: block`, `width: 100%` can go too since `flex: 1; min-width: 0;` replaces them, but `cursor: pointer`, `background: none`, `border: none`, `text-align: left`, `font: inherit`, `color: inherit`, and (for the reattach label only) `text-decoration: underline dotted` all stay).

- [ ] **Step 6: Manual smoke check**

`npm start`, `/workbench`, upload `example.wav` (or `example2.wav`), start a session. Expected: the bundle row renders as a bordered card, the active row has a green left accent, the checkbox has visible spacing from the card edge, and — once a transcription run finishes — the status renders as a small colored pill (green for done) rather than plain text. Also check a `failed`/`interrupted` row (can be simulated by running the queue offline, or skip if none is easily reachable — the CSS selectors are exercised by the existing `--error` modifier regardless).

- [ ] **Step 7: Commit**

```bash
git add apps/tratt/src/app/core/component/bundle-list/bundle-list.component.scss
git commit -m "style(bundle-list): card layout with status-accent border and pill badges"
```

---

### Task 2: Pipeline-settings section label restyle

**Files:**
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.html:60-62`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.scss`

**Interfaces:**
- Consumes: nothing new — the existing `<h6 class="workbench__queue-title">` element.
- Produces: nothing new.

- [ ] **Step 1: Swap the `<h6>` for the capacity-indicator's own label convention**

In `workbench.component.html`, find:

```html
<h6 class="workbench__queue-title">
  {{ 'workbench.queue.options_title' | transloco }}
</h6>
```

Leave the element and binding exactly as-is (still an `<h6>`, still the same translate key/text "Pipeline settings") — only the CSS class treatment changes in Step 2. No HTML edit needed in this step; it's already correct. Confirm by reading the current file (`workbench.component.html:60-62`) before moving on — if it differs from what's pasted above, match what's actually there.

- [ ] **Step 2: Restyle `.workbench__queue-title` to match `.capacity-indicator__label`**

```scss
// apps/tratt/src/app/core/pages/workbench/workbench.component.scss

.workbench__queue-title {
  margin-bottom: 0.25rem;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: #667a90;
}
```

Replace the existing `.workbench__queue-title { margin-bottom: 0.25rem; }` rule with the block above (same property, more added).

- [ ] **Step 3: Manual smoke check**

`npm start`, `/workbench`, upload a file, start a session. Expected: "PIPELINE SETTINGS" (or whatever the current transloco text is) renders in small, uppercase, gray-blue text matching the "BROWSER STORAGE" / "WORKING MEMORY (EST.)" labels directly below it in the same left rail, rather than default bold heading styling.

- [ ] **Step 4: Commit**

```bash
git add apps/tratt/src/app/core/pages/workbench/workbench.component.scss
git commit -m "style(workbench): match pipeline-settings label to capacity-indicator convention"
```

---

### Task 3: Right-pane title/metadata header

**Files:**
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.html`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.scss`
- Modify: `apps/tratt/src/assets/i18n/en.json`
- Modify: `apps/tratt/src/assets/i18n/sv.json`
- Test: `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts` (extend)

**Interfaces:**
- Consumes: `AudioService.current: AudioManager | undefined` (already injected as `private audioService`), `AudioManager.resource.info: AudioInfo` (`.fullname: string`, `.duration: SampleUnit` with `.seconds: number`, `.sampleRate: number`, `.channels: number`, `.size: number` — all from `libs/web-media/src/lib/audio/audio-info.ts`), `formatMinutesSeconds(seconds: number): string` and `getFileSize(bytes: number): { size: number; label: string }` from `@tratt/utilities` (already used identically in `apps/tratt/src/app/core/pages/login/login.component.ts:10,55-57`).
- Produces: `WorkbenchComponent.selectedBundleHeader: Signal<{ name: string; metadata: string } | undefined>` — a computed signal the template reads; `undefined` when no audio is resident for the current selection (degrades to rendering nothing).

- [ ] **Step 1: Write the failing test**

Read the existing bundle-fixture/mock conventions at the top of `workbench.component.spec.ts` first (search for `bundleSummaries`, `provide: AudioService`) and mirror them exactly — don't introduce a second mocking style into the same file. Then add:

```ts
// append to apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts

describe('selectedBundleHeader', () => {
  it('is undefined when no audio is resident for the selection', () => {
    (component as any).audioService = { current: undefined };
    fixture.detectChanges();

    expect(component.selectedBundleHeader()).toBeUndefined();
  });

  it('formats name, duration, sample rate, and size from the resident AudioManager', () => {
    (component as any).audioService = {
      current: {
        resource: {
          info: {
            fullname: 'example.wav',
            duration: { seconds: 125 },
            sampleRate: 48000,
            channels: 2,
            size: 90_000_000,
          },
        },
      },
    };
    fixture.detectChanges();

    const header = component.selectedBundleHeader();
    expect(header?.name).toBe('example.wav');
    expect(header?.metadata).toContain('2:05');
    expect(header?.metadata).toContain('48');
    expect(header?.metadata).toContain('stereo');
  });
});
```

Adapt the exact mock shape to whatever `AudioService`/`AudioManager` mocking pattern the file's `beforeEach` already establishes for other tests (e.g. the recording/dropzone tests) — read it first rather than assuming this snippet's structure is exact; the assertions (`toBeUndefined`, `toContain`) are what matter, not the mock's literal shape.

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: FAIL — `selectedBundleHeader` doesn't exist.

- [ ] **Step 3: Implement `selectedBundleHeader`**

```ts
// apps/tratt/src/app/core/pages/workbench/workbench.component.ts
import { formatMinutesSeconds, getFileSize } from '@tratt/utilities';

// inside the class, alongside the other computed signals (readyBundleIds etc.)
selectedBundleHeader = computed(() => {
  const manager = this.audioService.current;
  if (!manager) {
    return undefined;
  }
  const info = manager.resource.info;
  const fileSize = getFileSize(info.size);
  const channelLabel = info.channels === 1 ? 'mono' : 'stereo';
  return {
    name: info.fullname,
    metadata: `${formatMinutesSeconds(info.duration.seconds)} · ${Math.round(info.sampleRate / 1000)} kHz ${channelLabel} · ${fileSize.size} ${fileSize.label}`,
  };
});
```

Note: `audioService.current` is a plain getter (not a signal), so `selectedBundleHeader` as a `computed()` won't auto-recompute on its own when `current` changes — it needs to be read from a template context that's already re-checked on the events that change it. `sessionReady`'s own change (driving the `@if (sessionReady)` block this header lives inside) already forces exactly that recheck via `this.cd.detectChanges()`/`markForCheck()` in `ngOnInit`'s `loading$` subscription — so binding this in the template inside the existing `@if (sessionReady)` block is sufficient; no new subscription or effect needed. If a later change ever lets the selected bundle change *without* `sessionReady` also flipping (e.g. a live multi-bundle switch), that assumption would need revisiting — out of scope for this task.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: PASS (existing tests + 2 new ones).

- [ ] **Step 5: Add the header to the template**

```html
<!-- apps/tratt/src/app/core/pages/workbench/workbench.component.html -->
<!-- Insert immediately inside `@if (sessionReady) { <div class="workbench__right"> ... }`, before <tratt-fastbar> -->
@if (selectedBundleHeader(); as header) {
  <div class="workbench__editor-header">
    <span class="workbench__editor-header-name">{{ header.name }}</span>
    <span class="workbench__editor-header-meta">{{ header.metadata }}</span>
  </div>
}
```

- [ ] **Step 6: Style it**

```scss
// apps/tratt/src/app/core/pages/workbench/workbench.component.scss

.workbench__editor-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #d4d9e0;
}

.workbench__editor-header-name {
  font-weight: 600;
}

.workbench__editor-header-meta {
  font-size: 0.8rem;
  color: #667a90;
}
```

- [ ] **Step 7: Add the Transloco keys**

This task doesn't actually need a new translate key — `header.name`/`header.metadata` are pre-formatted data strings (a filename and a `·`-joined metadata line), not translatable UI copy. Skip this step; there is nothing to add to `en.json`/`sv.json` for Task 3. (Left here rather than silently omitted, since the plan's own "every new user-facing string gets Transloco keys" constraint could otherwise look violated — it isn't, because there is no new *label* string, only formatted data.)

- [ ] **Step 8: Manual smoke check**

`npm start`, `/workbench`, upload `example.wav`, start a session. Expected: a header line above the fastbar shows "example.wav" and its duration/sample-rate/channel/size, matching the mockup's top line.

- [ ] **Step 9: Commit**

```bash
git add apps/tratt/src/app/core/pages/workbench/
git commit -m "feat(workbench): add right-pane title/metadata header for the selected bundle"
```

---

### Task 4: Editor-switcher tab row

**Files:**
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.ts`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.html`
- Modify: `apps/tratt/src/app/core/pages/workbench/workbench.component.scss`
- Modify: `apps/tratt/src/assets/i18n/en.json`
- Modify: `apps/tratt/src/assets/i18n/sv.json`
- Test: `apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts` (extend)

**Interfaces:**
- Consumes: `editorComponents: { name: string; editor: Type<TRATTEditor>; translate: string; icon: string }[]` (`apps/tratt/src/app/editors/components.ts`, already imported), `AppStorageService.interface: string | undefined` (already used by `mountDefaultEditor()`).
- Produces: `WorkbenchComponent.activeEditorName: Signal<string | undefined>` — the currently-mounted editor's `name`, for tab highlighting. `WorkbenchComponent.changeEditor(name: string): void` gains a side effect (writes `appStorage.interface` and updates `activeEditorName`) but keeps its existing signature and existing call sites (`mountDefaultEditor()`) working unchanged.

- [ ] **Step 1: Write the failing test for persistence**

```ts
// append to apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts

describe('changeEditor persistence', () => {
  beforeEach(() => {
    component.showEditor = {
      viewContainerRef: { clear: jest.fn(), createComponent: jest.fn() },
    } as any;
  });

  it('writes the selected editor name to appStorage.interface', () => {
    component.appStorage = { interface: undefined } as any;

    component.changeEditor('Linear Editor');

    expect(component.appStorage.interface).toBe('Linear Editor');
  });

  it('updates activeEditorName so the tab row can highlight it', () => {
    component.appStorage = { interface: undefined } as any;

    component.changeEditor('Linear Editor');

    expect(component.activeEditorName()).toBe('Linear Editor');
  });

  it('disposes the previously-mounted editor before mounting the next one, on every call — not just the first', () => {
    const clearSpy = jest.fn();
    const createSpy = jest.fn();
    component.showEditor = {
      viewContainerRef: { clear: clearSpy, createComponent: createSpy },
    } as any;
    component.appStorage = { interface: undefined } as any;

    component.changeEditor('Dictaphone Editor');
    component.changeEditor('Linear Editor');
    component.changeEditor('2D-Editor');

    expect(clearSpy).toHaveBeenCalledTimes(3);
    expect(createSpy).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: FAIL — `appStorage.interface` stays `undefined`, `activeEditorName` doesn't exist.

- [ ] **Step 3: Add `activeEditorName` and close the persistence gap in `changeEditor()`**

```ts
// apps/tratt/src/app/core/pages/workbench/workbench.component.ts

// inside the class, alongside sessionReady/sessionStarting
activeEditorName = signal<string | undefined>(undefined);
```

Then edit the existing `changeEditor(name: string): void` method (currently around line 371) — replace its whole body with the same logic plus two additions (the write-through and the signal update), removing the now-stale comment above it that describes the gap this step closes:

```ts
// apps/tratt/src/app/core/pages/workbench/workbench.component.ts

changeEditor(name: string): void {
  let comp: Type<TRATTEditor> | undefined;

  if (name === undefined || name === '') {
    // fallback to last editor
    name = editorComponents[editorComponents.length - 1].name;
  }
  for (const editorComponent of editorComponents) {
    if (name === editorComponent.name) {
      comp = editorComponent.editor;
      break;
    }
  }

  if (comp === undefined) {
    console.error('ERROR editor component is undefined');
    return;
  }

  if (this.showEditor === undefined) {
    console.error('ERROR showEditor is undefined');
    return;
  }

  const viewContainerRef = this.showEditor.viewContainerRef;
  viewContainerRef.clear();
  viewContainerRef.createComponent<TRATTEditor>(comp);

  this.appStorage.interface = name;
  this.activeEditorName.set(name);
}
```

Delete the old comment block directly above the original method ("Unlike `TranscriptionComponent.changeEditor()`, this does NOT write `appStorage.interface`...") — it describes exactly the gap this step closes and would be actively misleading left in place.

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: PASS (existing tests + 3 new ones). Note: the pre-existing test `'creates the selected editor component inside the loadeditor viewContainerRef'` calls `component.changeEditor('Dictaphone Editor')` without first stubbing `component.appStorage` beyond the `beforeEach`'s `{ provide: AppStorageService, useValue: {} }` — confirm this still passes (`{}.interface = name` is a valid plain-object write) rather than assuming; if it doesn't, check what `beforeEach` actually provides for `appStorage` before changing this task's approach.

- [ ] **Step 5: Write the failing test for the tab row UI**

```ts
// append to apps/tratt/src/app/core/pages/workbench/workbench.component.spec.ts

describe('editor switcher tab row', () => {
  it('renders one tab per editorComponents entry, inside the sessionReady right pane', () => {
    component.showEditor = {
      viewContainerRef: { clear: jest.fn(), createComponent: jest.fn() },
    } as any;
    component.appStorage = { interface: undefined } as any;
    fixture.detectChanges();
    loading$.next({ status: LoadingStatus.FINISHED });
    fixture.detectChanges();

    const tabs = fixture.debugElement.queryAll(
      By.css('.workbench__editor-tab'),
    );
    expect(tabs.length).toBe(editorComponents.length);
  });

  it('clicking a tab calls changeEditor with that entry\'s name', () => {
    component.showEditor = {
      viewContainerRef: { clear: jest.fn(), createComponent: jest.fn() },
    } as any;
    component.appStorage = { interface: undefined } as any;
    const changeEditorSpy = jest.spyOn(component, 'changeEditor');
    fixture.detectChanges();
    loading$.next({ status: LoadingStatus.FINISHED });
    fixture.detectChanges();

    const tabs = fixture.debugElement.queryAll(
      By.css('.workbench__editor-tab'),
    );
    tabs[1].nativeElement.click();

    expect(changeEditorSpy).toHaveBeenCalledWith(editorComponents[1].name);
  });

  it('highlights the tab matching the auto-mounted default editor, not only after a manual click', () => {
    component.showEditor = {
      viewContainerRef: { clear: jest.fn(), createComponent: jest.fn() },
    } as any;
    component.appStorage = { interface: undefined } as any;
    (component as any).settingsService = {
      projectsettings: { interfaces: [editorComponents[2].name] },
      isTheme: jest.fn().mockReturnValue(false),
    };
    fixture.detectChanges();
    loading$.next({ status: LoadingStatus.FINISHED });
    fixture.detectChanges();

    // mountDefaultEditor() (Task 5 of the phase-1 plan) is what runs here,
    // not a click — this proves activeEditorName is set by that path too.
    expect(component.activeEditorName()).toBe(editorComponents[2].name);
    const activeTab = fixture.debugElement.query(
      By.css('.workbench__editor-tab--active'),
    );
    expect(activeTab).toBeTruthy();
    const allTabs = fixture.debugElement.queryAll(
      By.css('.workbench__editor-tab'),
    );
    expect(allTabs[2].nativeElement).toBe(activeTab.nativeElement);
  });
});
```

Confirm `By` (`from '@angular/platform-browser'`) is already imported in this spec file (it's used by the existing `recording-panel` test at line ~404) — reuse the same import rather than adding a duplicate.

- [ ] **Step 6: Run it, confirm it fails**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: FAIL — no `.workbench__editor-tab` elements exist yet.

- [ ] **Step 7: Add the tab row to the template**

```html
<!-- apps/tratt/src/app/core/pages/workbench/workbench.component.html -->
<!-- Insert directly after the `.workbench__editor-header` block from Task 3, still inside `@if (sessionReady)`, before <tratt-fastbar> -->
<div class="workbench__editor-tabs" role="tablist">
  @for (entry of editorComponentsList; track entry.name) {
    <button
      type="button"
      class="workbench__editor-tab"
      role="tab"
      [class.workbench__editor-tab--active]="activeEditorName() === entry.name"
      [attr.aria-selected]="activeEditorName() === entry.name"
      (click)="changeEditor(entry.name)"
    >
      <i [class]="entry.icon"></i>
      {{ entry.translate | transloco }}
    </button>
  }
</div>
```

Add a component field so the template can iterate the imported constant (Angular templates can't reference a module-level import directly):

```ts
// apps/tratt/src/app/core/pages/workbench/workbench.component.ts
// inside the class, alongside activeEditorName
readonly editorComponentsList = editorComponents;
```

- [ ] **Step 8: Style the tab row**

```scss
// apps/tratt/src/app/core/pages/workbench/workbench.component.scss

.workbench__editor-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem 0.75rem 0;
}

.workbench__editor-tab {
  border: none;
  background: transparent;
  padding: 0.3rem 0.6rem;
  border-radius: 4px 4px 0 0;
  font-size: 0.85rem;
  color: #667a90;
  cursor: pointer;

  i {
    margin-right: 0.25rem;
  }
}

.workbench__editor-tab--active {
  background: var(--tratt-surface-background);
  color: inherit;
  font-weight: 600;
}
```

- [ ] **Step 9: Run the tests, confirm they pass**

Run: `npx nx test tratt --testPathPattern=workbench.component.spec.ts`
Expected: PASS (all previous tests + 2 new ones).

- [ ] **Step 10: Manual smoke check — the Review Focus items**

`npm start`, `/workbench`, upload `example.wav`, start a session. Expected: a tab row (Dictaphone / Linear / TRN / 2D) renders above the fastbar, one tab highlighted matching the auto-mounted default editor. Click a different tab: the editor pane re-renders with that editor, the tab highlight moves, no console errors. Click through all four tabs in sequence (exercises repeated dispose/remount). Then: make a small edit in one editor (e.g. type in a segment), switch tabs, switch back — confirm the edit is still there (proves store-backed state survives the switch, not silently dropped). Finally, quit the session and start a new one — confirm the tab that was last active before quitting is the one auto-mounted this time (proves `appStorage.interface` persistence actually round-trips through `mountDefaultEditor()`).

- [ ] **Step 11: Commit**

```bash
git add apps/tratt/src/app/core/pages/workbench/
git commit -m "feat(workbench): add working editor-switcher tab row, fix changeEditor persistence gap"
```

## Done when (acceptance)

- Bundle-list rows render as bordered cards with a status-colored accent and pill badges (Task 1).
- "Pipeline settings" renders in the same small-caps label style as the capacity indicator (Task 2).
- The right pane shows the selected bundle's filename and duration/sample-rate/size above the fastbar (Task 3).
- A real, working editor-switcher tab row lets the user move between Dictaphone/Linear/TRN/2D editors without losing in-progress edits, with the active tab correctly highlighted on both manual clicks and auto-mount (Task 4).
- `npx nx test tratt --testPathPattern=workbench` and `npm run validate:i18n` both pass.
