import { mapBailianHttpError } from './bailian-error.mapper';

describe('mapBailianHttpError reference-download classification', () => {
  it('classifies a transient provider download flake as retryable', () => {
    const error = mapBailianHttpError(
      400,
      JSON.stringify({
        code: 'InvalidParameter',
        message:
          'Failed to download image from [https://media.fizzspace.cn/a.png]: ',
        request_id: 'r-1',
      }),
    );

    expect(error.payload.code).toBe('PROVIDER_REFERENCE_DOWNLOAD');
    expect(error.payload.retryable).toBe(true);
  });

  it('keeps genuine validation errors terminal', () => {
    const error = mapBailianHttpError(
      400,
      JSON.stringify({
        code: 'InvalidParameter',
        message: 'size must be one of ["1024*1024"]',
        request_id: 'r-2',
      }),
    );

    expect(error.payload.code).toBe('VALIDATION_ERROR');
    expect(error.payload.retryable).toBe(false);
  });
});
