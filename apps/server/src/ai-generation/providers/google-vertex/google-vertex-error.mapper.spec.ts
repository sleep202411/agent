import { ApiError } from '@google/genai';
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
});
