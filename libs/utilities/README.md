# @tratt/utilities <a href="https://www.npmjs.com/package/@tratt/utilities"><img alt="npm" src="https://img.shields.io/npm/v/@tratt/utilities"></a>

This library offers JS functions and classes to make some parts of app development easier. This library is used by [Octra](https://github.com/IPS-LMU/octra) and Octra-Backend.

## Installation

### ESM, CJS, TS definitions & UMD (optional)

```shell
npm install --save @tratt/utilities
```

### UMD Bundle (for Vanilla JS)

You have two options to install this package und use it as UMD:

a) Install via NPM and reference local files (no internet connection needed on production).

```html
<script type="application/javascript" src="node_modules/@tratt/utilities/index.umd.js"></script>
```

b) Reference remote file (internet connection needed on production).

```html
<script type="application/javascript" src="https://unpkg.com/@tratt/utilities/index.umd.js"></script>
```

[See full example here](https://github.com/IPS-LMU/octra/blob/main/apps/web-components-demo/index.html)

## Use

### Import

#### ESM, Typescript

Import the classes and functions from `@tratt/utilities`. For example

```typescript
import { getFileSize } from '@tratt/utilities';
```

#### UMD Bundle

All functions and classes are available via global scope `OctraUtilities`. For example:

```javascript
/*
make sure that you have injected the umd bundle as described before.
 */
const bytes = 738246364782;
const sizeInMb = OctraUtilities.getFileSize(bytes);
```

### API

You can find more information about classes and functions of `@tratt/utilities` [here](https://ips-lmu.github.io/octra/modules/_octra_utilities.html).

### Changelog

[Go to changelog](https://github.com/IPS-LMU/octra/blob/main/libs/utilities/CHANGELOG.md)
