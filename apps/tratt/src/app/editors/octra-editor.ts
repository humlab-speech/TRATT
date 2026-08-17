import { EventEmitter } from '@angular/core';
import { AudioSelection, SampleUnit } from '@octra/media';
import { AudioViewerComponent } from '@octra/ngx-components';
import { AudioChunk, AudioManager } from '@octra/web-media';
import { DefaultComponent } from '../core/component/default.component';

export interface OctraEditorRequirements {
  afterFirstInitialization(): void;

  disableAllShortcuts(): void;

  enableAllShortcuts(): void;

  initialized: EventEmitter<void>;
}

export abstract class OCTRAEditor extends DefaultComponent {
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
