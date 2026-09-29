import { EventEmitter } from '@angular/core';
import { AudioSelection, SampleUnit } from '@tratt/media';
import { AudioViewerComponent } from '@tratt/ngx-components';
import { AudioChunk, AudioManager } from '@tratt/web-media';
import { DefaultComponent } from '../core/component/default.component';

export interface TrattEditorRequirements {
  afterFirstInitialization(): void;

  disableAllShortcuts(): void;

  enableAllShortcuts(): void;

  initialized: EventEmitter<void>;

  /**
   * Synchronously commits any edit still sitting in a debounced
   * save-on-typing-stopped timer (e.g. `transcr-editor`'s 1s typing
   * debounce) straight to the store/annotation, bypassing the timer.
   * Optional because not every editor buffers edits this way (TRN-Editor
   * commits per-cell on Enter, with no debounce to flush). A caller that
   * is about to dispose this editor's view (e.g. a live editor switch)
   * must call this first, or an edit still inside the debounce window is
   * silently lost when the view is destroyed.
   */
  flushPendingEdits?(): void;
}

export abstract class TRATTEditor extends DefaultComponent {
  protected shortcutsEnabled = true;

  protected doPlayOnHover(
    audioManager: AudioManager,
    isPlayingOnhover: boolean,
    audioChunk: AudioChunk,
    mouseCursor: SampleUnit,
  ) {
    if (!audioManager.isPlaying && isPlayingOnhover) {
      // play audio on hover

      // it's very important to use a seperate chunk for the hover playback!
      const audioChunkHover = audioChunk.clone();
      audioChunkHover.volume = 1;
      audioChunkHover.playbackRate = 1;
      audioChunkHover.selection.start = mouseCursor.clone();
      audioChunkHover.selection.end = mouseCursor.add(
        audioManager.createSampleUnit(audioManager.sampleRate / 10),
      );
      audioChunkHover.startPlayback(true).catch((error) => {
        // ignore
      });
    }
  }

  abstract enableAllShortcuts(): void;
  abstract disableAllShortcuts(): void;

  protected changeArea(
    magnifier: AudioViewerComponent,
    signalDisplay: AudioViewerComponent,
    audioManager: AudioManager,
    audioChunkMagnifier: AudioChunk,
    cursorTime: SampleUnit,
    factor: number,
  ): Promise<AudioChunk | undefined> {
    return new Promise<AudioChunk | undefined>((resolve) => {
      const cursorLocation = signalDisplay.mouseCursor;
      if (cursorLocation && cursorTime) {
        const halfRate = Math.round(audioManager.sampleRate / factor);
        const start =
          cursorTime.samples > halfRate
            ? audioManager.createSampleUnit(cursorTime.samples - halfRate)
            : audioManager.createSampleUnit(0);

        const end =
          cursorTime.samples <
          audioManager.resource.info.duration.samples - halfRate
            ? audioManager.createSampleUnit(cursorTime.samples + halfRate)
            : audioManager.resource.info.duration.clone();

        magnifier.av.zoomY = factor;
        if (start && end) {
          audioChunkMagnifier.destroy();
          resolve(new AudioChunk(new AudioSelection(start, end), audioManager));
        } else {
          resolve(undefined);
        }
      } else {
        resolve(undefined);
      }
    });
  }

  abstract openSegment(index: number): void;
}
