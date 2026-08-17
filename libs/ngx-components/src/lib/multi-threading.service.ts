import { Injectable } from '@angular/core';
import {
  SubscriptionManager,
  TsWorker,
  TsWorkerJob,
  TsWorkerStatus,
} from '@tratt/utilities';
import { Subscription } from 'rxjs/internal/Subscription';

@Injectable({
  providedIn: 'root',
})
export class MultiThreadingService {
  private numberOfThreads = 2;
  private readonly workerTimeoutMs = 1500;
  private subscrManager = new SubscriptionManager<Subscription>();

  private _workers: TsWorker[] = [];

  get workers(): TsWorker[] {
    return this._workers;
  }

  constructor() {
    for (let i = 0; i < this.numberOfThreads; i++) {
      this._workers.push(new TsWorker());
    }
  }

  public run<T>(job: TsWorkerJob): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const bestWorker = this.getBestWorker();

      if (bestWorker !== undefined) {
        let settled = false;
        let subscriptionId = -1;
        let timeoutId: number | undefined;
        const clear = () => {
          if (timeoutId !== undefined) {
            window.clearTimeout(timeoutId);
          }
          if (subscriptionId > -1) {
            this.subscrManager.removeById(subscriptionId);
          }
        };
        const finish = (callback: () => void) => {
          if (!settled) {
            settled = true;
            clear();
            callback();
          }
        };
        const runInlineFallback = async (reason: unknown) => {
          console.warn('TsWorker stalled, running job inline.', reason);

          try {
            const doFunction =
              typeof job.doFunction === 'string'
                ? eval(job.doFunction)
                : job.doFunction;
            const result = await doFunction(...job.args);
            finish(() => {
              resolve(result as T);
            });
          } catch (error) {
            finish(() => {
              reject(error);
            });
          }
        };

        subscriptionId = this.subscrManager.add(
          bestWorker.jobstatuschange.subscribe(
            (changedJob: TsWorkerJob) => {
              if (changedJob.id === job.id) {
                if (changedJob.status === TsWorkerStatus.FINISHED) {
                  finish(() => {
                    resolve(changedJob.result);
                  });
                } else if (changedJob.status === TsWorkerStatus.FAILED) {
                  void runInlineFallback(
                    new Error(
                      `job id ${job.id} failed in worker ${bestWorker.id}`,
                    ),
                  );
                }
              }
            },
            (error: any) => {
              void runInlineFallback(error);
            },
          ),
        );

        timeoutId = window.setTimeout(() => {
          bestWorker.recoverFromStalledJob(job.id);
          void runInlineFallback(
            new Error(
              `job id ${job.id} timed out in worker ${bestWorker.id} after ${this.workerTimeoutMs} ms`,
            ),
          );
        }, this.workerTimeoutMs);

        bestWorker.addJob(job);
      } else {
        console.error(new Error(`found no worker to run job ${job.id}`));
      }
    });
  }

  public getStatistics(): string {
    let result = '';
    for (const worker of this.workers) {
      result +=
        `----- worker id ${worker.id} ----\n` +
        `jobs: ${worker.queue.length}\n----\n`;
    }

    return result;
  }

  public destroy() {
    this.subscrManager.destroy();
  }

  private getBestWorker(): TsWorker | undefined {
    let foundWorker: TsWorker | undefined = undefined;

    for (const worker of this._workers) {
      if (foundWorker === undefined) {
        foundWorker = worker;
      } else if (worker.queue.length < foundWorker.queue.length) {
        foundWorker = worker;
      }
    }

    return foundWorker;
  }
}
