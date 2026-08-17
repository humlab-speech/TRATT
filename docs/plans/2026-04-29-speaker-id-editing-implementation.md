# Speaker ID Editing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add speaker ID management — navbar rename dropdown, colored badges in the popup editor (click-to-cycle), and colored canvas labels at boundaries in both waveform editors (click-to-cycle).

**Architecture:** Pure derivation — speaker IDs and colors computed from existing `Speaker` annotation labels on each `OctraAnnotationSegment`. Pure helper functions live in `libs/ngx-components` so both the app and the canvas service can import them. The app-level `SpeakerManagementService` wraps these helpers and dispatches to the NgRx store. The `AudioViewerService` calls the helpers directly when drawing Konva labels.

**Tech Stack:** Angular 19, NgRx, Konva.js (via audio-viewer.service.ts), NgBootstrap dropdowns, `@tratt/annotation` types (`OctraAnnotation`, `OctraAnnotationSegment`, `AnnotationLevelType`, `OLabel`)

**Design reference:** `docs/plans/2026-04-29-speaker-id-editing-design.md`

---

## Background: Key Types and Patterns

### Speaker label storage

Each `OctraAnnotationSegment` carries a `labels: OLabel[]` array. Speaker ID is stored as `OLabel { name: 'Speaker', value: 'Speaker 1' }`. Transcript text is the label whose `name` is NOT `'Speaker'`.

- `segment.getLabel('Speaker')` → finds label by name
- `segment.changeLabel('Speaker', newValue)` → immutable update (returns nothing, mutates — see implementation)
- `segment.getFirstLabelWithoutName('Speaker')` → transcript text label

### Boundary vs segment in the viewer

The canvas draws a **boundary line** at each segment's `time` (= the segment END). The speaker to show at that boundary is the **next** segment (index + 1) — because the boundary marks the START of the next utterance. The first segment has no boundary before it (starts at 0) and gets no canvas label.

### Dispatch patterns used elsewhere

- Rename all segments: `this.annotationStoreService.overwriteTranscript(clonedAnnotation)` (full replace, persists to IDB)
- Update current level items: `this.annotationStoreService.changeCurrentLevelItems(items)`

### Settings access pattern in editors

Editors (2D, Linear) access the viewer's config directly after `ngAfterViewInit`:

```typescript
this.viewer.settings.multiLine = true;
this.viewer.settings.showTranscripts = true;
```

Settings are the `AudioviewerConfig` instance; no `@Input` binding needed.

### Navbar tier dropdown pattern (to mirror for speakers)

Located in `apps/octra/src/app/core/component/navbar/navbar.component.html` lines 161–249.
Uses `ngbDropdown`, renders `@for (level of annotationStoreService.transcript!.levels; ...)`.
`onLevelNameLeave(event, i)` calls `this.annotationStoreService.changeLevelName(i, event.target.value)`.

---

## Task 1: Speaker color pure helpers in libs/ngx-components

**Files:**

- Create: `libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.ts`
- Create: `libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.spec.ts`
- Modify: `libs/ngx-components/src/lib/index.ts` (or wherever the lib's public API is exported)

### Step 1: Write the failing tests

Create `libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.spec.ts`:

```typescript
import { describe, expect, it } from '@jest/globals';
import { BEIGE_TEXT, BLACK_TEXT, SPEAKER_COLORS, cycleNextSpeaker, getSpeakerColor, getSpeakerIds, getSpeakerTextColor, renameSpeakerInAnnotation } from './speaker-colors';
import { AnnotationLevelType, OctraAnnotation, OctraAnnotationSegment, OctraAnnotationSegmentLevel } from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';

function makeAnnotation(speakerValues: (string | undefined)[]): OctraAnnotation<any, OctraAnnotationSegment> {
  const annotation = new OctraAnnotation<any, OctraAnnotationSegment>();
  const items = speakerValues.map((spk, i) => {
    const seg = new OctraAnnotationSegment<any>(i + 1, new SampleUnit((i + 1) * 16000, 16000));
    seg.changeLabel('Transcript', 'hello');
    if (spk) {
      seg.labels.push({ name: 'Speaker', value: spk });
    }
    return seg;
  });
  annotation.addSegmentLevel('Transcript', items);
  return annotation;
}

describe('SPEAKER_COLORS', () => {
  it('has 17 entries', () => {
    expect(SPEAKER_COLORS).toHaveLength(17);
  });
});

describe('getSpeakerIds', () => {
  it('returns sorted unique non-empty Speaker label values', () => {
    const ann = makeAnnotation(['Speaker 2', 'Speaker 1', 'Speaker 2', undefined, '']);
    expect(getSpeakerIds(ann)).toEqual(['Speaker 1', 'Speaker 2']);
  });

  it('returns empty array when no speakers', () => {
    const ann = makeAnnotation([undefined, undefined]);
    expect(getSpeakerIds(ann)).toEqual([]);
  });
});

describe('getSpeakerColor', () => {
  it('returns the color at sorted index position', () => {
    const ids = ['B', 'A', 'C'];
    // sorted: A=0, B=1, C=2
    expect(getSpeakerColor('A', ids)).toBe(SPEAKER_COLORS[0]);
    expect(getSpeakerColor('B', ids)).toBe(SPEAKER_COLORS[1]);
    expect(getSpeakerColor('C', ids)).toBe(SPEAKER_COLORS[2]);
  });

  it('wraps colors via modulo when more than 17 speakers', () => {
    const ids = Array.from({ length: 18 }, (_, i) => `Speaker ${i + 1}`);
    expect(getSpeakerColor('Speaker 18', ids)).toBe(SPEAKER_COLORS[17 % 17]);
  });

  it('returns first color for unknown id (fallback)', () => {
    expect(getSpeakerColor('Unknown', ['A', 'B'])).toBe(SPEAKER_COLORS[0]);
  });
});

describe('getSpeakerTextColor', () => {
  it('returns beige for dark backgrounds', () => {
    expect(getSpeakerTextColor('#000000')).toBe(BEIGE_TEXT); // black
    expect(getSpeakerTextColor('#2A4765')).toBe(BEIGE_TEXT); // dark blue
    expect(getSpeakerTextColor('#3D6B5C')).toBe(BEIGE_TEXT); // dark forest
  });

  it('returns black for light backgrounds', () => {
    expect(getSpeakerTextColor('#C4D4C0')).toBe(BLACK_TEXT); // light sage
    expect(getSpeakerTextColor('#EABAB9')).toBe(BLACK_TEXT); // pink
    expect(getSpeakerTextColor('#D4C7B5')).toBe(BLACK_TEXT); // oat milk
  });
});

describe('cycleNextSpeaker', () => {
  it('returns the next speaker in sorted order', () => {
    const ids = ['Speaker 1', 'Speaker 2', 'Speaker 3'];
    expect(cycleNextSpeaker('Speaker 1', ids)).toBe('Speaker 2');
    expect(cycleNextSpeaker('Speaker 2', ids)).toBe('Speaker 3');
  });

  it('wraps from last back to first', () => {
    const ids = ['Speaker 1', 'Speaker 2'];
    expect(cycleNextSpeaker('Speaker 2', ids)).toBe('Speaker 1');
  });

  it('returns first speaker if current not found', () => {
    const ids = ['Speaker 1', 'Speaker 2'];
    expect(cycleNextSpeaker('Unknown', ids)).toBe('Speaker 1');
  });
});

describe('renameSpeakerInAnnotation', () => {
  it('renames all Speaker labels with matching value across all levels', () => {
    const ann = makeAnnotation(['Speaker 1', 'Speaker 2', 'Speaker 1']);
    const renamed = renameSpeakerInAnnotation('Speaker 1', 'Alice', ann);
    const ids = getSpeakerIds(renamed);
    expect(ids).toContain('Alice');
    expect(ids).not.toContain('Speaker 1');
    expect(ids).toContain('Speaker 2');
  });

  it('does not mutate the original annotation', () => {
    const ann = makeAnnotation(['Speaker 1', 'Speaker 2']);
    renameSpeakerInAnnotation('Speaker 1', 'Alice', ann);
    expect(getSpeakerIds(ann)).toContain('Speaker 1');
  });

  it('is a no-op if oldId does not exist', () => {
    const ann = makeAnnotation(['Speaker 1']);
    const renamed = renameSpeakerInAnnotation('Ghost', 'Alice', ann);
    expect(getSpeakerIds(renamed)).toEqual(['Speaker 1']);
  });
});
```

### Step 2: Run tests to verify they fail

```bash
npx nx test octra-ngx-components --testFile=libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.spec.ts
```

Expected: FAIL — module not found.

### Step 3: Implement speaker-colors.ts

Create `libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.ts`:

```typescript
import { AnnotationLevelType, OctraAnnotation, OctraAnnotationSegment } from '@tratt/annotation';

export const SPEAKER_COLORS: readonly string[] = ['#2A4765', '#4A5E7A', '#A8C3D4', '#3D6B5C', '#73A790', '#C4D4C0', '#5B8E8A', '#D7B17C', '#C2A08A', '#B87D5E', '#C9918A', '#EABAB9', '#9C7A8C', '#6B5B6E', '#8B8FAE', '#D4C7B5', '#000000'];

export const BEIGE_TEXT = '#F1EFE4';
export const BLACK_TEXT = '#000000';

export function getSpeakerIds(annotation: OctraAnnotation<any, OctraAnnotationSegment>): string[] {
  const ids = new Set<string>();
  for (const level of annotation.levels) {
    if (level.type !== AnnotationLevelType.SEGMENT) continue;
    for (const item of level.items as OctraAnnotationSegment[]) {
      const spk = item.getLabel('Speaker')?.value;
      if (spk) ids.add(spk);
    }
  }
  return [...ids].sort();
}

export function getSpeakerColor(speakerId: string, allIds: string[]): string {
  const sorted = [...allIds].sort();
  const index = sorted.indexOf(speakerId);
  const safeIndex = index < 0 ? 0 : index;
  return SPEAKER_COLORS[safeIndex % SPEAKER_COLORS.length];
}

export function getSpeakerTextColor(bgHex: string): string {
  const r = parseInt(bgHex.slice(1, 3), 16) / 255;
  const g = parseInt(bgHex.slice(3, 5), 16) / 255;
  const b = parseInt(bgHex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L < 0.179 ? BEIGE_TEXT : BLACK_TEXT;
}

export function cycleNextSpeaker(currentId: string, allIds: string[]): string {
  const sorted = [...allIds].sort();
  if (sorted.length === 0) return currentId;
  const index = sorted.indexOf(currentId);
  if (index < 0) return sorted[0];
  return sorted[(index + 1) % sorted.length];
}

export function renameSpeakerInAnnotation(oldId: string, newId: string, annotation: OctraAnnotation<any, OctraAnnotationSegment>): OctraAnnotation<any, OctraAnnotationSegment> {
  const cloned = annotation.clone() as OctraAnnotation<any, OctraAnnotationSegment>;
  for (const level of cloned.levels) {
    if (level.type !== AnnotationLevelType.SEGMENT) continue;
    for (const item of level.items as OctraAnnotationSegment[]) {
      if (item.getLabel('Speaker')?.value === oldId) {
        item.changeLabel('Speaker', newId);
      }
    }
  }
  return cloned;
}
```

### Step 4: Export from library public API

Find the lib's barrel file. Check `libs/ngx-components/src/lib/index.ts` or `libs/ngx-components/src/index.ts`. Add:

```typescript
export * from './lib/components/audio/audio-viewer/speaker-colors';
```

### Step 5: Run tests to verify they pass

```bash
npx nx test octra-ngx-components --testFile=libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.spec.ts
```

Expected: all PASS.

### Step 6: Commit

```bash
git add libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.ts \
        libs/ngx-components/src/lib/components/audio/audio-viewer/speaker-colors.spec.ts \
        libs/ngx-components/src/index.ts
git commit -m "feat(speaker-colors): add pure speaker color utilities to ngx-components"
```

---

## Task 2: SpeakerManagementService in the app

**Files:**

- Create: `apps/octra/src/app/core/shared/service/speaker-management.service.ts`
- Modify: `apps/octra/src/app/core/shared/service/index.ts` (add export)

### Step 1: Create the service

```typescript
// apps/octra/src/app/core/shared/service/speaker-management.service.ts
import { Injectable, inject } from '@angular/core';
import { OctraAnnotationSegment } from '@tratt/annotation';
import { cycleNextSpeaker, getSpeakerColor, getSpeakerIds, getSpeakerTextColor, renameSpeakerInAnnotation } from '@tratt/ngx-components';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';

@Injectable({ providedIn: 'root' })
export class SpeakerManagementService {
  private annotationStore = inject(AnnotationStoreService);

  getSpeakerIds(): string[] {
    const t = this.annotationStore.transcript;
    return t ? getSpeakerIds(t) : [];
  }

  getColor(speakerId: string): string {
    return getSpeakerColor(speakerId, this.getSpeakerIds());
  }

  getTextColor(bgHex: string): string {
    return getSpeakerTextColor(bgHex);
  }

  cycleNext(currentId: string): string {
    return cycleNextSpeaker(currentId, this.getSpeakerIds());
  }

  rename(oldId: string, newId: string): void {
    const t = this.annotationStore.transcript;
    if (!t || !newId.trim() || newId === oldId) return;
    const renamed = renameSpeakerInAnnotation(oldId, newId.trim(), t);
    this.annotationStore.overwriteTranscript(renamed);
  }

  cycleSpeakerOnSegment(segmentId: number): void {
    const level = this.annotationStore.currentLevel;
    if (!level) return;
    const segment = level.items.find((s) => s.id === segmentId) as OctraAnnotationSegment | undefined;
    if (!segment) return;
    const current = segment.getLabel('Speaker')?.value ?? '';
    const next = this.cycleNext(current);
    segment.changeLabel('Speaker', next);
    this.annotationStore.changeCurrentLevelItems([...level.items] as OctraAnnotationSegment[]);
  }
}
```

### Step 2: Export from service index

In `apps/octra/src/app/core/shared/service/index.ts` add:

```typescript
export * from './speaker-management.service';
```

### Step 3: Verify it compiles

```bash
npx nx build octra --skip-nx-cache 2>&1 | grep -i error | head -20
```

Expected: no type errors related to the new service.

### Step 4: Commit

```bash
git add apps/octra/src/app/core/shared/service/speaker-management.service.ts \
        apps/octra/src/app/core/shared/service/index.ts
git commit -m "feat(speaker-management): add SpeakerManagementService"
```

---

## Task 3: Navbar speaker dropdown

**Files:**

- Modify: `apps/octra/src/app/core/component/navbar/navbar.component.ts`
- Modify: `apps/octra/src/app/core/component/navbar/navbar.component.html`

### Step 1: Add logic to navbar.component.ts

Import `SpeakerManagementService` at the top of the file:

```typescript
import { SpeakerManagementService } from '../../shared/service';
```

Inject it in the class body (alongside existing injected services):

```typescript
readonly speakerService = inject(SpeakerManagementService);
```

Add two getters and a handler after the existing `onLevelNameLeave` method:

```typescript
get speakerIds(): string[] {
  return this.speakerService.getSpeakerIds();
}

get hasSpeakers(): boolean {
  return this.speakerIds.length > 0;
}

onSpeakerNameLeave(event: Event, oldId: string): void {
  const newId = (event.target as HTMLInputElement).value;
  this.speakerService.rename(oldId, newId);
}
```

### Step 2: Add the dropdown to navbar.component.html

Locate the closing `</ul>` of the `<ul class="navbar-nav">` block that contains the tier dropdown (around line 290 in the navbar HTML — it's the nav-item block with `tiersDropdown` comment).

Add the speaker dropdown as an additional `<li>` inside that same `<ul>` block, directly after the tier dropdown `<li>`:

```html
@if (hasSpeakers) {
<li
  class="nav-item dropdown"
  [ngStyle]="{
      display:
        !appStorage.loggedIn ||
        appStorage.onlineSession?.currentProject === undefined ||
        !appStorage.audioLoaded
          ? 'none'
          : 'inherit',
    }"
  ngbDropdown
  placement="bottom-left"
>
  <a ngbDropdownToggle type="button" class="nav-link dropdown-toggle">
    <i class="bi bi-people-fill me-1"></i>
    <span class="d-inline d-md-none mt-2">Speakers</span>
  </a>
  <div ngbDropdownMenu class="dropdown-menu dropdown dropdown-primary dropdown-menu-right rounded rounded-3 py-0" role="menu" style="min-width: 280px" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" (keydown.space)="$event.stopPropagation()" tabindex="0">
    <table class="w-100">
      <tbody>
        @for (spk of speakerIds; track spk; let i = $index) {
        <tr [ngClass]="{ last: i === speakerIds.length - 1 }" class="level-row">
          <td style="width: 28px; padding: 6px 4px 6px 8px;">
            <span style="display: inline-block; width: 16px; height: 16px; border-radius: 3px; vertical-align: middle;" [style.background-color]="speakerService.getColor(spk)"></span>
          </td>
          <td style="padding: 2px 8px 2px 0;">
            <input (blur)="onSpeakerNameLeave($event, spk)" maxlength="100" type="text" [value]="spk" style="width: 100%" />
          </td>
        </tr>
        }
      </tbody>
    </table>
  </div>
</li>
}
```

### Step 3: Verify it compiles and renders

```bash
npm start
```

Open browser at http://localhost:5321. Load a file with speaker diarization. Verify the Speakers dropdown appears in the navbar next to the tier dropdown, showing color swatches. Rename a speaker and verify all segments update.

### Step 4: Commit

```bash
git add apps/octra/src/app/core/component/navbar/navbar.component.ts \
        apps/octra/src/app/core/component/navbar/navbar.component.html
git commit -m "feat(navbar): add speaker ID rename dropdown"
```

---

## Task 4: Colored badge + click-to-cycle in popup editor

**Files:**

- Modify: `apps/octra/src/app/editors/2D-editor/transcr-window/transcr-window.component.ts`
- Modify: `apps/octra/src/app/editors/2D-editor/transcr-window/transcr-window.component.html`
- Modify: `apps/octra/src/app/editors/2D-editor/transcr-window/transcr-window.component.scss`

### Step 1: Add service and computed properties to transcr-window.component.ts

Import at the top:

```typescript
import { SpeakerManagementService } from '../../../core/shared/service';
```

Inject alongside existing services in the class body:

```typescript
readonly speakerService = inject(SpeakerManagementService);
```

Add computed getters after the existing `currentSegmentSpeaker` getter (around line 201):

```typescript
get currentSpeakerColor(): string | null {
  const spk = this.currentSegmentSpeaker;
  return spk ? this.speakerService.getColor(spk) : null;
}

get currentSpeakerTextColor(): string {
  const bg = this.currentSpeakerColor;
  return bg ? this.speakerService.getTextColor(bg) : '#000000';
}
```

Add the cycle method:

```typescript
cycleSpeaker(): void {
  const level = this.annotationStoreService.currentLevel;
  if (!level || this.selectedIndex < 0) return;
  const segment = level.items[this.selectedIndex] as OctraAnnotationSegment;
  const current = segment.getLabel('Speaker')?.value ?? '';
  const next = this.speakerService.cycleNext(current);
  segment.changeLabel('Speaker', next);
  this.annotationStoreService.changeCurrentLevelItems([...level.items] as OctraAnnotationSegment[]);
  this.cd.markForCheck();
}
```

(`cd` is `ChangeDetectorRef` — check the existing imports; it's already injected as `this.cd`.)

### Step 2: Update transcr-window.component.html

Find the existing speaker badge block (around line 149):

```html
@if (currentSegmentSpeaker) {
<div class="speaker-badge">{{ currentSegmentSpeaker }}</div>
}
```

Replace with:

```html
@if (currentSegmentSpeaker) {
<div class="speaker-badge" [style.background-color]="currentSpeakerColor" [style.color]="currentSpeakerTextColor" (click)="cycleSpeaker()" title="Click to cycle speaker">{{ currentSegmentSpeaker }}</div>
}
```

### Step 3: Update transcr-window.component.scss

Find the `.speaker-badge` rule and add:

```scss
.speaker-badge {
  cursor: pointer;
  user-select: none;
  // keep any existing rules
}
```

### Step 4: Verify in browser

Open a segment with a speaker label. Verify badge shows correct color. Click the badge and verify it cycles to next speaker.

### Step 5: Commit

```bash
git add apps/octra/src/app/editors/2D-editor/transcr-window/transcr-window.component.ts \
        apps/octra/src/app/editors/2D-editor/transcr-window/transcr-window.component.html \
        apps/octra/src/app/editors/2D-editor/transcr-window/transcr-window.component.scss
git commit -m "feat(transcr-window): colored speaker badge with click-to-cycle"
```

---

## Task 5: Canvas speaker labels in audio-viewer.service.ts

**Files:**

- Modify: `libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts`

### Background

The boundary-drawing loop is at approximately line 1561:

```typescript
for (const boundary of boundariesToDraw) {
  const h = this.settings.lineheight;
  // ... creates a Konva Line for the boundary ...
  boundaryRoot.add(boundaryObj);
}
```

Each `boundary` object has:

- `boundary.id` — the id of the segment **ending** at this boundary
- `boundary.x` — canvas x position
- `boundary.y` — canvas y position (top of the line)

The segment that **starts** at this boundary is the one AFTER the segment with `boundary.id`. Segments are in the current level's `items` array.

### Step 1: Import speaker color helpers at the top of audio-viewer.service.ts

Add to existing imports (they're in the same lib so import by relative path):

```typescript
import { cycleNextSpeaker, getSpeakerColor, getSpeakerIds, getSpeakerTextColor } from './speaker-colors';
```

### Step 2: Add speaker label drawing inside the boundary loop

After `boundaryRoot.add(boundaryObj);` (inside the `for (const boundary of boundariesToDraw)` loop), add:

```typescript
// Draw speaker label for the segment that starts at this boundary
const allSegments = (this.currentLevel?.items ?? []) as OctraAnnotationSegment[];
const boundarySegIndex = allSegments.findIndex((s) => s.id === boundary.id);
const nextSeg = allSegments[boundarySegIndex + 1];
const speakerId = nextSeg?.getLabel('Speaker')?.value;

if (speakerId) {
  // Remove existing label if present (e.g. on redraw)
  const existingLabel = boundaryRoot.findOne(`#speaker_label_${boundary.id}`);
  if (existingLabel) existingLabel.destroy();

  const allIds = getSpeakerIds(this.annotation!);
  const bgColor = getSpeakerColor(speakerId, allIds);
  const textColor = getSpeakerTextColor(bgColor);

  const labelGroup = new Group({
    id: `speaker_label_${boundary.id}`,
    x: boundary.x + 4,
    y: boundary.y,
  });

  const labelText = new KonvaText({
    text: speakerId,
    fontSize: 10,
    fill: textColor,
    x: 3,
    y: 3,
  });
  const textWidth = labelText.width();
  const textHeight = labelText.height();

  const labelRect = new Rect({
    width: textWidth + 6,
    height: textHeight + 6,
    fill: bgColor,
    cornerRadius: 2,
  });

  labelGroup.add(labelRect);
  labelGroup.add(labelText);

  labelGroup.on('click tap', () => {
    if (!nextSeg) return;
    const currentIds = getSpeakerIds(this.annotation!);
    const next = cycleNextSpeaker(speakerId, currentIds);
    nextSeg.changeLabel('Speaker', next);
    this.currentLevelChange.emit({
      type: 'change',
      items: [...allSegments],
    });
    this.redraw();
  });

  boundaryRoot.add(labelGroup);
}
```

### Step 3: Add Konva imports if missing

Check the top of `audio-viewer.service.ts` for existing Konva imports. Add `Group`, `Rect`, and `Text as KonvaText` if they are not already imported:

```typescript
import Konva from 'konva';
const { Group, Rect, Text: KonvaText, Line } = Konva;
```

(Examine the existing import style in the file — it may already import individual Konva classes. Match the existing pattern.)

### Step 4: Check the currentLevelChange emit signature

Look at how `currentLevelChange.emit(...)` is called elsewhere in the file (e.g. line 2070, 2141). Match the exact object shape — it may be `{ type, items }` or a different structure.

### Step 5: Verify in browser

Load a file with speaker diarization. Verify small colored labels appear to the right of each boundary line in the 2D editor. Click a label and verify the speaker cycles. Repeat in Linear editor.

### Step 6: Commit

```bash
git add libs/ngx-components/src/lib/components/audio/audio-viewer/audio-viewer.service.ts
git commit -m "feat(audio-viewer): draw speaker ID labels at boundaries with click-to-cycle"
```

---

## Task 6: Final type-check and lint pass

### Step 1: Run lint

```bash
npm run lint 2>&1 | grep -E "error|warning" | head -30
```

Fix any errors. Warnings about unused imports or missing types in the files we touched.

### Step 2: Run tests

```bash
npm test 2>&1 | tail -30
```

Expected: all existing tests pass, new speaker-colors tests pass.

### Step 3: Build check

```bash
npm run build 2>&1 | grep -i error | head -20
```

Expected: clean build.

### Step 4: Commit any fixes

```bash
git add -p
git commit -m "fix(speaker-id): resolve lint and type errors"
```

---

## Verification Checklist

- [ ] Speaker dropdown appears in navbar when annotation has Speaker labels
- [ ] Renaming a speaker in navbar updates all segments with that label
- [ ] Renaming to same name or empty string is a no-op
- [ ] Color swatches in navbar match colors shown on canvas labels
- [ ] Speaker badge in popup editor shows correct background/text color contrast
- [ ] Clicking badge in popup cycles speaker to next (wraps around)
- [ ] Small colored labels appear to the right of boundary lines in 2D editor
- [ ] Small colored labels appear in Linear editor
- [ ] Clicking canvas label cycles speaker and label updates immediately
- [ ] No console errors in any of the above flows
- [ ] `npm run lint` clean
- [ ] `npm test` passing
