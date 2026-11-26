import { describe, expect, it } from '@jest/globals';
import { formatTime, moveBoundary, unitAt } from './boundary-time';

describe('formatTime', () => {
  it('formats under an hour as mm:ss.mmm', () => {
    expect(formatTime(75_020, 1000)).toBe('01:15.020');
  });
  it('adds hours from 1 h', () => {
    expect(formatTime(3_725_005, 1000)).toBe('1:02:05.005');
  });
});

describe('moveBoundary', () => {
  const ends = [1000, 2000, 3000];
  it('moves freely inside the neighbours', () => {
    expect(moveBoundary(ends, 0, 1500, 1000)).toBe(1500);
  });
  it('clamps below the next end minus 10 ms', () => {
    expect(moveBoundary(ends, 0, 2500, 1000)).toBe(1990);
    expect(moveBoundary(ends, 1, 3500, 1000)).toBe(2990);
  });
  it('clamps above 10 ms for the first segment', () => {
    expect(moveBoundary(ends, 0, -5, 1000)).toBe(10);
  });
  it('clamps above previous end plus 10 ms', () => {
    expect(moveBoundary(ends, 1, 900, 1000)).toBe(1010);
  });
  it('leaves the last end fixed', () => {
    expect(moveBoundary(ends, 2, 2500, 1000)).toBe(3000);
  });
});

describe('unitAt', () => {
  const ends = [1000, 2000, 3000];
  it('finds the unit whose span contains the sample', () => {
    expect(unitAt(ends, 0)).toBe(0);
    expect(unitAt(ends, 999)).toBe(0);
    expect(unitAt(ends, 1500)).toBe(1);
    expect(unitAt(ends, 2999)).toBe(2);
  });
  it('gives a boundary sample to the unit it ends', () => {
    expect(unitAt(ends, 1000)).toBe(0);
    expect(unitAt(ends, 1001)).toBe(1);
  });
  it('clamps past the end and handles no units', () => {
    expect(unitAt(ends, 9999)).toBe(2);
    expect(unitAt([], 5)).toBe(-1);
  });
});
