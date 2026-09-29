import { describe, expect, it } from '@jest/globals';
import { SessionFile } from '../../obj/SessionFile';
import { buildModeOptions } from './build-mode-options';

function makeState(overrides: Record<string, unknown> = {}): any {
  return {
    sessionFile: new SessionFile('a.wav', 4, new Date(2024, 0, 1), 'audio/wav'),
    importConverter: 'AnnotJSON',
    currentEditor: '2D-Editor',
    transcript: { selectedLevelIndex: 2 },
    logging: { enabled: true },
    currentSession: {
      loadFromServer: false,
      assessment: null,
      comment: 'hello',
    },
    additionalSpeakerIds: [],
    ...overrides,
  };
}

describe('buildModeOptions', () => {
  it('produces the same field set the options save path has always written', () => {
    const options = buildModeOptions(makeState(), undefined, undefined);

    expect(options.sessionfile).toEqual(
      new SessionFile('a.wav', 4, new Date(2024, 0, 1), 'audio/wav').toAny(),
    );
    expect(options.importConverter).toBe('AnnotJSON');
    expect(options.currentEditor).toBe('2D-Editor');
    expect(options.currentLevel).toBe(2);
    expect(options.logging).toBe(true);
    expect(options.project).toBeUndefined();
    expect(options.transcriptID).toBeUndefined();
    expect(options.comment).toBe('hello');
    expect(options.additionalSpeakerIds).toBeNull();
    expect(options.user).toBeUndefined();
  });

  it('carries the run state through when one is supplied', () => {
    expect(buildModeOptions(makeState(), undefined, 'done').runState).toBe(
      'done',
    );
  });

  it('omits runState entirely when none is supplied, rather than writing undefined', () => {
    expect(
      'runState' in buildModeOptions(makeState(), undefined, undefined),
    ).toBe(false);
  });

  it('includes the authenticated user when one is present', () => {
    const options = buildModeOptions(
      makeState(),
      { id: '7', username: 'ada', email: 'ada@example.org' } as any,
      undefined,
    );
    expect(options.user).toEqual({
      id: '7',
      name: 'ada',
      email: 'ada@example.org',
    });
  });

  it('nulls the session file when the state has none', () => {
    expect(
      buildModeOptions(
        makeState({ sessionFile: undefined }),
        undefined,
        undefined,
      ).sessionfile,
    ).toBeNull();
  });
});
