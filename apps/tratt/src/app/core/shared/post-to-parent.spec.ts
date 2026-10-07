import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { postToParent } from './post-to-parent';

describe('postToParent', () => {
  const realParent = Object.getOwnPropertyDescriptor(window, 'parent');
  afterEach(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent);
    jest.restoreAllMocks();
  });

  function embed(referrer: string) {
    const parent = { postMessage: jest.fn() };
    Object.defineProperty(window, 'parent', {
      value: parent,
      configurable: true,
    });
    jest.spyOn(document, 'referrer', 'get').mockReturnValue(referrer);
    return parent;
  }

  it('addresses the embedder origin, never *', () => {
    const parent = embed('https://host.example/page?x=1');
    expect(postToParent({ a: 1 })).toBe(true);
    expect(parent.postMessage).toHaveBeenCalledWith(
      { a: 1 },
      'https://host.example',
    );
  });

  it('sends nothing when the embedder is unknown', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const parent = embed('');
    expect(postToParent({ a: 1 })).toBe(false);
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});
