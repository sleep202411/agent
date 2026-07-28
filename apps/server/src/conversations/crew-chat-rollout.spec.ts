import {
  crewChatWritesEnabled,
  requireCrewChatWritesEnabled,
} from './crew-chat-rollout';

describe('crew-chat rollout gate', () => {
  const original = process.env.CREW_CHAT_WRITES_ENABLED;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CREW_CHAT_WRITES_ENABLED;
    } else {
      process.env.CREW_CHAT_WRITES_ENABLED = original;
    }
  });

  it('fails closed by default in production and stays on elsewhere', () => {
    expect(crewChatWritesEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(crewChatWritesEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(crewChatWritesEnabled({ NODE_ENV: 'test' })).toBe(true);
  });

  it('accepts explicit boolean switches and rejects typos', () => {
    expect(
      crewChatWritesEnabled({
        NODE_ENV: 'production',
        CREW_CHAT_WRITES_ENABLED: 'true',
      }),
    ).toBe(true);
    expect(
      crewChatWritesEnabled({
        NODE_ENV: 'development',
        CREW_CHAT_WRITES_ENABLED: '0',
      }),
    ).toBe(false);
    expect(() =>
      crewChatWritesEnabled({ CREW_CHAT_WRITES_ENABLED: 'maybe' }),
    ).toThrow('CREW_CHAT_WRITES_ENABLED');
  });

  it('returns an actionable 503 while production writes are gated', () => {
    process.env.CREW_CHAT_WRITES_ENABLED = 'false';
    expect(() => requireCrewChatWritesEnabled()).toThrow(
      'Crew chat is temporarily unavailable',
    );
  });
});
