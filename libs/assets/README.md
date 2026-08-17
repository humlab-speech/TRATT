# @tratt/assets <a href="https://www.npmjs.com/package/@tratt/assets"><img alt="npm" src="https://img.shields.io/npm/v/@tratt/assets"></a>

This library contains assets like JSON schema definitions.

## Installation

### ESM, CJS, TS definitions & UMD (optional)

```shell
npm install --save @tratt/assets
```

### UMD Bundle (for Vanilla JS)

You have two options to install this package und use it as UMD:

a) Install via NPM and reference local files (no internet connection needed om production).

```html
<script type="application/javascript" src="node_modules/@tratt/assets/index.umd.js"></script>
```

b) Reference remote file (internet connection needed on production).

```html
<script type="application/javascript" src="https://unpkg.com/@tratt/assets/index.umd.js"></script>
```

[See full example here](https://github.com/IPS-LMU/octra/tree/main/apps/web-components-demo)

## Use

### Import

#### ESM, Typescript

Import the classes and functions from `@tratt/assets`. For example

```typescript
import { TrattGuidelinesJSONSchema } from '@tratt/assets';
```

#### UMD Bundle

All functions and classes are available via global scope `OctraAssets`. For example:

```javascript
/*
make sure that you have injected the umd bundle as described before.
 */
const guidelinesJSONSchema = OctraAssets.TrattGuidelinesJSONSchema;
```

### API

You can find more information about classes and functions of `@tratt/assets` [here](https://ips-lmu.github.io/octra/modules/_octra_assets.html).
