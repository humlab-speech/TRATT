import { HttpClient } from '@angular/common/http';
import { EventEmitter, Injectable, isDevMode } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskInputOutputDto } from '@octra/api-types';
import { downloadFile } from '@tratt/ngx-utilities';
import { SubscriptionManager } from '@tratt/utilities';
import { AudioManager } from '@tratt/web-media';
import { Subject, Subscription } from 'rxjs';
import { selectSelectedBundleId } from '../../store/login-mode/annotation/annotation.selectors';
import { DEFAULT_BUNDLE_ID } from '../../store/login-mode/annotation/local-bundle-collection';

@Injectable()
export class AudioService {
  public missingPermission = new EventEmitter<void>();
  private subscrmanager: SubscriptionManager<Subscription> =
    new SubscriptionManager<Subscription>();
  private afterloaded: EventEmitter<any> = new EventEmitter<any>();

  private _audiomanagers = new Map<string, AudioManager>();
  private selectedBundleId = this.store.selectSignal(selectSelectedBundleId);

  get audiomanagers(): AudioManager[] {
    return Array.from(this._audiomanagers.values());
  }

  private _loaded = false;

  get loaded(): boolean {
    return this._loaded;
  }

  get current(): AudioManager | undefined {
    return this._audiomanagers.get(this.selectedBundleId());
  }

  /**
   * @deprecated Use `current` instead. This throws in dev builds when there
   * is no resolvable manager for the current selection, instead of silently
   * returning undefined/wrong data (the old array-index-0 behavior).
   */
  get audioManager(): AudioManager {
    const manager = this.current;
    if (manager === undefined && isDevMode()) {
      throw new Error(
        'AudioService.audioManager accessed with no manager registered for the current selection — use AudioService.current and handle the undefined case.',
      );
    }
    return manager as AudioManager;
  }

  /***
   * Constructor
   */
  constructor(
    private http: HttpClient,
    private store: Store,
  ) {}

  /**
   * loadAudio(url) loads the audio data referred to via the URL in an AJAX call.
   * The audiodata is written to the local audiobuffer field.
   *
   * audio data; for longer data, a MediaElementAudioSourceNode should be used.
   */
  public loadAudio: (
    url: string,
    audioInput: TaskInputOutputDto,
  ) => Subject<any> = (url: string, audioInput: TaskInputOutputDto) => {
    this._loaded = false;

    const subj = new Subject<number>();

    downloadFile<ArrayBuffer>(this.http, url, 'arraybuffer').subscribe({
      next: (event) => {
        subj.next(0.5 * event.progress);
        if (event.progress === 1 && event.result) {
          this.subscrmanager.add(
            AudioManager.create(
              audioInput.filename,
              audioInput.type,
              event.result,
              url,
            ).subscribe({
              next: (result) => {
                if (result.audioManager && result.progress === 1) {
                  // finished
                  result.audioManager.resource.info.url = url;
                  this.registerAudioManager(
                    DEFAULT_BUNDLE_ID,
                    result.audioManager,
                  );
                  this.afterloaded.emit({ status: 'success' });

                  subj.next(result.progress);
                  subj.complete();
                } else {
                  subj.next(result.progress);
                }
              },
              error: (error: any) => {
                subj.error(error);
              },
            }),
          );
        }
      },
      error: (error) => {
        subj.error(error);
      },
    });

    return subj;
  };

  public registerAudioManager(bundleId: string, manager: AudioManager) {
    if (manager !== undefined) {
      const existing = this._audiomanagers.get(bundleId);
      if (existing !== manager) {
        this._audiomanagers.set(bundleId, manager);

        this.subscrmanager.add(
          manager.audioMechanism!.missingPermission.subscribe(() => {
            this.missingPermission.emit();
          }),
        );
      }
    }
  }

  public async destroy(disconnect = true) {
    for (const audioManager of this._audiomanagers.values()) {
      await audioManager.destroy(disconnect);
    }
    this._audiomanagers.clear();
    this.subscrmanager.destroy();
  }
}
