/**
 * Timing for saving VISP bundles on their own (see VispWorkspaceService):
 * which bundles have a save pending, and that saves of one bundle never
 * overlap. No Angular, so it is tested on its own.
 */

/** Per-bundle debounce: each schedule() restarts that bundle's timer. */
export class AutoSaveTimers {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly run: (bundleId: string) => void,
    private readonly delayMs: number,
  ) {}

  schedule(bundleId: string, delayMs = this.delayMs): void {
    this.cancel(bundleId);
    this.timers.set(
      bundleId,
      setTimeout(() => {
        this.timers.delete(bundleId);
        this.run(bundleId);
      }, delayMs),
    );
  }

  cancel(bundleId: string): void {
    const timer = this.timers.get(bundleId);
    if (timer) clearTimeout(timer);
    this.timers.delete(bundleId);
  }

  isPending(bundleId: string): boolean {
    return this.timers.has(bundleId);
  }

  /** Runs every pending save now (the page is being hidden or left). */
  flush(): void {
    for (const bundleId of [...this.timers.keys()]) {
      this.cancel(bundleId);
      this.run(bundleId);
    }
  }
}

/**
 * Runs tasks for one key one after another; different keys run independently.
 * A failed task does not stop the next one.
 */
export class KeyedQueue<T> {
  private readonly last = new Map<string, Promise<T>>();

  run(key: string, task: () => Promise<T>, onFailure: T): Promise<T> {
    const previous = this.last.get(key);
    const next = (previous ?? Promise.resolve(onFailure))
      .catch(() => onFailure)
      .then(task);
    this.last.set(key, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.last.get(key) === next) this.last.delete(key);
      });
    return next;
  }
}
