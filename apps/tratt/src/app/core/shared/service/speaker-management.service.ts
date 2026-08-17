import { Injectable, inject } from '@angular/core';
import {
  AnnotationAnySegment,
  OLabel,
  OctraAnnotationSegment,
  OctraAnnotationSegmentLevel,
} from '@octra/annotation';
import {
  cycleNextSpeaker,
  getSpeakerColor,
  getSpeakerIds,
  getSpeakerTextColor,
  renameSpeakerInAnnotation,
} from '@octra/ngx-components';
import { AnnotationStoreService } from '../../store/login-mode/annotation/annotation.store.service';

@Injectable({ providedIn: 'root' })
export class SpeakerManagementService {
  private annotationStore = inject(AnnotationStoreService);

  getSpeakerIds(): string[] {
    const t = this.annotationStore.transcript;
    const fromTranscript = t ? getSpeakerIds(t) : [];
    const additional = this.annotationStore.additionalSpeakerIds;
    const merged = new Set([...fromTranscript, ...additional]);
    return [...merged].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );
  }

  getColor(speakerId: string): string {
    return getSpeakerColor(speakerId, this.getSpeakerIds());
  }

  getTextColor(bgHex: string): string {
    return getSpeakerTextColor(bgHex);
  }

  cycleNext(currentId: string): string {
    return cycleNextSpeaker(currentId, this.getSpeakerIds());
  }

  rename(oldId: string, newId: string): void {
    const t = this.annotationStore.transcript;
    if (!t || !newId.trim() || newId === oldId) return;
    const renamed = renameSpeakerInAnnotation(oldId, newId.trim(), t);
    this.annotationStore.overwriteTranscript(renamed);
    if (this.annotationStore.additionalSpeakerIds.includes(oldId)) {
      this.annotationStore.removeSpeakerId(oldId);
      this.annotationStore.addSpeakerId(newId.trim());
    }
  }

  isAssigned(speakerId: string): boolean {
    const t = this.annotationStore.transcript;
    return t ? getSpeakerIds(t).includes(speakerId) : false;
  }

  cycleSpeakerOnSegment(segmentId: number): void {
    const level = this.annotationStore.currentLevel;
    if (!level) return;
    const segIndex = level.items.findIndex((s) => s.id === segmentId);
    if (segIndex < 0) return;
    const segment = level.items[segIndex] as OctraAnnotationSegment;
    const current = segment.getLabel('Speaker')?.value ?? '';
    const next = this.cycleNext(current);

    const linkGroupIds = this.findLinkGroup(level.id);
    if (linkGroupIds.size <= 1) {
      const updatedSegment = this.applySpeakerLabel(segment, next);
      const updatedItems = [
        ...level.items.slice(0, segIndex),
        updatedSegment,
        ...level.items.slice(segIndex + 1),
      ] as AnnotationAnySegment[];
      this.annotationStore.changeCurrentLevelItems(updatedItems);
      return;
    }

    // Linked twins exist: mutate all peers in a single cloned transcript
    // and dispatch one overwriteTranscript to keep the change atomic.
    const transcript = this.annotationStore.transcript;
    if (!transcript) return;
    const cloned = transcript.clone();
    const selectedIndex = transcript.selectedLevelIndex;
    if (selectedIndex !== undefined) {
      cloned.changeLevelIndex(selectedIndex);
    }
    for (const id of linkGroupIds) {
      const lvl = cloned.levels.find((l) => l.id === id);
      if (!(lvl instanceof OctraAnnotationSegmentLevel)) continue;
      if (segIndex < 0 || segIndex >= lvl.items.length) continue;
      const seg = lvl.items[segIndex] as OctraAnnotationSegment;
      const updated = this.applySpeakerLabel(seg, next);
      lvl.overwriteItems([
        ...lvl.items.slice(0, segIndex),
        updated,
        ...lvl.items.slice(segIndex + 1),
      ]);
    }
    this.annotationStore.overwriteTranscript(cloned);
  }

  private applySpeakerLabel(
    segment: OctraAnnotationSegment,
    value: string,
  ): OctraAnnotationSegment {
    const updated = segment.clone() as OctraAnnotationSegment;
    const changed = updated.changeLabel('Speaker', value);
    if (!changed) {
      updated.labels = [...updated.labels, new OLabel('Speaker', value)];
    }
    return updated;
  }

  /**
   * Returns ids of all levels that share a link group with `levelId`.
   * The group is the source level plus every level whose `linkedToLevelId`
   * resolves to the same source id. Always includes `levelId` itself.
   */
  private findLinkGroup(levelId: number): Set<number> {
    const result = new Set<number>([levelId]);
    const transcript = this.annotationStore.transcript;
    if (!transcript) return result;
    const origin = transcript.levels.find((l) => l.id === levelId);
    if (!(origin instanceof OctraAnnotationSegmentLevel)) return result;
    const sourceLevelId =
      origin.linkedToLevelId !== undefined ? origin.linkedToLevelId : origin.id;
    result.add(sourceLevelId);
    for (const l of transcript.levels) {
      if (
        l instanceof OctraAnnotationSegmentLevel &&
        l.linkedToLevelId === sourceLevelId
      ) {
        result.add(l.id);
      }
    }
    return result;
  }
}
