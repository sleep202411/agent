import {
  mapBailianHttpError,
  mapBailianTaskError,
} from './bailian-error.mapper';

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

describe('mapBailianTaskError async status classification', () => {
  function taskStatus(output: Record<string, unknown>) {
    return {
      output: { task_id: 't-1', task_status: 'FAILED', ...output },
      request_id: 'r-3',
    };
  }

  it('marks a deterministic input rejection terminal (poster-as-reference incident)', () => {
    // wan3.0-video rejected a reference_video whose URL resolved to the
    // asset's auto-generated poster jpg instead of the original mp4.
    const error = mapBailianTaskError(
      'wan3.0-video',
      taskStatus({
        code: 'InvalidParameter',
        message:
          "https://r2.fizzdragon.com/posters/x/916714d3214b5c7a0fd0.jpg format jpg is not supported. Supported formats: ['mp4', 'mov']",
      }),
    );

    expect(error.payload.code).toBe('VALIDATION_ERROR');
    expect(error.payload.retryable).toBe(false);
    expect(error.payload.message).toContain('Alibaba Model Studio job failed');
  });

  it('keeps a transient reference-download flake retryable', () => {
    const error = mapBailianTaskError(
      'wan3.0-video',
      taskStatus({
        code: 'InvalidParameter',
        message:
          'Failed to download video from [https://media.fizzspace.cn/a.mp4]: ',
      }),
    );

    expect(error.payload.code).toBe('PROVIDER_REFERENCE_DOWNLOAD');
    expect(error.payload.retryable).toBe(true);
  });

  it('stays retryable for unrecognized failure codes', () => {
    const error = mapBailianTaskError(
      'wanx2.1-t2i-turbo',
      taskStatus({ code: 'InternalError', message: 'boom' }),
    );

    expect(error.payload.code).toBe('UNKNOWN');
    expect(error.payload.retryable).toBe(true);
  });
});
