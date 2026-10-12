import { mapBytePlusHttpError } from './byteplus-error.mapper';
import type { AiJobError } from '../../types';

/** mapBytePlusHttpError returns the error (the HTTP client is what throws). */
function mappedHttpError(status: number, raw: string): AiJobError {
  return mapBytePlusHttpError(status, raw).payload;
}

describe('mapBytePlusHttpError', () => {
  it('surfaces the upstream InvalidParameter message verbatim on 4xx rejections', () => {
    const error = mappedHttpError(
      400,
      JSON.stringify({
        error: {
          code: 'InvalidParameter.TaskTypeConstraint',
          message:
            'omni_reference_task_type=edit requires at least one reference_video of 4-30 seconds.',
        },
      }),
    );
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.retryable).toBe(false);
    expect(error.userMessage).toBe(
      'omni_reference_task_type=edit requires at least one reference_video of 4-30 seconds.',
    );
  });

  it('keeps the generic copy when the 4xx body has no parseable error message', () => {
    const error = mappedHttpError(400, 'plain text gateway noise');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.userMessage).toBe(
      'The generation request was rejected. Please check the inputs.',
    );
  });

  it('still special-cases ModelNotOpen before the verbatim fallback', () => {
    const error = mappedHttpError(
      403,
      JSON.stringify({
        error: { code: 'ModelNotOpen', message: 'The model is not activated.' },
      }),
    );
    expect(error.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(error.userMessage).toContain('temporarily unavailable');
  });

  it('maps 429 and 5xx to retryable provider errors regardless of body', () => {
    expect(
      mappedHttpError(429, JSON.stringify({ error: { message: 'slow down' } })),
    ).toMatchObject({ code: 'PROVIDER_429', retryable: true });
    expect(mappedHttpError(502, 'bad gateway')).toMatchObject({
      code: 'PROVIDER_5XX',
      retryable: true,
    });
  });
});
it.each([403, 429, 503])(
  'classifies overdue accounts before generic HTTP %s retries',
  (status) => {
    expect(
      mapBytePlusHttpError(
        status,
        JSON.stringify({
          error: { code: 'AccountOverdueError', message: 'overdue balance' },
        }),
      ).payload,
    ).toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
      retryable: false,
      userMessage: expect.stringContaining('provider account'),
    });
  },
);
