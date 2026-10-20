import { effect, Injectable, OnDestroy } from '@angular/core';
import {
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { PlayBackStatus } from '@tratt/media';
import { SubscriptionManager } from '@tratt/utilities';
import { AudioManager } from '@tratt/web-media';
import { interval, Subscription } from 'rxjs';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';
import { AudioService } from './audio.service';

/**
 * Wall-clock milliseconds of real playback that must pass INSIDE one
 * segment's time range before that segment's transcription counts as
 * verified-by-listening. Two ticks of {@link TICK_MS}. Hover previews play
 * ~100 ms chunks and are excluded structurally via
 * {@link AudioManager.playOnHover}; the threshold only guards against
 * transient states (e.g. a playback that is started and instantly stopped).
 */
const MIN_LISTEN_MS_PER_SEGMENT = 200;
const TICK_MS = 100;

/**
 * Marks transcriptions as verified once a human has actually listened to
 * their part of the recording.
 *
 * A single generic rule covers every playback surface (all editors and the
 * overview listening feature): while an {@link AudioManager} plays, the
 * service samples the live playback position every {@link TICK_MS} and, once
 * the position has been inside a segment's time range for at least
 * {@link MIN_LISTEN_MS_PER_SEGMENT}, marks that segment of the CURRENT level
 * verified via {@link AnnotationStoreService.changeCurrentItemById} (which
 * also triggers the IndexedDB save). Hover scrubbing is ignored because the
 * manager reports {@link AudioManager.playOnHover} for those playbacks.
 */
@Injectable({ providedIn: 'root' })
export class SegmentVerificationService implements OnDestroy {
  private subscr = new SubscriptionManager<Subscription>();
  private tickSub: Subscription | null = null;
  private tickManager: AudioManager | null = null;
  private tickLevelId: number | null = null;
  private listenedMs = new Map<number, number>();
  private marked = new Set<number>();

  constructor(
    private audio: AudioService,
    private annotationStore: AnnotationStoreService,
  ) {
    // Rebind whenever the manager registry changes (bundle register, evict,
    // selection switch). `audiomanagers` reads the registry-version signal.
    effect(() => {
      const managers = this.audio.audiomanagers;
      this.rebind(managers);
    });
  }

  ngOnDestroy(): void {
    this.stopTicking();
    this.subscr.destroy();
  }

  private rebind(managers: AudioManager[] | undefined): void {
    this.stopTicking();
    this.subscr.destroy();
    for (const manager of managers ?? []) {
      this.subscr.add(
        manager.statechange.subscribe((state) =>
          this.onStateChanged(manager, state),
        ),
      );
    }
  }

  private onStateChanged(manager: AudioManager, state: PlayBackStatus): void {
    if (state === PlayBackStatus.PLAYING) {
      this.startTicking(manager);
    } else {
      this.stopTicking();
    }
  }

  private startTicking(manager: AudioManager): void {
    if (this.tickSub) {
      return;
    }
    this.tickManager = manager;
    this.tickSub = interval(TICK_MS).subscribe(() => this.tick());
  }

  private stopTicking(): void {
    this.tickSub?.unsubscribe();
    this.tickSub = null;
    this.tickManager = null;
    this.tickLevelId = null;
    this.listenedMs.clear();
    this.marked.clear();
  }

  private tick(): void {
    const manager = this.tickManager;
    if (!manager || !manager.isPlaying) {
      this.stopTicking();
      return;
    }
    if (manager.playOnHover) {
      // Scrub preview chunk (~100 ms), not actual listening.
      return;
    }
    const position = manager.playPosition?.samples;
    if (!Number.isFinite(position)) {
      return;
    }

    const level = this.annotationStore.currentLevel;
    if (!(level instanceof TrattAnnotationSegmentLevel)) {
      return;
    }
    // Level switches (or a different bundle's level) invalidate the running
    // accumulation; ids are not unique across levels.
    if (this.tickLevelId !== level.id) {
      this.tickLevelId = level.id;
      this.listenedMs.clear();
      this.marked.clear();
    }

    const items = level.items as TrattAnnotationSegment[];
    const index = this.segmentIndexAt(items, position);
    if (index < 0) {
      return;
    }

    const segment = items[index];
    const acc = (this.listenedMs.get(segment.id) ?? 0) + TICK_MS;
    this.listenedMs.set(segment.id, acc);
    if (acc < MIN_LISTEN_MS_PER_SEGMENT || this.marked.has(segment.id)) {
      return;
    }
    this.marked.add(segment.id);
    if (segment.verified) {
      return;
    }

    const updated = segment.clone(segment.id);
    updated.verified = true;
    this.annotationStore.changeCurrentItemById(segment.id, updated);
  }

  /**
   * First segment whose END sample lies strictly after `position`; segments
   * are sorted by end time, so this is the segment containing the position.
   * -1 when the position is past the last segment's end.
   */
  private segmentIndexAt(
    items: readonly TrattAnnotationSegment[],
    position: number,
  ): number {
    let lo = 0;
    let hi = items.length - 1;
    let answer = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].time.samples > position) {
        answer = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return answer;
  }
}
