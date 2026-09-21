import { createCipheriv, createSign, generateKeyPairSync } from 'node:crypto';
import {
  WechatPayProvider,
  WechatRefundUnconfirmedException,
} from './wechat-pay.provider';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const cfg = {
  mchId: 'merchant',
  merchantSerial: 'serial',
  publicKeyId: 'key-id',
  privateKey: keys.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString(),
  wechatPublicKey: keys.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString(),
  apiV3Key: '12345678901234567890123456789012',
  notifyUrl: 'https://example.invalid/aurora/billing/webhooks/wechat',
};
const input = {
  requestId: 'intent',
  providerPaymentIntentId: 'order-100',
  amountMinor: 2500n,
  originalAmountMinor: 10000n,
  currency: 'CNY',
  reason: 'partial',
  metadata: { fizzdragon_refund_no: 'RF202609210000001234567890' },
};
const accepted = {
  refund_id: 'wx-refund',
  out_refund_no: input.metadata.fizzdragon_refund_no,
  out_trade_no: input.providerPaymentIntentId,
  status: 'PROCESSING',
};
const notification = {
  mchid: cfg.mchId,
  out_trade_no: accepted.out_trade_no,
  out_refund_no: accepted.out_refund_no,
  refund_id: accepted.refund_id,
  refund_status: 'SUCCESS',
  amount: { refund: 2500, total: 10000 },
};
function signedNotification(payload: unknown) {
  const nonce = '123456789012';
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(cfg.apiV3Key),
    Buffer.from(nonce),
  );
  cipher.setAAD(Buffer.from('refund'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload)),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64');
  const rawBody = Buffer.from(
    JSON.stringify({
      resource: { nonce, associated_data: 'refund', ciphertext },
    }),
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createSign('RSA-SHA256')
    .update(`${timestamp}\n${nonce}\n${rawBody.toString()}\n`)
    .sign(cfg.privateKey, 'base64');
  return { rawBody, timestamp, nonce, signature, serial: cfg.publicKeyId };
}
describe('WeChat refund contracts', () => {
  let provider: WechatPayProvider;
  let fetchMock: jest.Mock<Promise<Response>, Parameters<typeof fetch>>;
  const originalFetch = global.fetch;
  beforeEach(() => {
    provider = new WechatPayProvider();
    jest
      .spyOn(provider as unknown as { config: () => typeof cfg }, 'config')
      .mockReturnValue(cfg);
    fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(accepted))),
      );
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });
  it('sends original total and stable recorded refund number', async () => {
    await provider.createRefund(input);
    await provider.createRefund(input);
    for (const call of fetchMock.mock.calls)
      expect(JSON.parse(call[1]!.body as string) as unknown).toMatchObject({
        amount: { refund: 2500, total: 10000 },
        out_refund_no: accepted.out_refund_no,
      });
  });
  it.each([undefined, 2000n, 0n, BigInt(Number.MAX_SAFE_INTEGER) + 1n])(
    'rejects invalid original total %s before sending',
    async (originalAmountMinor) => {
      await expect(
        provider.createRefund({ ...input, originalAmountMinor }),
      ).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each([
    '<html>bad gateway</html>',
    'null',
    '{}',
    JSON.stringify({ ...accepted, status: 'UNKNOWN' }),
    JSON.stringify({ ...accepted, refund_id: '' }),
    JSON.stringify({ ...accepted, out_trade_no: 'wrong-order' }),
  ])('keeps malformed acknowledgement unconfirmed: %s', async (body) => {
    fetchMock.mockResolvedValueOnce(new Response(body));
    await expect(provider.createRefund(input)).rejects.toBeInstanceOf(
      WechatRefundUnconfirmedException,
    );
  });
  it('keeps lost responses unconfirmed', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection lost'));
    await expect(provider.createRefund(input)).rejects.toBeInstanceOf(
      WechatRefundUnconfirmedException,
    );
  });
  it('decrypts and accepts signed refund notifications', () => {
    expect(
      provider.verifyAndDecryptNotification(signedNotification(notification)),
    ).toEqual(notification);
  });
  it('still accepts signed payment notifications', () => {
    const payment = { out_trade_no: 'order-100', trade_state: 'SUCCESS' };
    expect(
      provider.verifyAndDecryptNotification(signedNotification(payment)),
    ).toEqual(payment);
  });
  it.each([
    { ...notification, mchid: 'other' },
    { ...notification, amount: { ...notification.amount, refund: 2500.5 } },
    { ...notification, refund_status: 'unknown' },
  ])('rejects invalid signed refunds', (payload) => {
    expect(() =>
      provider.verifyAndDecryptNotification(signedNotification(payload)),
    ).toThrow();
  });
  it('rejects invalid signatures', () => {
    expect(() =>
      provider.verifyAndDecryptNotification({
        ...signedNotification(notification),
        signature: 'invalid',
      }),
    ).toThrow();
  });
});
