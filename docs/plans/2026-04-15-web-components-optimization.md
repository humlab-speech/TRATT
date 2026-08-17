# Web-Components Bundle Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce web-components build bundle size by 30-40% (target: ~200-300KB gzipped → ~120-180KB). Remove Angular runtime duplication, enable differential loading, strip unused Konva features, optimize AudioViewer component size.

**Architecture:** Configure Nx build to use `ngPackagr` production mode, enable Terser minification + dead code elimination, exclude unnecessary dependencies (zone.js, @angular/localize), build separate bundles for AudioViewerComponent and AudioplayerComponent, post-process with bundle analyzer to identify and remove unused code.

**Tech Stack:** Nx build optimizer, ng-packagr, Terser, webpack-bundle-analyzer, Konva optimizations.

**Rationale:** Current web-components bundle includes full Angular runtime (~150KB) per custom element. Consumers need a lightweight, self-contained waveform viewer. 10-14 dev-hours estimated.

---

## Phase 1: Baseline & Analysis

### Task 1: Measure current bundle size

**Files:**

- Read: `apps/web-components/project.json`

**Step 1: Build current version**

```bash
npm run build -- apps/web-components
```

**Step 2: Check output size**

```bash
ls -lah dist/apps/web-components/
```

Record current sizes. Expected: ~800KB-1.2MB uncompressed.

**Step 3: Gzip to see production size**

```bash
gzip -k dist/apps/web-components/*.js
ls -lh dist/apps/web-components/*.js.gz
```

Expected: ~200-300KB gzipped per bundle file. Document baseline.

**Step 4: Run bundle analyzer**

```bash
npm run analyze:web-components 2>/dev/null || npx webpack-bundle-analyzer dist/apps/web-components/main.*.js
```

Expected: Output shows Angular core + DI + zone.js as top contributors. Identify top 10 packages by size.

**Step 5: Create baseline report**

```bash
cat > docs/plans/web-components-baseline.md << 'EOF'
# Web-Components Bundle Baseline

**Date:** $(date)
**Uncompressed Size:** [record from ls -lah]
**Gzipped Size:** [record from gzip]

## Top Contributors (from webpack-bundle-analyzer):
1. @angular/core: XXX KB
2. @angular/common: XXX KB
3. zone.js: XXX KB
4. konva: XXX KB
... (rest)

## Goals
- Reduce gzipped from [current] to ~150KB
- Remove zone.js (50KB)
- Remove unused Konva plugins
- Extract common Angular into shared ESM
EOF
```

---

## Phase 2: Build Configuration Optimization

### Task 2: Update web-components build config

**Files:**

- Modify: `apps/web-components/project.json`

**Step 1: Check current build config**

```bash
cat apps/web-components/project.json | jq '.targets.build'
```

**Step 2: Enable production optimizations**

```json
{
  "targets": {
    "build": {
      "executor": "@angular-devkit/build-angular:application",
      "options": {
        "outputPath": "dist/apps/web-components",
        "index": "apps/web-components/src/index.html",
        "main": "apps/web-components/src/main.ts",
        "polyfills": ["zone.js"],
        "tsConfig": "apps/web-components/tsconfig.app.json",
        "assets": ["apps/web-components/src/favicon.ico"],
        "styles": [],
        "scripts": [],
        "vendorChunk": false,
        "extractLicenses": true,
        "namedChunks": false,
        "optimization": true,
        "sourceMap": false,
        "aot": true,
        "budgets": [
          {
            "type": "initial",
            "maximumWarning": "150kb",
            "maximumError": "200kb"
          }
        ]
      },
      "configurations": {
        "development": {
          "optimization": false,
          "sourceMap": true,
          "extractLicenses": false,
          "namedChunks": true
        },
        "production": {
          "fileReplacements": [],
          "outputHashing": "all",
          "optimization": true,
          "sourceMap": false,
          "namedChunks": false,
          "aot": true,
          "buildOptimizer": true
        }
      },
      "defaultConfiguration": "production"
    }
  }
}
```

**Step 3: Commit config change**

```bash
git add apps/web-components/project.json
git commit -m "config: enable production optimizations for web-components build"
```

---

### Task 3: Remove zone.js polyfill from web-components

**Files:**

- Modify: `apps/web-components/src/main.ts`
- Modify: `apps/web-components/tsconfig.app.json`

**Step 1: Check if zoneless change detection is compatible**

For web components, OnPush + Signals eliminate zone.js need. Review:

```bash
grep -r "zone\|Zone" apps/web-components/src/
```

**Expected:** No direct zone.js usage (Angular injects it automatically). Safe to remove.

**Step 2: Update main.ts to skip zone.js polyfill**

```typescript
// apps/web-components/src/main.ts

import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { ViewEncapsulation } from '@angular/core';

bootstrapApplication(AppComponent, {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    // Remove: provideZoneChangeDetection() — no longer needed
  ],
}).catch((err) => console.error(err));
```

**Step 3: Update polyfills in tsconfig**

In `apps/web-components/tsconfig.app.json`, remove zone.js from polyfills:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "../../dist/out-tsc",
    "types": [],
    "lib": ["DOM", "ES2022"]
  },
  "files": ["src/main.ts"],
  "include": ["src/**/*.ts"]
}
```

**Step 4: Commit**

```bash
git add apps/web-components/src/main.ts apps/web-components/tsconfig.app.json
git commit -m "perf: remove zone.js from web-components, enable zoneless change detection (~50KB saved)"
```

---

## Phase 3: Component-Specific Optimization

### Task 4: Optimize Konva usage in AudioViewerComponent

**Files:**

- Read: `libs/ngx-components/src/lib/components/audio-viewer/audio-viewer.component.ts`
- Read: `libs/ngx-components/src/lib/audio-viewer.service.ts`

**Step 1: Identify unused Konva shapes/plugins**

```bash
grep -r "Konva\." libs/ngx-components/src/lib/components/audio-viewer/ | cut -d':' -f2 | sort | uniq
```

Document which Konva classes are used (e.g., Stage, Layer, Rect, Line, Group, Shape).

**Expected:** ~8-10 Konva classes actually used. The library imports full Konva (~200KB) for a subset.

**Step 2: Create Konva import optimization**

In `audio-viewer.service.ts`, replace:

```typescript
// Before
import Konva from 'konva';

// After (tree-shakeable imports)
import { Stage, Layer, Rect, Line, Group, Shape, Animation } from 'konva/lib/index';
```

This enables tree-shaking of unused Konva plugins (pointer detection, drag-drop, etc.).

**Step 3: Update all Konva references**

```bash
sed -i 's/Konva\.Stage/Stage/g' libs/ngx-components/src/lib/audio-viewer.service.ts
sed -i 's/Konva\.Layer/Layer/g' libs/ngx-components/src/lib/audio-viewer.service.ts
sed -i 's/Konva\.Rect/Rect/g' libs/ngx-components/src/lib/audio-viewer.service.ts
# ... (repeat for all classes)
```

Or manually update key files.

**Step 4: Test build**

```bash
npm run build:libs -- libs/ngx-components
```

**Expected:** No errors, bundle size slightly reduced.

**Step 5: Commit**

```bash
git add libs/ngx-components/src/lib/audio-viewer.service.ts libs/ngx-components/src/lib/components/audio-viewer/
git commit -m "perf: tree-shake unused Konva plugins (~30-50KB saved)"
```

---

### Task 5: Strip ViewEncapsulation.ShadowDom if not strictly needed

**Files:**

- Read: `libs/ngx-components/src/lib/components/audio-viewer/audio-viewer.component.ts`
- Read: `libs/ngx-components/src/lib/components/audio-player/audio-player.component.ts`

**Step 1: Check ShadowDom usage**

```bash
grep -n "ViewEncapsulation.ShadowDom" libs/ngx-components/src/lib/components/audio-viewer/audio-viewer.component.ts
```

**Step 2: If ShadowDom is present but not critical for isolation:**

Shadow DOM adds a small runtime overhead. If the component's CSS can coexist with host app styles, consider removing:

```typescript
// Before
@Component({
  selector: 'octra-audio-viewer',
  templateUrl: './audio-viewer.component.html',
  styleUrls: ['./audio-viewer.component.css'],
  encapsulation: ViewEncapsulation.ShadowDom  // <-- Remove if feasible
})

// After
@Component({
  selector: 'octra-audio-viewer',
  templateUrl: './audio-viewer.component.html',
  styleUrls: ['./audio-viewer.component.css'],
  encapsulation: ViewEncapsulation.Emulated  // <-- Use Emulated (default) instead
})
```

**Step 3: Test in web-components-demo**

```bash
npm run start -- apps/web-components-demo
# Open browser, verify AudioViewer still renders correctly without shadow boundary
```

**Step 4: Commit (if change is safe)**

```bash
git add libs/ngx-components/src/lib/components/audio-viewer/audio-viewer.component.ts
git commit -m "perf: use ViewEncapsulation.Emulated for audio-viewer, remove ShadowDom overhead"
```

---

## Phase 4: Post-Build Optimization

### Task 6: Configure custom post-processor for web-components output

**Files:**

- Create: `scripts/optimize-web-components.js` (or update existing `prepare_web-components.js`)

**Step 1: Create or update post-processor**

```javascript
// scripts/optimize-web-components.js

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const distDir = 'dist/apps/web-components';

async function optimizeBundle() {
  const files = fs.readdirSync(distDir).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(distDir, file);
    const code = fs.readFileSync(filePath, 'utf-8');

    console.log(`Optimizing ${file}...`);

    // Remove unused Angular modules
    let optimized = code.replace(/import\s*{[^}]*}\s*from\s*["']@angular\/localize["'];?/g, '').replace(/import\s*["']zone\.js["'];?/g, '');

    // Minify if not already
    if (!file.includes('.min.')) {
      try {
        const minified = await minify(optimized, {
          compress: {
            drop_console: true,
            passes: 2,
          },
          mangle: true,
          output: { comments: false },
        });
        optimized = minified.code;
      } catch (e) {
        console.error(`Minify error in ${file}:`, e);
      }
    }

    fs.writeFileSync(filePath, optimized, 'utf-8');

    const before = Buffer.byteLength(code, 'utf-8');
    const after = Buffer.byteLength(optimized, 'utf-8');
    console.log(`  ${file}: ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB`);
  }

  console.log('\nOptimization complete.');
}

optimizeBundle().catch((err) => {
  console.error('Optimization failed:', err);
  process.exit(1);
});
```

**Step 2: Add npm script**

Update `package.json`:

```json
{
  "scripts": {
    "build:web-components": "nx run apps/web-components:build && node scripts/optimize-web-components.js"
  }
}
```

**Step 3: Test**

```bash
npm run build:web-components
```

**Expected:** Optimization script runs after build, removes dead code, compresses further.

**Step 4: Commit**

```bash
git add scripts/optimize-web-components.js package.json
git commit -m "build: add post-processor for web-components bundle optimization"
```

---

## Phase 5: Split Components into Separate Bundles

### Task 7: Create separate entrypoints for AudioViewer and Audioplayer

**Files:**

- Create: `apps/web-components/src/viewer.ts`
- Create: `apps/web-components/src/player.ts`
- Modify: `apps/web-components/project.json`

**Step 1: Create viewer entrypoint**

```typescript
// apps/web-components/src/viewer.ts

import { createCustomElement } from '@angular/elements';
import { Injector } from '@angular/core';
import { AudioViewerComponent } from '@tratt/ngx-components';

export function registerAudioViewer(injector: Injector) {
  const viewerElement = createCustomElement(AudioViewerComponent, { injector });
  customElements.define('octra-audio-viewer', viewerElement);
}
```

**Step 2: Create player entrypoint**

```typescript
// apps/web-components/src/player.ts

import { createCustomElement } from '@angular/elements';
import { Injector } from '@angular/core';
import { AudioplayerComponent } from '@tratt/ngx-components';

export function registerAudioPlayer(injector: Injector) {
  const playerElement = createCustomElement(AudioplayerComponent, { injector });
  customElements.define('octra-audio-player', playerElement);
}
```

**Step 3: Create separate build configurations in project.json**

```json
{
  "targets": {
    "build:viewer": {
      "executor": "@angular-devkit/build-angular:application",
      "options": {
        "main": "apps/web-components/src/viewer.ts",
        "outputPath": "dist/apps/web-components/viewer"
      }
    },
    "build:player": {
      "executor": "@angular-devkit/build-angular:application",
      "options": {
        "main": "apps/web-components/src/player.ts",
        "outputPath": "dist/apps/web-components/player"
      }
    }
  }
}
```

**Step 4: Create shared Angular bundle**

Add a shared entrypoint that both import from:

```typescript
// apps/web-components/src/shared-runtime.ts

// This imports Angular runtime once; imported by both viewer.ts and player.ts
import '@angular/core';
import '@angular/common';
```

Both viewer/player bundles will share this runtime chunk, reducing duplication.

**Step 5: Test separate builds**

```bash
npm run build:web-components:viewer
npm run build:web-components:player
ls -lh dist/apps/web-components/viewer/
ls -lh dist/apps/web-components/player/
```

**Expected:** Two separate bundles, each smaller than monolithic build. Total size (viewer + player) < monolithic due to shared chunk.

**Step 6: Commit**

```bash
git add apps/web-components/src/viewer.ts apps/web-components/src/player.ts apps/web-components/project.json
git commit -m "refactor: split web-components into separate viewer and player bundles with shared runtime"
```

---

## Phase 6: Final Validation

### Task 8: Measure final bundle sizes

**Run:**

```bash
npm run build:web-components
```

**Step 1: Compare sizes**

```bash
echo "=== Final Sizes ==="
gzip -k dist/apps/web-components/*.js
ls -lh dist/apps/web-components/*.js.gz
du -sh dist/apps/web-components/
```

**Step 2: Calculate savings**

```bash
# Baseline from Task 1
baseline_gzip_size=XXX # (from earlier measurement, e.g., 250KB)

# Final size
final_gzip_size=$(ls -lh dist/apps/web-components/*.js.gz | awk '{print $5}')

# Calculate percent saved
echo "Savings: $(((baseline_gzip_size - final_gzip_size) / baseline_gzip_size * 100))%"
```

**Expected:** 30-40% reduction. If < 25%, review optimization checklist:

- [ ] zone.js removed (50KB)
- [ ] Konva tree-shaking enabled (~30KB)
- [ ] ViewEncapsulation.ShadowDom replaced (~5KB)
- [ ] Separate bundles with shared runtime (~20KB)

**Step 3: Run bundle analyzer on final build**

```bash
npx webpack-bundle-analyzer dist/apps/web-components/main.*.js
```

**Step 4: Update baseline report**

```bash
cat >> docs/plans/web-components-baseline.md << 'EOF'

## Final Optimization Results

**Date:** $(date)
**Final Gzipped Size:** [record]
**Savings:** [calculate percent]
**Top Contributors After:**
[list from analyzer]

## Recommendations for Next Optimization
[if > 30% not achieved, list remaining targets]
EOF
```

**Step 5: Full test**

```bash
npm test -- apps/web-components --watch=false
npm run start -- apps/web-components-demo  # Manual visual test
```

**Expected:** All tests pass, demo renders correctly.

**Step 6: Final commit**

```bash
git add docs/plans/web-components-baseline.md dist/apps/web-components/
git commit -m "perf: web-components bundle optimized from XXXkb to XXXkb gzipped (Y% reduction)"
```

---

## Success Criteria

| Target                                | Status |
| ------------------------------------- | ------ |
| Gzipped size < 180KB                  | [ ]    |
| zone.js removed                       | [ ]    |
| Separate viewer/player bundles        | [ ]    |
| Konva tree-shaken                     | [ ]    |
| All tests pass                        | [ ]    |
| Web-components-demo renders correctly | [ ]    |

---

## Rollback Plan

If optimization breaks functionality:

```bash
git revert <commit-hash>  # Revert back to last working build
npm run build:web-components
```

All changes are in build config and non-breaking, so rollback is safe.

---

## Execution Paths

**Plan saved to `docs/plans/2026-04-15-web-components-optimization.md`**

Two execution options:

**1. Subagent-Driven (this session)** — Fresh subagent per task, code review between tasks

**2. Parallel Session (separate)** — Open new session with superpowers:executing-plans, batch execution with checkpoints

Which approach?
