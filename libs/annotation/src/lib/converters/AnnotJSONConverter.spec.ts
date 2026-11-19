import { describe, expect, it } from 'vitest';
import { AnnotJSONConverter } from './AnnotJSONConverter';

const audio = { name: 'interview.wav', sampleRate: 16000 } as never;
const imp = (content: object) =>
  new AnnotJSONConverter().import(
    {
      name: 'x_annot.json',
      type: 'application/json',
      encoding: 'UTF-8',
      content: JSON.stringify(content),
    } as never,
    audio,
  );

describe('AnnotJSONConverter.import', () => {
  it('tolerates missing levels and links', () => {
    const r = imp({ name: 'x', sampleRate: 16000 });
    expect(r.error).toBe('');
    expect(r.annotjson?.levels).toEqual([]);
    expect(r.annotjson?.links).toEqual([]);
  });
});
