import {
  DEFAULT_COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS,
  resolveClientToolWaitTtlHours,
} from './copilot.config';

describe('CopilotConfigService', () => {
  it('uses the 24-hour operational default only when the setting is absent', () => {
    expect(resolveClientToolWaitTtlHours({})).toBe(
      DEFAULT_COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS,
    );
  });

  it.each(['0', '-1', '1.5', '  ', '169', 'NaN'])(
    'fails loudly for invalid client-tool expiry %p',
    (value) => {
      expect(() =>
        resolveClientToolWaitTtlHours({
          COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS: value,
        }),
      ).toThrow('COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS');
    },
  );

  it('accepts a bounded whole-hour override', () => {
    expect(
      resolveClientToolWaitTtlHours({
        COPILOT_CLIENT_TOOL_WAIT_TTL_HOURS: '48',
      }),
    ).toBe(48);
  });
});
