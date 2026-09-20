import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { BoldSignAgreementProvider } from './boldsign-agreement.provider';

const ENV_KEYS = [
  'BOLDSIGN_ENABLED',
  'BOLDSIGN_API_KEY',
  'BOLDSIGN_API_BASE_URL',
  'BOLDSIGN_CREW_AGREEMENT_TEMPLATE_ID',
  'BOLDSIGN_CREW_AGREEMENT_ROLE_INDEX',
  'BOLDSIGN_WEBHOOK_SECRET',
  'BOLDSIGN_WEBHOOK_TOLERANCE_SECONDS',
  'BOLDSIGN_ARCHIVE_MAX_BYTES',
] as const;

describe('BoldSignAgreementProvider webhook verification', () => {
  const original = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) original.set(key, process.env[key]);
    process.env.BOLDSIGN_ENABLED = 'true';
    process.env.BOLDSIGN_API_KEY = 'api-key';
    process.env.BOLDSIGN_CREW_AGREEMENT_TEMPLATE_ID = 'template-1';
    process.env.BOLDSIGN_WEBHOOK_SECRET = 'webhook-secret';
    process.env.BOLDSIGN_WEBHOOK_TOLERANCE_SECONDS = '300';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of ENV_KEYS) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    original.clear();
  });

  it('accepts a current HMAC-SHA256 signature over the exact raw body', () => {
    const provider = new BoldSignAgreementProvider();
    const timestamp = 1_785_319_200;
    const rawBody = Buffer.from('{"event":{"id":"event-1"}}');
    const signature = sign(timestamp, rawBody);

    expect(() =>
      provider.verifyWebhook(
        rawBody,
        `t=${timestamp}, s0=${signature}`,
        timestamp * 1_000,
      ),
    ).not.toThrow();
  });

  it('accepts the matching rotated signature and rejects tampered payloads', () => {
    const provider = new BoldSignAgreementProvider();
    const timestamp = 1_785_319_200;
    const rawBody = Buffer.from('{"status":"Completed"}');
    const signature = sign(timestamp, rawBody);

    expect(() =>
      provider.verifyWebhook(
        rawBody,
        `t=${timestamp}, s0=${'a'.repeat(64)}, s1=${signature}`,
        timestamp * 1_000,
      ),
    ).not.toThrow();
    expect(() =>
      provider.verifyWebhook(
        Buffer.from('{"status":"Declined"}'),
        `t=${timestamp}, s0=${signature}`,
        timestamp * 1_000,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects replayed events outside the configured time window', () => {
    const provider = new BoldSignAgreementProvider();
    const timestamp = 1_785_319_200;
    const rawBody = Buffer.from('{}');

    expect(() =>
      provider.verifyWebhook(
        rawBody,
        `t=${timestamp}, s0=${sign(timestamp, rawBody)}`,
        (timestamp + 301) * 1_000,
      ),
    ).toThrow(BadRequestException);
  });

  it('does not enable agreement sending until webhook verification is configured', () => {
    const provider = new BoldSignAgreementProvider();
    expect(provider.isConfigured()).toBe(true);
    expect(provider.canSync()).toBe(true);

    delete process.env.BOLDSIGN_WEBHOOK_SECRET;
    expect(provider.isConfigured()).toBe(false);
    expect(provider.canSync()).toBe(true);
    expect(() => provider.verifyWebhook(Buffer.from('{}'), undefined)).toThrow(
      ServiceUnavailableException,
    );
  });

  it('stays disabled by default even when stale local credentials exist', () => {
    delete process.env.BOLDSIGN_ENABLED;
    const provider = new BoldSignAgreementProvider();

    expect(provider.isEnabled()).toBe(false);
    expect(provider.isConfigured()).toBe(false);
    expect(provider.canSync()).toBe(false);
  });

  it('fails bootstrap when an enabled deployment is only partially configured', () => {
    delete process.env.BOLDSIGN_WEBHOOK_SECRET;
    const provider = new BoldSignAgreementProvider();

    expect(() => provider.onModuleInit()).toThrow(/BOLDSIGN_WEBHOOK_SECRET/);
  });

  it('labels every template send with the stable agreement id for reconciliation', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ documentId: 'document-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const provider = new BoldSignAgreementProvider();

    await expect(
      provider.sendFromTemplate({
        agreementId: '01910d50-4c88-7c78-92d4-16892c06a001',
        title: 'Storyboard agreement',
        signerName: 'Mina Chen',
        signerEmail: 'mina@example.com',
      }),
    ).resolves.toBe('document-1');
    const [, request] = fetchMock.mock.calls[0];
    if (typeof request?.body !== 'string') {
      throw new Error('expected BoldSign template payload to be JSON text');
    }
    const requestBody: unknown = JSON.parse(request.body);
    expect(requestBody).toMatchObject({
      Labels: ['fizzdragon-agreement-01910d50-4c88-7c78-92d4-16892c06a001'],
      MetaData: {
        FizzDragonAgreementId: '01910d50-4c88-7c78-92d4-16892c06a001',
      },
    });
    fetchMock.mockRestore();
  });

  it('reconciles an ambiguous send by its stable BoldSign label', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          result: [{ documentId: 'document-1', status: 'WaitingForOthers' }],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const provider = new BoldSignAgreementProvider();

    await expect(
      provider.findDocumentForAgreement('01910d50-4c88-7c78-92d4-16892c06a001'),
    ).resolves.toEqual({
      documentId: 'document-1',
      status: 'WaitingForOthers',
    });
    const requestInput = fetchMock.mock.calls[0]?.[0];
    if (typeof requestInput !== 'string') {
      throw new Error('expected BoldSign request URL to be a string');
    }
    expect(requestInput).toContain(
      'labels=fizzdragon-agreement-01910d50-4c88-7c78-92d4-16892c06a001',
    );
    fetchMock.mockRestore();
  });

  it('creates a short-lived signer-specific embedded signing link', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          signLink:
            'https://app.boldsign.com/document/sign/?documentId=document-1',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const provider = new BoldSignAgreementProvider();
    const now = new Date('2026-07-29T12:00:00.000Z');

    await expect(
      provider.getEmbeddedSigningLink(
        'document-1',
        'mina+crew@example.com',
        now,
      ),
    ).resolves.toEqual({
      signLink: 'https://app.boldsign.com/document/sign/?documentId=document-1',
      expiresAt: new Date('2026-07-29T12:15:00.000Z'),
    });
    const requestInput = fetchMock.mock.calls[0]?.[0];
    if (typeof requestInput !== 'string') {
      throw new Error('expected BoldSign request URL to be a string');
    }
    const requestUrl = new URL(requestInput);
    expect(requestUrl.pathname).toBe('/v1/document/getEmbeddedSignLink');
    expect(requestUrl.searchParams.get('documentId')).toBe('document-1');
    expect(requestUrl.searchParams.get('signerEmail')).toBe(
      'mina+crew@example.com',
    );
    expect(requestUrl.searchParams.get('signLinkValidTill')).toBe(
      '2026-07-29T12:15:00.000Z',
    );
    fetchMock.mockRestore();
  });

  it('rejects insecure embedded signing links returned by the provider', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          signLink: 'http://attacker.test/document/sign/document-1',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const provider = new BoldSignAgreementProvider();

    await expect(
      provider.getEmbeddedSigningLink(
        'document-1',
        'mina@example.com',
        new Date('2026-07-29T12:00:00.000Z'),
      ),
    ).rejects.toThrow(/insecure/);
    fetchMock.mockRestore();
  });

  it.each([null, '5', '2000000'])(
    'cancels oversized PDF downloads with declared length %s',
    async (length) => {
      process.env.BOLDSIGN_ARCHIVE_MAX_BYTES = '1048576';
      let reads = 0;
      const cancel = jest.fn();
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            reads++;
            if (reads <= 3) controller.enqueue(Buffer.alloc(600_000, 65));
            else controller.close();
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      const headers = new Headers({ 'content-type': 'application/pdf' });
      if (length !== null) headers.set('content-length', length);
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(body, { headers }));
      await expect(
        new BoldSignAgreementProvider().downloadSignedDocument('document-1'),
      ).rejects.toThrow(/archive limit/);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(reads).toBe(length === '2000000' ? 0 : 2);
    },
  );

  it('accepts a split PDF exactly at the byte limit', async () => {
    process.env.BOLDSIGN_ARCHIVE_MAX_BYTES = '1048576';
    const expected = Buffer.alloc(1048576, 32);
    expected.write('%PDF-1.7');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(expected.subarray(0, 3));
        controller.enqueue(expected.subarray(3));
        controller.close();
      },
    });
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(body, { headers: { 'content-type': 'application/pdf' } }),
      );
    const artifact = await new BoldSignAgreementProvider().downloadAuditTrail(
      'document-1',
    );
    expect(artifact.bytes).toEqual(expected);
  });

  it('retains the size error when cancellation fails', async () => {
    process.env.BOLDSIGN_ARCHIVE_MAX_BYTES = '1048576';
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1048577));
      },
      cancel() {
        throw new Error('cleanup failed');
      },
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body));
    await expect(
      new BoldSignAgreementProvider().downloadAuditTrail('document-1'),
    ).rejects.toThrow(/archive limit/);
    expect(body.locked).toBe(false);
  });

  it('downloads and validates the signed PDF artifact', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(Buffer.from('%PDF-1.7 signed bytes')), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition':
            "attachment; filename*=UTF-8''Storyboard%20Agreement.pdf",
        },
      }),
    );
    const provider = new BoldSignAgreementProvider();

    const artifact = await provider.downloadSignedDocument('document-1');
    expect(artifact).toMatchObject({
      contentType: 'application/pdf',
      filename: 'Storyboard Agreement.pdf',
    });
    expect(Buffer.isBuffer(artifact.bytes)).toBe(true);
    const [requestInput, request] = fetchMock.mock.calls[0];
    expect(requestInput).toBe(
      'https://api.boldsign.com/v1/document/download?documentId=document-1',
    );
    expect(request?.method).toBe('GET');
    const requestHeaders = new Headers(request?.headers);
    expect(requestHeaders.get('Accept')).toBe('application/pdf');
    expect(requestHeaders.get('X-API-KEY')).toBe('api-key');
    fetchMock.mockRestore();
  });

  it('rejects a non-PDF response from the artifact endpoint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(Buffer.from('{"error":"not a pdf"}')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const provider = new BoldSignAgreementProvider();

    await expect(provider.downloadAuditTrail('document-1')).rejects.toThrow(
      /invalid PDF/,
    );
    fetchMock.mockRestore();
  });
});

function sign(timestamp: number, rawBody: Buffer): string {
  return createHmac('sha256', 'webhook-secret')
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
}
