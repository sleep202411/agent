import { isContentPolicyViolation } from './content-policy';

describe('isContentPolicyViolation', () => {
  it('matches the real fal.ai gpt-image-2 moderation body (parsed object)', () => {
    // Verbatim shape from a production gpt-image-2 refusal (job 019f85a7…).
    const body = {
      detail: [
        {
          loc: ['body', 'prompt'],
          msg: 'The content could not be processed because it contained material flagged by a content checker.',
          type: 'content_policy_violation',
          url: 'https://docs.fal.ai/errors#content_policy_violation',
        },
      ],
    };
    expect(isContentPolicyViolation(body)).toBe(true);
  });

  it('matches when the body arrives as a raw JSON string', () => {
    expect(
      isContentPolicyViolation(
        '{"detail":[{"type":"content_policy_violation"}]}',
      ),
    ).toBe(true);
  });

  it('matches Alibaba Model Studio moderation wording', () => {
    expect(
      isContentPolicyViolation(
        'Alibaba Model Studio HTTP 400: input data may contain inappropriate content.',
      ),
    ).toBe(true);
  });

  it('does NOT flag an ordinary parameter validation error', () => {
    expect(
      isContentPolicyViolation(
        '{"detail":[{"loc":["body","image_size"],"msg":"value is not a valid enumeration member"}]}',
      ),
    ).toBe(false);
  });

  it('is null/undefined safe', () => {
    expect(isContentPolicyViolation(null)).toBe(false);
    expect(isContentPolicyViolation(undefined)).toBe(false);
    expect(isContentPolicyViolation('')).toBe(false);
  });
});
