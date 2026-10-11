import {
  classifyDocumentAnalysisFailure,
  documentAnalysisProviderDiagnostic,
  readDocumentAnalysisFailure,
} from './document-analysis-failure';

it.each([
  [{ name: 'TimeoutError' }, 'timeout'],
  [
    { name: 'AI_NoObjectGeneratedError', text: 'private script' },
    'invalid_output',
  ],
  [{ statusCode: 401 }, 'provider_auth'],
  [{ statusCode: 429 }, 'provider_limit'],
  [{ statusCode: 503 }, 'provider_unavailable'],
  [{ statusCode: 400 }, 'provider_request'],
  [
    new Error('AI returned duplicate tasks. Analyze the document again.'),
    'duplicates',
  ],
  [new Error('private script or credentials'), 'internal'],
])('classifies failures without serializing raw errors', (error, code) => {
  const failure = classifyDocumentAnalysisFailure(error);
  expect(failure.code).toBe(code);
  expect(JSON.stringify(failure)).not.toContain('private script');
});
it('accepts only known persisted failure codes and reconstructs safe text', () => {
  expect(
    readDocumentAnalysisFailure({
      failure: { code: '__proto__', message: 'secret' },
    }),
  ).toBeNull();
  expect(readDocumentAnalysisFailure({ tasks: [] })).toBeNull();
  expect(
    readDocumentAnalysisFailure({
      failure: { code: 'timeout', message: 'secret' },
    })?.message,
  ).not.toContain('secret');
});

it('retains only safe HTTP status and known provider codes from SDK errors', () => {
  expect(
    documentAnalysisProviderDiagnostic(
      Object.assign(new Error('private script'), {
        statusCode: 400,
        data: {
          error: { code: 'InvalidParameter', message: 'private script' },
        },
        requestBodyValues: { authorization: 'secret' },
      }),
    ),
  ).toEqual({ httpStatus: 400, providerCode: 'InvalidParameter' });
  expect(
    documentAnalysisProviderDiagnostic({
      statusCode: 400,
      data: { error: { code: 'secret document text' } },
    }),
  ).toEqual({ httpStatus: 400 });
  expect(documentAnalysisProviderDiagnostic(null)).toEqual({});
});
