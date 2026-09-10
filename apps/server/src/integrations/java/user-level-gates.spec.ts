import {
  FREE_IP_WATCH_LEVEL_ID,
  hasFreeIpWatchPass,
  hasUserLevel,
  parseJavaLevelIds,
} from './user-level-gates';

describe('user-level-gates', () => {
  it('parses Java level rows into unique positive integer ids', () => {
    expect(
      parseJavaLevelIds([
        { id: 12, name: '认证制片人' },
        { id: '13' },
        { id: 12 },
        { id: 0 },
        { id: 'x' },
        null,
      ]),
    ).toEqual([12, 13]);
  });

  it('returns an empty list when level is missing', () => {
    expect(parseJavaLevelIds(undefined)).toEqual([]);
    expect(parseJavaLevelIds(null)).toEqual([]);
  });

  it('detects the free-watch level id', () => {
    expect(hasFreeIpWatchPass([1, FREE_IP_WATCH_LEVEL_ID])).toBe(true);
    expect(hasFreeIpWatchPass([1, 13])).toBe(false);
    expect(hasUserLevel(undefined, FREE_IP_WATCH_LEVEL_ID)).toBe(false);
  });
});
