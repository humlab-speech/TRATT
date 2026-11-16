import { AutoSaveTimers, KeyedQueue } from './visp-auto-save';

describe('AutoSaveTimers', () => {
  let saved: string[];
  let timers: AutoSaveTimers;

  beforeEach(() => {
    jest.useFakeTimers();
    saved = [];
    timers = new AutoSaveTimers((id) => saved.push(id), 2000);
  });

  afterEach(() => jest.useRealTimers());

  it('saves a bundle once its edits pause for the delay', () => {
    timers.schedule('b1');
    jest.advanceTimersByTime(1500);
    timers.schedule('b1'); // another edit restarts the wait
    jest.advanceTimersByTime(1500);
    expect(saved).toEqual([]);
    jest.advanceTimersByTime(500);
    expect(saved).toEqual(['b1']);
    expect(timers.isPending('b1')).toBe(false);
  });

  it('keeps bundles apart', () => {
    timers.schedule('b1');
    jest.advanceTimersByTime(1000);
    timers.schedule('b2');
    jest.advanceTimersByTime(1000);
    expect(saved).toEqual(['b1']);
    jest.advanceTimersByTime(1000);
    expect(saved).toEqual(['b1', 'b2']);
  });

  it('can use another delay (a retry while VISP is unreachable)', () => {
    timers.schedule('b1', 15000);
    jest.advanceTimersByTime(14999);
    expect(saved).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(saved).toEqual(['b1']);
  });

  it('does not save a cancelled bundle', () => {
    timers.schedule('b1');
    timers.cancel('b1');
    jest.advanceTimersByTime(5000);
    expect(saved).toEqual([]);
  });

  it('saves everything pending at once on flush, and only once', () => {
    timers.schedule('b1');
    timers.schedule('b2');
    timers.flush();
    expect(saved.sort()).toEqual(['b1', 'b2']);
    jest.advanceTimersByTime(5000);
    expect(saved).toHaveLength(2);
  });
});

describe('KeyedQueue', () => {
  // Lets queued promise chains run (a task starts a few microtasks later).
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const deferred = () => {
    let resolve!: (v: boolean) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<boolean>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('starts a save of a bundle only after the previous one landed', async () => {
    const queue = new KeyedQueue<boolean>();
    const first = deferred();
    const order: string[] = [];
    void queue.run('b1', () => (order.push('first'), first.promise), false);
    const second = queue.run(
      'b1',
      async () => (order.push('second'), true),
      false,
    );
    await settle();
    expect(order).toEqual(['first']);
    first.resolve(true);
    await expect(second).resolves.toBe(true);
    expect(order).toEqual(['first', 'second']);
  });

  it('runs the next save after a failed one', async () => {
    const queue = new KeyedQueue<boolean>();
    const failing = queue.run(
      'b1',
      () => Promise.reject(new Error('x')),
      false,
    );
    const next = queue.run('b1', async () => true, false);
    await expect(failing).rejects.toThrow('x');
    await expect(next).resolves.toBe(true);
  });

  it('does not hold up other bundles', async () => {
    const queue = new KeyedQueue<boolean>();
    const slow = deferred();
    void queue.run('b1', () => slow.promise, false);
    await expect(queue.run('b2', async () => true, false)).resolves.toBe(true);
    slow.resolve(true);
  });
});
