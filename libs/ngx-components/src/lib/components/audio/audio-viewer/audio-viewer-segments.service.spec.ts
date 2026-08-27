import { EventEmitter } from '@angular/core';
import {
  OLabel,
  OLink,
  TrattAnnotation,
  TrattAnnotationLink,
  TrattAnnotationSegment,
  TrattAnnotationSegmentLevel,
} from '@tratt/annotation';
import { SampleUnit } from '@tratt/media';
import { describe, expect, it } from 'vitest';
import { AudioViewerSegmentsService } from './audio-viewer-segments.service';

const SAMPLE_RATE = 16000;

function time(samples: number): SampleUnit {
  return new SampleUnit(samples, SAMPLE_RATE);
}

function segment(id: number, samples: number, value = ''): TrattAnnotationSegment {
  return new TrattAnnotationSegment(id, time(samples), [
    new OLabel('OrthoTranscript', value),
  ]);
}

function segmentLevel(
  id: number,
  name: string,
  items: TrattAnnotationSegment[],
): TrattAnnotationSegmentLevel<TrattAnnotationSegment> {
  return new TrattAnnotationSegmentLevel<TrattAnnotationSegment>(id, name, items);
}

describe('AudioViewerSegmentsService', () => {
  describe('getChanges', () => {
    it('returns [] when either annotation is missing', () => {
      const service = new AudioViewerSegmentsService();
      const annotation = new TrattAnnotation([segmentLevel(1, 'OrthoTranscript', [])]);

      expect(service.getChanges(undefined as any, annotation)).toEqual([]);
      expect(service.getChanges(annotation, undefined as any)).toEqual([]);
    });

    it('detects an added level', () => {
      const service = new AudioViewerSegmentsService();
      const oldAnnotation = new TrattAnnotation([
        segmentLevel(1, 'OrthoTranscript', []),
      ]);
      const newLevel = segmentLevel(2, 'Phonetic', []);
      const newAnnotation = new TrattAnnotation([
        segmentLevel(1, 'OrthoTranscript', []),
        newLevel,
      ]);

      const changes = service.getChanges(oldAnnotation, newAnnotation);

      expect(changes).toEqual([
        {
          type: 'add',
          level: { old: undefined, new: newLevel },
        },
      ]);
    });

    it('detects a removed level', () => {
      const service = new AudioViewerSegmentsService();
      const removedLevel = segmentLevel(2, 'Phonetic', []);
      const oldAnnotation = new TrattAnnotation([
        segmentLevel(1, 'OrthoTranscript', []),
        removedLevel,
      ]);
      const newAnnotation = new TrattAnnotation([
        segmentLevel(1, 'OrthoTranscript', []),
      ]);

      const changes = service.getChanges(oldAnnotation, newAnnotation);

      expect(changes).toEqual([
        {
          type: 'remove',
          level: { old: removedLevel, new: undefined },
        },
      ]);
    });

    it('detects a changed item within a matched level', () => {
      const service = new AudioViewerSegmentsService();
      const oldItem = segment(1, 1000, 'hello');
      const oldLevel = segmentLevel(1, 'OrthoTranscript', [oldItem]);
      const oldAnnotation = new TrattAnnotation([oldLevel]);

      const newItem = segment(1, 1000, 'world');
      const newLevel = segmentLevel(1, 'OrthoTranscript', [newItem]);
      const newAnnotation = new TrattAnnotation([newLevel]);

      const changes = service.getChanges(oldAnnotation, newAnnotation);

      expect(changes).toEqual([
        {
          type: 'change',
          level: { old: newLevel, new: newLevel },
          item: { old: oldItem, new: newItem },
        },
      ]);
    });

    it('detects an item added to an existing level', () => {
      const service = new AudioViewerSegmentsService();
      const existingItem = segment(1, 1000);
      const oldLevel = segmentLevel(1, 'OrthoTranscript', [existingItem]);
      const oldAnnotation = new TrattAnnotation([oldLevel]);

      const addedItem = segment(2, 2000);
      const newLevel = segmentLevel(1, 'OrthoTranscript', [
        existingItem,
        addedItem,
      ]);
      const newAnnotation = new TrattAnnotation([newLevel]);

      const changes = service.getChanges(oldAnnotation, newAnnotation);

      expect(changes).toEqual([
        {
          type: 'add',
          item: { old: undefined, new: addedItem },
          level: { old: newLevel, new: newLevel },
        },
      ]);
    });

    it('detects a removed item within a matched level', () => {
      const service = new AudioViewerSegmentsService();
      const remainingItem = segment(1, 1000);
      const removedItem = segment(2, 2000);
      const oldLevel = segmentLevel(1, 'OrthoTranscript', [
        remainingItem,
        removedItem,
      ]);
      const oldAnnotation = new TrattAnnotation([oldLevel]);

      const newLevel = segmentLevel(1, 'OrthoTranscript', [remainingItem]);
      const newAnnotation = new TrattAnnotation([newLevel]);

      const changes = service.getChanges(oldAnnotation, newAnnotation);

      expect(changes).toEqual([
        {
          type: 'remove',
          item: { old: removedItem, new: undefined },
        },
      ]);
    });

    it('detects an added link', () => {
      const service = new AudioViewerSegmentsService();
      const oldAnnotation = new TrattAnnotation([], []);
      const newLink = new TrattAnnotationLink(1, new OLink(1, 2));
      const newAnnotation = new TrattAnnotation([], [newLink]);

      const changes = service.getChanges(oldAnnotation, newAnnotation);

      expect(changes).toEqual([
        {
          type: 'add',
          link: { old: undefined, new: newLink },
        },
      ]);
    });

    it('detects a changed link', () => {
      const service = new AudioViewerSegmentsService();
      const oldLink = new TrattAnnotationLink(1, new OLink(1, 2));
      const oldAnnotation = new TrattAnnotation([], [oldLink]);
      const newLink = new TrattAnnotationLink(1, new OLink(1, 3));
      const newAnnotation = new TrattAnnotation([], [newLink]);

      const changes = service.getChanges(oldAnnotation, newAnnotation);

      expect(changes).toEqual([
        {
          type: 'change',
          link: { old: oldLink, new: newLink },
        },
      ]);
    });

    it('returns [] when nothing changed', () => {
      const service = new AudioViewerSegmentsService();
      const item = segment(1, 1000);
      const oldAnnotation = new TrattAnnotation([
        segmentLevel(1, 'OrthoTranscript', [item]),
      ]);
      const newAnnotation = new TrattAnnotation([
        segmentLevel(1, 'OrthoTranscript', [item]),
      ]);

      expect(service.getChanges(oldAnnotation, newAnnotation)).toEqual([]);
    });
  });

  describe('getNextItemID', () => {
    it('increments the counter, emits it, and returns the pre-increment value', () => {
      const service = new AudioViewerSegmentsService();
      const emitted: number[] = [];
      service.itemIDCounterChange.subscribe((v) => emitted.push(v));

      expect(service.getNextItemID()).toBe(1);
      expect(service.getNextItemID()).toBe(2);

      expect(emitted).toEqual([2, 3]);
      expect(service.itemIDCounter).toBe(3);
    });
  });

  describe('addSegment', () => {
    it('adds a segment to the current level and emits currentLevelChange/annotationChange', () => {
      const service = new AudioViewerSegmentsService();
      const level = segmentLevel(1, 'OrthoTranscript', []);
      const annotation = new TrattAnnotation([level]);
      annotation.changeCurrentLevelIndex(0);

      const currentLevelChange = new EventEmitter<any>();
      const annotationChange = new EventEmitter<any>();
      const currentLevelEvents: any[] = [];
      const annotationEvents: any[] = [];
      currentLevelChange.subscribe((e) => currentLevelEvents.push(e));
      annotationChange.subscribe((e) => annotationEvents.push(e));

      service.addSegment(
        annotation,
        currentLevelChange,
        annotationChange,
        time(500),
        'hi',
      );

      expect(annotation.currentLevel!.items.length).toBe(1);
      expect(currentLevelEvents).toHaveLength(1);
      expect(currentLevelEvents[0].type).toBe('add');
      expect(annotationEvents).toEqual([annotation]);
    });
  });

  describe('removeSegmentByIndex', () => {
    it('removes the item at the given index and emits when triggerChange is true', () => {
      const service = new AudioViewerSegmentsService();
      const item = segment(1, 1000);
      const level = segmentLevel(1, 'OrthoTranscript', [item]);
      const annotation = new TrattAnnotation([level]);
      annotation.changeCurrentLevelIndex(0);

      const currentLevelChange = new EventEmitter<any>();
      const annotationChange = new EventEmitter<any>();
      const currentLevelEvents: any[] = [];
      currentLevelChange.subscribe((e) => currentLevelEvents.push(e));

      service.removeSegmentByIndex(
        annotation,
        0,
        undefined,
        false,
        true,
        currentLevelChange,
        annotationChange,
      );

      expect(annotation.currentLevel!.items.length).toBe(0);
      expect(currentLevelEvents).toEqual([
        {
          type: 'remove',
          items: [{ index: 0 }],
          removeOptions: { silenceCode: undefined, mergeTranscripts: false },
        },
      ]);
    });

    it('throws when the current level is undefined', () => {
      const service = new AudioViewerSegmentsService();
      const annotation = new TrattAnnotation([]);

      expect(() =>
        service.removeSegmentByIndex(
          annotation,
          0,
          undefined,
          false,
          true,
          new EventEmitter<any>(),
          new EventEmitter<any>(),
        ),
      ).toThrow("Can't remove segment by index: current level is undefined");
    });
  });

  describe('getSegmentSelection', () => {
    it('returns undefined when there is no current level', () => {
      const service = new AudioViewerSegmentsService();

      expect(service.getSegmentSelection(500, undefined, undefined)).toBeUndefined();
    });

    it('selects the range between two segments straddling the position', () => {
      const service = new AudioViewerSegmentsService();
      const level = segmentLevel(1, 'OrthoTranscript', [
        segment(1, 1000),
        segment(2, 2000),
        segment(3, 3000),
      ]);
      const annotation = new TrattAnnotation([level]);
      annotation.changeCurrentLevelIndex(0);
      const audioManager = {
        createSampleUnit: (n: number) => time(n),
        resource: { info: { duration: time(4000) } },
      } as any;

      const result = service.getSegmentSelection(1500, annotation, audioManager);

      expect(result?.start.samples).toBe(1000);
      expect(result?.end.samples).toBe(2000);
    });
  });
});
