import { ApiError, GoogleGenAI } from '@google/genai';
import {
  errorFromGoogleOperation,
  mapGoogleVertexUnknownError,
} from './google-vertex-error.mapper';

describe('Google Vertex error mapping', () => {
  it('maps quota and service failures to retryable provider codes', () => {
    expect(
      mapGoogleVertexUnknownError(
        new ApiError({
          message: 'Resource exhausted',
          status: 429,
        }),
      ),
    ).toMatchObject({ code: 'PROVIDER_429', retryable: true });

    expect(
      errorFromGoogleOperation({ code: 503, message: 'Unavailable' }),
    ).toMatchObject({ code: 'PROVIDER_5XX', retryable: true });
  });

  it.each([
    [3, 'VALIDATION_ERROR', false],
    [4, 'PROVIDER_TIMEOUT', true],
    [7, 'PROVIDER_NOT_CONFIGURED', false],
    [8, 'PROVIDER_429', true],
    [14, 'PROVIDER_5XX', true],
    [16, 'PROVIDER_NOT_CONFIGURED', false],
  ])(
    'maps operation RPC code %s to the appropriate retry policy',
    (code, expected, retryable) => {
      expect(
        errorFromGoogleOperation({ code, message: 'Operation failed' }),
      ).toMatchObject({ code: expected, retryable });
    },
  );

  it('preserves safety refusals and validation details in RPC operation errors', () => {
    expect(
      errorFromGoogleOperation({
        code: 3,
        message: 'Request blocked by safety policy',
      }),
    ).toMatchObject({ code: 'PROVIDER_CONTENT_FILTER', retryable: false });
    expect(
      errorFromGoogleOperation({
        code: 3,
        message: 'Unsupported image dimensions',
      }),
    ).toMatchObject({
      code: 'VALIDATION_ERROR',
      retryable: false,
      userMessage: 'Unsupported image dimensions',
    });
    expect(
      errorFromGoogleOperation({
        code: 99,
        message: 'Unrecognized operation error',
      }),
    ).toMatchObject({ code: 'UNKNOWN', retryable: true });
  });

  it('maps IAM failures and safety refusals without making them retryable', () => {
    expect(
      errorFromGoogleOperation({ code: 403, message: 'Permission denied' }),
    ).toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
      retryable: false,
    });

    expect(
      errorFromGoogleOperation({
        code: 400,
        message: 'Request blocked by safety policy',
      }),
    ).toMatchObject({
      code: 'PROVIDER_CONTENT_FILTER',
      retryable: false,
    });
  });
  it.each([
    [400, 'VALIDATION_ERROR', false],
    [403, 'PROVIDER_NOT_CONFIGURED', false],
    [429, 'PROVIDER_429', true],
    [503, 'PROVIDER_5XX', true],
  ])(
    'recognizes Interactions SDK HTTP %s errors outside the ApiError hierarchy',
    (status, code, retryable) => {
      const error = Object.assign(new Error(`${status} provider response`), {
        name: 'BadRequestError',
        status,
        error: { message: 'Reference image dimensions are unsupported.' },
      });
      expect(error).not.toBeInstanceOf(ApiError);
      expect(mapGoogleVertexUnknownError(error)).toMatchObject({
        code,
        retryable,
      });
      if (status === 400)
        expect(mapGoogleVertexUnknownError(error).userMessage).toBe(
          'Reference image dimensions are unsupported.',
        );
    },
  );

  it('reads a nested Interactions error body without displaying response headers', () => {
    const error = Object.assign(new Error('400 response body'), {
      statusCode: 400,
      error: { error: { message: 'Only one start image is allowed.' } },
      headers: { authorization: 'must-not-display' },
    });
    const mapped = mapGoogleVertexUnknownError(error);
    expect(mapped.userMessage).toBe('Only one start image is allowed.');
    expect(JSON.stringify(mapped)).not.toContain('must-not-display');
  });
  it('does not expose a response object when an HTTP error has no message', () => {
    const mapped = mapGoogleVertexUnknownError({
      status: 400,
      headers: { authorization: 'must-not-display' },
      error: { request: { apiKey: 'also-private' } },
    });
    expect(mapped).toMatchObject({
      code: 'VALIDATION_ERROR',
      retryable: false,
    });
    expect(mapped.userMessage).toBe('Unknown provider error');
    expect(JSON.stringify(mapped)).not.toMatch(/must-not-display|also-private/);
  });

  it('recognizes the installed SDK Interactions error from a mocked HTTP response', async () => {
    const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: {
            code: 400,
            message: 'Reference image dimensions are unsupported.',
            status: 'INVALID_ARGUMENT',
          },
        },
        { status: 400 },
      ),
    );
    try {
      const sdk = new GoogleGenAI({ apiKey: 'fixture-not-a-real-key' });
      const error: unknown = await sdk.interactions
        .create(
          {
            model: 'gemini-omni-flash-preview',
            input: 'Fixture',
          },
          { maxRetries: 0 },
        )
        .then(
          () => {
            throw new Error('Expected the fixture HTTP rejection');
          },
          (error: unknown) => error,
        );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ApiError);
      expect(mapGoogleVertexUnknownError(error)).toMatchObject({
        code: 'VALIDATION_ERROR',
        retryable: false,
        userMessage: 'Reference image dimensions are unsupported.',
      });
    } finally {
      fetcher.mockRestore();
    }
  });
});
