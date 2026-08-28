// Component classes in this file carry `@Component()` metadata; instantiating
// them directly (without TestBed) requires the JIT compiler to be present.
import '@angular/compiler';
import { SimpleChange, SimpleChanges } from '@angular/core';
import { describe, expect, it } from 'vitest';
import {
  ConfigurationArrayControl,
  ToolConfigJsonSchema,
  ToolConfiguratorComponent,
} from './tool-configurator.component';

function changesFor(schema: ToolConfigJsonSchema): SimpleChanges {
  return {
    jsonSchema: new SimpleChange(undefined, schema, true),
  };
}

describe('ToolConfiguratorComponent', () => {
  it('sets itemsType on array controls so the add-item input renders with the right type', () => {
    // Regression test: itemsType used to be declared but never assigned,
    // meaning the array-item add popover (see toolconfig-group.component.html,
    // which switches on `control.itemsType`) could never render its
    // text/number input for any array-of-primitive schema property.
    const schema: ToolConfigJsonSchema = {
      type: 'object',
      title: 'Options',
      properties: {
        tags: {
          type: 'array',
          title: 'Tags',
          items: { type: 'string', enum: ['a', 'b'] },
        },
        counts: {
          type: 'array',
          title: 'Counts',
          items: { type: 'number' },
        },
        ids: {
          type: 'array',
          title: 'Ids',
          items: { type: 'integer' },
        },
      },
    };

    const component = new ToolConfiguratorComponent();
    component.jsonSchema = schema;
    component.ngOnChanges(changesFor(schema));

    const controls = component.form?.controls ?? [];
    expect(controls).toHaveLength(3);

    const [tags, counts, ids] = controls as ConfigurationArrayControl[];
    expect(tags.itemsType).toBe('text');
    expect(counts.itemsType).toBe('number');
    expect(ids.itemsType).toBe('integer');
  });

  it('produces a select control whose context is the array of label/value options', () => {
    const schema: ToolConfigJsonSchema = {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          title: 'Mode',
          enum: ['fast', 'slow'],
        },
      },
    };

    const component = new ToolConfiguratorComponent();
    component.jsonSchema = schema;
    component.ngOnChanges(changesFor(schema));

    const control = component.form?.controls[0];
    expect(control?.type).toBe('select');
    expect(control?.context).toEqual([
      { label: 'fast', value: 'fast' },
      { label: 'slow', value: 'slow' },
    ]);
  });
});
