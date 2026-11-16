import * as de from '../../../../assets/i18n/de.json';
import * as en from '../../../../assets/i18n/en.json';
import * as sv from '../../../../assets/i18n/sv.json';
import { AppInfo } from '../../../app.info';
import { ImportOptionsModalComponent } from './import-options-modal.component';

const file = { name: 'a.x', type: '', content: '', encoding: 'UTF-8' };
const audio = { name: 'a.wav', sampleRate: 16000 } as never;

const open = (schema: any, converter: any, value?: unknown) => {
  const modal = new ImportOptionsModalComponent(
    {} as never,
    {} as never,
    { translate: (key: string) => key } as never,
  );
  modal.schema = schema;
  modal.converter = converter;
  modal.value = value;
  modal.ngOnInit();
  return modal;
};

const withSchema = AppInfo.converters
  .map((converter) => ({
    converter,
    schema: converter.needsOptionsForImport(file, audio),
  }))
  .filter((c) => c.schema);

describe('ImportOptionsModalComponent', () => {
  it.each([
    ['en', en],
    ['sv', sv],
    ['de', de],
  ])('has %s texts for every import option', (_lang, texts: any) => {
    for (const { converter, schema } of withSchema) {
      for (const key of Object.keys(schema.properties)) {
        const entry = texts.converters?.[converter.name]?.options?.[key];
        expect([converter.name, key, !!entry?.title]).toEqual([
          converter.name,
          key,
          true,
        ]);
        expect(entry.description).toBeTruthy();
      }
    }
  });

  it('turns speaker ID extraction on when there are no stored options', () => {
    for (const { converter, schema } of withSchema) {
      const modal = open(schema, converter);
      if (schema.properties.speakerIdentifierPattern) {
        expect([converter.name, ...Object.keys(modal.value)]).toContain(
          'speakerIdentifierPattern',
        );
      }
    }
  });

  it('keeps stored options as they are', () => {
    const { converter, schema } = withSchema.find(
      (c) => c.schema.properties.speakerIdentifierPattern,
    )!;
    expect(open(schema, converter, {}).value).toEqual({});
  });

  it('falls back to the schema text when a translation is missing', () => {
    const { converter, schema } = withSchema[0];
    const modal = open(
      { properties: { x: { title: 'T', description: 'D' } } },
      converter,
    );
    expect(modal.schema.properties.x).toEqual({ title: 'T', description: 'D' });
    expect(schema).toBeTruthy();
  });
});
