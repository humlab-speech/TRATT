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

  it('rejects a blank annotates', () => {
    expect(
      imp({ name: 'x', annotates: '', sampleRate: 16000, levels: [] }).error,
    ).not.toBe('');
  });

  it('rejects a conflicting annotates', () => {
    expect(
      imp({ name: 'x', annotates: 'other.wav', sampleRate: 16000, levels: [] })
        .error,
    ).not.toBe('');
  });

  it('accepts a missing annotates', () => {
    expect(imp({ name: 'x', sampleRate: 16000, levels: [] }).error).toBe('');
  });

  it('does not mutate the caller file', () => {
    const file = {
      name: 'x_annot.json',
      type: 'application/json',
      encoding: 'UTF-8',
      content: JSON.stringify({ name: 'x', sampleRate: 16000, levels: [] }),
    };
    new AnnotJSONConverter().import(file as never, audio);
    expect(file.name).toBe('x_annot.json');
  });

  it('keeps the audio basename as default annotation name for empty content', () => {
    const r = new AnnotJSONConverter().import(
      { name: 'x_annot.json', content: '' } as never,
      audio,
    );
    expect(r.error).toBeTruthy();
  });

  it('returns an error instead of throwing without audio', () => {
    expect(
      new AnnotJSONConverter().import({ name: 'x', content: '{}' } as never, undefined as never)
        .error,
    ).toBeTruthy();
  });
});
