import { resolveReferralInviteBaseUrl } from './referrals.config';

describe('referral origin configuration', () => {
  it.each([undefined, '', '   '])(
    'rejects an omitted or blank origin: %s',
    (value) => {
      expect(() =>
        resolveReferralInviteBaseUrl({ REFERRAL_INVITE_BASE_URL: value }),
      ).toThrow('Missing required env var: REFERRAL_INVITE_BASE_URL');
    },
  );

  it.each([
    'fizzdragon.com',
    '//fizzdragon.com',
    'javascript:alert(1)',
    'https://user:password@fizzdragon.com',
    'https://fizzdragon.com/register',
    'https://fizzdragon.com/?site=cn',
    'https://fizzdragon.com/#register',
  ])('rejects an invalid origin: %s', (value) => {
    expect(() =>
      resolveReferralInviteBaseUrl({ REFERRAL_INVITE_BASE_URL: value }),
    ).toThrow('REFERRAL_INVITE_BASE_URL must be an absolute HTTP(S) origin');
  });

  it('normalizes surrounding whitespace and a trailing slash', () => {
    expect(
      resolveReferralInviteBaseUrl({
        REFERRAL_INVITE_BASE_URL: '  https://fizzdragon.fizzspace.cn/  ',
      }),
    ).toBe('https://fizzdragon.fizzspace.cn');
  });
});
