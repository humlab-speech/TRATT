# @tratt/annotation <a href="https://www.npmjs.com/package/@tratt/annotation"><img alt="npm" src="https://img.shields.io/npm/v/@tratt/annotation"></a>

This library offers all annotation related classes and functions used by Octra. It uses AnnotJSON file format as base
model. Here you can also find all Annotation converters used by [Octra](https://github.com/IPS-LMU/octra).

## Installation

### ESM, CJS, TS definitions & UMD (optional)

```shell
npm install --save @tratt/annotation
```

### UMD Bundle (for Vanilla JS)

You have two options to install this package und use it as UMD:

a) Install via NPM and reference local files (no internet connection needed om production).

```html
<script type="application/javascript" src="node_modules/@tratt/annotation/index.umd.js"></script>
```

b) Reference remote file (internet connection needed on production).

```html
<script type="application/javascript" src="https://unpkg.com/@tratt/annotation/index.umd.js"></script>
```

[See full example here](https://github.com/IPS-LMU/octra/blob/main/apps/web-components-demo/index.html)

## Use

### Import

#### ESM, Typescript

Import the classes and functions from `@tratt/annotation`. For example

```typescript
import { Level } from '@tratt/annotation';

const annotation = new TrattAnnotation();
const level = annotation.addLevel(new TrattAnnotation.createSegmentLevel('OCTRA_1'));
annotation.addItemToCurrentLevel(new SampleUnit(123456, 22050), [new OLabel('OCTRA_1', 'hello world')]);
```

#### UMD Bundle

All functions and classes are available via global scope `TrattAnnotation`. For example:

```javascript
/*
make sure that you have injected the umd bundle as described before.
 */
const annotation = new TrattAnnotation.TrattAnnotation();
const level = annotation.addLevel(new TrattAnnotation.TrattAnnotation.createSegmentLevel('OCTRA_1'));
annotation.addItemToCurrentLevel(new TrattAnnotation.SampleUnit(123456, 22050), [new TrattAnnotation.OLabel('OCTRA_1', 'hello world')]);
```

### API

You can find more information about classes and functions of `@tratt/annotation` [here](https://ips-lmu.github.io/octra/modules/_octra_annotation.html).

### Changelog

[Go to changelog](https://github.com/IPS-LMU/octra/blob/main/libs/annotation/CHANGELOG.md)
