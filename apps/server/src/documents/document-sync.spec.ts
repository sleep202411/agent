import { resolveSyncWindow } from './document-sync';

describe('resolveSyncWindow', () => {
  it('replays incrementally when at/ahead of the horizon', () => {
    expect(resolveSyncWindow(10, 5)).toEqual({
      fromSequence: 10,
      resyncRequired: false,
    });
    expect(resolveSyncWindow(5, 5)).toEqual({
      fromSequence: 5,
      resyncRequired: false,
    });
  });

  it('forces a resync from the horizon when behind it', () => {
    expect(resolveSyncWindow(3, 8)).toEqual({
      fromSequence: 8,
      resyncRequired: true,
    });
  });

  it('a fresh client (afterSequence 0) on a fresh doc replays from 0', () => {
    expect(resolveSyncWindow(0, 0)).toEqual({
      fromSequence: 0,
      resyncRequired: false,
    });
  });

  it('a fresh client on a compacted doc resyncs from the horizon', () => {
    expect(resolveSyncWindow(0, 42)).toEqual({
      fromSequence: 42,
      resyncRequired: true,
    });
  });

  it('normalizes bad input', () => {
    expect(resolveSyncWindow(-5, 10)).toEqual({
      fromSequence: 10,
      resyncRequired: true,
    });
    expect(resolveSyncWindow(NaN, 0)).toEqual({
      fromSequence: 0,
      resyncRequired: false,
    });
    expect(resolveSyncWindow(7.9, 0)).toEqual({
      fromSequence: 7,
      resyncRequired: false,
    });
  });
});
