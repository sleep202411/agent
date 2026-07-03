import {
  redactAssetRecord,
  signBytePlusRequest,
  type BytePlusAssetRecord,
} from './byteplus-assets-client';

const SIGN_ARGS = {
  accessKeyId: 'AKLT-test-key-id',
  secretAccessKey: 'test-secret-key',
  host: 'ark.ap-southeast-1.byteplusapi.com',
  action: 'GetAsset',
  version: '2024-01-01',
  region: 'ap-southeast-1',
  service: 'ark',
  body: JSON.stringify({ Id: 'asset-test-1', ProjectName: 'default' }),
  xDate: '20260702T000000Z',
};

describe('signBytePlusRequest', () => {
  it('builds the documented canonical request (ModelArk wire format)', () => {
    const { canonicalRequest, stringToSign } = signBytePlusRequest(SIGN_ARGS);
    expect(canonicalRequest).toBe(
      [
        'POST',
        '/',
        'Action=GetAsset&Version=2024-01-01',
        'content-type:application/json',
        'host:ark.ap-southeast-1.byteplusapi.com',
        'x-content-sha256:a673aedcfb88ce619b767ab5636fb6e72d185305f768d6acd867b3707aab24e1',
        'x-date:20260702T000000Z',
        '',
        'content-type;host;x-content-sha256;x-date',
        'a673aedcfb88ce619b767ab5636fb6e72d185305f768d6acd867b3707aab24e1',
      ].join('\n'),
    );
    expect(stringToSign.split('\n')).toEqual([
      'HMAC-SHA256',
      '20260702T000000Z',
      '20260702/ap-southeast-1/ark/request',
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
  });

  it('emits the documented Authorization header with a stable signature', () => {
    const { headers } = signBytePlusRequest(SIGN_ARGS);
    // Golden vector: pins the raw-SK HMAC chain (date→region→service→
    // 'request') so an accidental AWS4-style prefix or scope reorder fails.
    expect(headers.Authorization).toBe(
      'HMAC-SHA256 Credential=AKLT-test-key-id/20260702/ap-southeast-1/ark/request, ' +
        'SignedHeaders=content-type;host;x-content-sha256;x-date, ' +
        'Signature=e43caa5ed009d221d1d6212e30c614639bb4c6ea3512886b17a2321e168cdf2a',
    );
    expect(headers['X-Date']).toBe('20260702T000000Z');
    expect(headers['X-Content-Sha256']).toBe(
      'a673aedcfb88ce619b767ab5636fb6e72d185305f768d6acd867b3707aab24e1',
    );
  });

  it('changes the signature when the body changes', () => {
    const a = signBytePlusRequest(SIGN_ARGS).headers.Authorization;
    const b = signBytePlusRequest({
      ...SIGN_ARGS,
      body: JSON.stringify({ Id: 'asset-test-2', ProjectName: 'default' }),
    }).headers.Authorization;
    expect(a).not.toBe(b);
  });
});

describe('redactAssetRecord', () => {
  it('strips the presigned URL and keeps status/ids/error', () => {
    const record: BytePlusAssetRecord = {
      Id: 'asset-1',
      URL: 'https://signed.example.com/face.png?sig=SECRET',
      Status: 'Failed',
      GroupId: 'group-1',
      Error: { Code: 'FaceMismatch', Message: 'different person' },
    };
    const safe = redactAssetRecord(record);
    expect(safe).not.toHaveProperty('URL');
    expect(safe).toMatchObject({
      Id: 'asset-1',
      Status: 'Failed',
      Error: { Code: 'FaceMismatch' },
    });
  });
});
