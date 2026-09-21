import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createDecipheriv,
  createSign,
  createVerify,
  randomUUID,
} from 'node:crypto';
import { PaymentProvider } from '@prisma/client';

import type {
  CreateHostedCheckoutInput,
  CreateProviderRefundInput,
  CreateProviderRefundResult,
  HostedCheckoutResult,
  PaymentProviderAdapter,
  PaymentProviderCapabilities,
  ProviderWebhookVerification,
} from './payment-provider';

/**
 * WeChat Pay APIv3 — APP支付 (native mobile App payment) for the CN cell.
 *
 * Implemented FRESH against the official v3 docs (not ported from the legacy
 * Java code), raw Node `crypto` only (house pattern, mirrors AirwallexProvider —
 * no vendor SDK on the money path). Merchant runs 微信支付公钥模式 (publicKeyId +
 * WeChat public key) — so OUTGOING requests are signed with the MERCHANT private
 * key + merchant cert serial, while INCOMING notifications are verified with the
 * WeChat public key selected by the `Wechatpay-Serial` header.
 *
 * Flow: createHostedCheckout → POST /v3/pay/transactions/app → prepay_id →
 * server builds the 4-line app-invoke signature → the mobile app calls the WeChat
 * OpenSDK with those params → WeChat async-POSTs the encrypted notification to
 * notify_url → verifyAndDecryptNotification → the billing service fulfils the
 * order (which triggers referral commission). Amounts are integer 分 (cents).
 *
 * Config is env-only (secrets never in code). Missing config → a clear 503 at
 * call time, never a silent misfire.
 */

const V3_HOST = 'https://api.mch.weixin.qq.com';
const APP_TRANSACTIONS_PATH = '/v3/pay/transactions/app'; // APP支付 (native mobile app)
const NATIVE_TRANSACTIONS_PATH = '/v3/pay/transactions/native'; // 扫码/QR (web, PC)
const REFUND_PATH = '/v3/refund/domestic/refunds';
/** Reject notifications whose signed timestamp drifts beyond this (replay defence). */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/** The decrypted `resource` of a payment notification (subset we act on). */
export interface WechatTransaction {
  out_trade_no: string;
  transaction_id?: string;
  trade_state: string; // SUCCESS | REFUND | NOTPAY | CLOSED | REVOKED | USERPAYING | PAYERROR
  trade_type?: string; // "APP"
  success_time?: string;
  amount?: { total?: number; payer_total?: number; currency?: string };
  payer?: { openid?: string };
  attach?: string;
}

export interface WechatRefundNotification {
  mchid: string;
  out_trade_no: string;
  out_refund_no: string;
  refund_id: string;
  refund_status: 'SUCCESS' | 'CLOSED' | 'PROCESSING' | 'ABNORMAL';
  amount: { total: number; refund: number };
}

/** Acceptance may have happened: retain the refund reservation for reconciliation. */
export class WechatRefundUnconfirmedException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'WECHAT_PAY_REFUND_UNCONFIRMED',
      msg: 'WeChat refund submission could not be confirmed. Check the existing refund before retrying.',
    });
  }
}

/** The 8 fields the mobile WeChat OpenSDK needs (`WXApi.sendReq`). */
export interface WechatAppInvokeParams {
  appId: string;
  partnerId: string;
  prepayId: string;
  /** Fixed literal. Android field is `packageValue`, iOS `package` — same value. */
  packageValue: 'Sign=WXPay';
  nonceStr: string;
  timeStamp: string; // Unix SECONDS
  signType: 'RSA';
  sign: string;
}

interface WechatConfig {
  // Per-scene appids — each required only for its own product, so one being
  // pending (e.g. the 移动应用 appid awaiting registration) never blocks the other.
  mpAppId?: string; // 公众号 appid — 扫码/Native (web). WECHAT_PAY_MP_APP_ID
  appId?: string; // 开放平台 移动应用 appid — APP支付. WECHAT_PAY_APP_ID
  mchId: string;
  merchantSerial: string; // merchant API cert serial (uppercase hex)
  privateKey: string; // apiclient_key.pem (PKCS#8) — used to SIGN requests + app-invoke
  apiV3Key: string; // 32-byte APIv3 secret — used to DECRYPT the notification resource
  publicKeyId: string; // 微信支付公钥ID ("PUB_KEY_ID_...") — matched against Wechatpay-Serial
  wechatPublicKey: string; // 微信支付公钥 PEM — used to VERIFY notification signatures
  notifyUrl: string; // public HTTPS callback (no query string)
}

@Injectable()
export class WechatPayProvider implements PaymentProviderAdapter {
  readonly provider = PaymentProvider.wechat_pay;
  readonly capabilities: PaymentProviderCapabilities = {
    hostedCheckout: true, // 扫码 → code_url (web QR); APP支付 → app-invoke params
    subscriptionCheckout: false, // 委托代扣 is a separate, permission-gated build
    subscriptionCancel: false,
    paymentIntent: false,
    priceSync: false,
    couponSync: false,
    refund: true,
    webhookVerification: true,
  };

  private readonly logger = new Logger(WechatPayProvider.name);

  /** Resolve config lazily so a non-CN deployment can boot without WeChat creds. */
  private config(): WechatConfig {
    // Core creds are always required (fail loud). The two appids are per-scene
    // and validated at call time — see requireAppId — so the 扫码 (web) path can
    // run while the 移动应用 appid for APP支付 is still being registered.
    const core = {
      mchId: process.env.WECHAT_PAY_MCH_ID,
      merchantSerial: process.env.WECHAT_PAY_MERCHANT_SERIAL,
      privateKey: normalizePem(process.env.WECHAT_PAY_PRIVATE_KEY),
      apiV3Key: process.env.WECHAT_PAY_APIV3_KEY,
      publicKeyId: process.env.WECHAT_PAY_PUBLIC_KEY_ID,
      wechatPublicKey: normalizePem(process.env.WECHAT_PAY_PUBLIC_KEY),
      notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL,
    };
    const missing = Object.entries(core)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length) {
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_NOT_CONFIGURED',
        msg: `WeChat Pay is missing config: ${missing.join(', ')}`,
      });
    }
    return {
      ...(core as Omit<WechatConfig, 'mpAppId' | 'appId'>),
      mpAppId: process.env.WECHAT_PAY_MP_APP_ID || undefined,
      appId: process.env.WECHAT_PAY_APP_ID || undefined,
    };
  }

  // ─── Checkout (下单 + app-invoke signature) ────────────────────────────────

  async createHostedCheckout(
    input: CreateHostedCheckoutInput,
  ): Promise<HostedCheckoutResult> {
    const cfg = this.config();
    if (input.mode !== 'PAYMENT') {
      // 委托代扣 (app-with-contract) is a separate, permission-gated build.
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_SUBSCRIPTION_UNSUPPORTED',
        msg: 'WeChat Pay subscription (委托代扣) is not enabled yet.',
      });
    }

    const totalMinor = input.lineItems.reduce(
      (sum, li) => sum + li.amountMinor * BigInt(li.quantity),
      0n,
    );
    const currency = input.lineItems[0]?.currency ?? 'CNY';
    if (currency !== 'CNY') {
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_CURRENCY_UNSUPPORTED',
        msg: `WeChat Pay only settles CNY (got ${currency}).`,
      });
    }
    // out_trade_no must be [0-9a-zA-Z_-|*]{6,32}, unique per mch, and the join key
    // the notification + 查单 carry back — so it MUST be our order number. Callers
    // pass it as `fizzdragon_order_no` (createOrderNo(): "FD" + stamp + hex, a valid
    // ≤32-char out_trade_no). Fail loud if absent rather than mint a UUID that would
    // orphan the paid order (the notification/查单 would never match back).
    const outTradeNo = requireOutTradeNo(input.metadata.fizzdragon_order_no);
    const description = (input.lineItems[0]?.name ?? 'FizzDragon').slice(
      0,
      127,
    );

    const baseBody = {
      mchid: cfg.mchId,
      description,
      out_trade_no: outTradeNo,
      notify_url: cfg.notifyUrl,
      amount: { total: Number(totalMinor), currency: 'CNY' },
      ...(input.metadata.attach ? { attach: input.metadata.attach } : {}),
    };

    // Scene picks the WeChat product: `app` → APP支付 (returns signed app-invoke
    // params for the native OpenSDK); anything else → 扫码/Native (returns a
    // code_url the web renders as a QR). Default 扫码 so the web path works before
    // the 移动应用 appid for APP支付 is registered.
    if (input.metadata.wechat_scene === 'app') {
      const appId = requireAppId(cfg.appId, 'WECHAT_PAY_APP_ID', 'APP支付');
      const body = JSON.stringify({ appid: appId, ...baseBody });
      const resp = await this.postTransaction(APP_TRANSACTIONS_PATH, cfg, body);
      const prepayId =
        typeof resp.prepay_id === 'string' ? resp.prepay_id : undefined;
      if (!prepayId) {
        throw new ServiceUnavailableException({
          code: 'WECHAT_PAY_NO_PREPAY_ID',
          msg: 'WeChat Pay APP下单 returned no prepay_id.',
        });
      }
      const appInvoke = this.buildAppInvoke(cfg, appId, prepayId);
      // No redirect URL for APP支付; the client reads raw.appInvoke (surfaced as
      // paymentIntent.providerData) and hands it to the native WeChat OpenSDK.
      return {
        providerCheckoutId: outTradeNo,
        checkoutUrl: '',
        providerStatus: 'PENDING',
        raw: {
          prepayId,
          appInvoke: appInvoke as unknown as Record<string, unknown>,
        },
      };
    }

    // 扫码/Native (web) — the default; uses the 公众号 appid.
    const appId = requireAppId(cfg.mpAppId, 'WECHAT_PAY_MP_APP_ID', '扫码支付');
    const body = JSON.stringify({ appid: appId, ...baseBody });
    const resp = await this.postTransaction(
      NATIVE_TRANSACTIONS_PATH,
      cfg,
      body,
    );
    const codeUrl =
      typeof resp.code_url === 'string' ? resp.code_url : undefined;
    if (!codeUrl) {
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_NO_CODE_URL',
        msg: 'WeChat Pay 扫码下单 returned no code_url.',
      });
    }
    // The web renders this `weixin://wxpay/bizpayurl?...` code_url as a QR; payment
    // is confirmed via the shared callback + 查单 reconcile. Surfaced via
    // checkoutUrl (the existing client-facing field).
    return {
      providerCheckoutId: outTradeNo,
      checkoutUrl: codeUrl,
      providerStatus: 'PENDING',
      raw: { codeUrl },
    };
  }

  /** Signed POST to a v3 transactions endpoint; returns the parsed JSON body. */
  private async postTransaction(
    path: string,
    cfg: WechatConfig,
    body: string,
  ): Promise<Record<string, unknown>> {
    const auth = this.authorizationHeader(cfg, 'POST', path, body);
    let res: Response;
    try {
      res = await fetch(`${V3_HOST}${path}`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'fizzdragon-server/1.0',
        },
        body,
      });
    } catch (e) {
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_UNREACHABLE',
        msg: `WeChat Pay request failed: ${e instanceof Error ? e.message : e}`,
      });
    }
    const text = await res.text();
    if (!res.ok) {
      this.logger.error(`WeChat 下单 failed ${res.status}: ${text}`);
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_ORDER_FAILED',
        msg: `WeChat Pay 下单 failed (${res.status}).`,
      });
    }
    return safeJson<Record<string, unknown>>(text) ?? {};
  }

  /** APP端二次签名 — the params the native SDK invokes with. */
  private buildAppInvoke(
    cfg: WechatConfig,
    appId: string,
    prepayId: string,
  ): WechatAppInvokeParams {
    const nonceStr = randomNonce();
    const timeStamp = String(unixSeconds());
    // Signed message = appId\n timeStamp\n nonceStr\n prepayId\n (4 lines, each + \n).
    const message = `${appId}\n${timeStamp}\n${nonceStr}\n${prepayId}\n`;
    const sign = createSign('RSA-SHA256')
      .update(message, 'utf8')
      .sign(cfg.privateKey, 'base64');
    return {
      appId,
      partnerId: cfg.mchId,
      prepayId,
      packageValue: 'Sign=WXPay',
      nonceStr,
      timeStamp,
      signType: 'RSA',
      sign,
    };
  }

  /** v3 request Authorization header (WECHATPAY2-SHA256-RSA2048). */
  private authorizationHeader(
    cfg: WechatConfig,
    method: string,
    pathAndQuery: string,
    body: string,
  ): string {
    const nonceStr = randomNonce();
    const timestamp = String(unixSeconds());
    // Signed message = METHOD\n URL\n timestamp\n nonce\n body\n (5 lines, each + \n).
    const message = `${method}\n${pathAndQuery}\n${timestamp}\n${nonceStr}\n${body}\n`;
    const signature = createSign('RSA-SHA256')
      .update(message, 'utf8')
      .sign(cfg.privateKey, 'base64');
    return (
      `WECHATPAY2-SHA256-RSA2048 ` +
      `mchid="${cfg.mchId}",` +
      `nonce_str="${nonceStr}",` +
      `signature="${signature}",` +
      `timestamp="${timestamp}",` +
      `serial_no="${cfg.merchantSerial}"`
    );
  }

  // ─── Notification: verify (公钥模式) + AES-256-GCM decrypt ──────────────────

  /**
   * Verify a WeChat v3 signature. Async notifications AND API response bodies are
   * signed the same way — `timestamp\n nonce\n body\n` with the WeChat public key
   * selected by Wechatpay-Serial (公钥模式 ⇒ our publicKeyId). Throws on any missing
   * header / unknown serial / stale timestamp / bad signature.
   */
  private verifyMessageSignature(
    cfg: WechatConfig,
    input: {
      serial?: string;
      signature?: string;
      timestamp?: string;
      nonce?: string;
      signatureType?: string;
      rawBody: Buffer;
    },
  ): void {
    const { serial, signature, timestamp, nonce, signatureType, rawBody } =
      input;
    if (!serial || !signature || !timestamp || !nonce) {
      throw new UnauthorizedException({
        code: 'WECHAT_PAY_SIG_HEADERS_MISSING',
        msg: 'WeChat Pay signature headers are missing.',
      });
    }
    if (signatureType && signatureType !== 'WECHATPAY2-SHA256-RSA2048') {
      throw new UnauthorizedException({
        code: 'WECHAT_PAY_SIGTYPE_INVALID',
        msg: `Unexpected Wechatpay-Signature-Type ${signatureType}.`,
      });
    }
    // 公钥模式: Wechatpay-Serial is our own publicKeyId; verify with the WeChat
    // public key. (证书模式 would carry a platform-cert serial instead.)
    if (serial !== cfg.publicKeyId) {
      throw new UnauthorizedException({
        code: 'WECHAT_PAY_SERIAL_UNKNOWN',
        msg: `Wechatpay-Serial ${serial} does not match the configured public key id.`,
      });
    }
    const tsMs = Number.parseInt(timestamp, 10) * 1000;
    if (
      !Number.isFinite(tsMs) ||
      Math.abs(Date.now() - tsMs) > TIMESTAMP_TOLERANCE_MS
    ) {
      throw new UnauthorizedException({
        code: 'WECHAT_PAY_TIMESTAMP_STALE',
        msg: 'WeChat Pay signature timestamp is outside the accepted tolerance.',
      });
    }
    const message = `${timestamp}\n${nonce}\n${rawBody.toString('utf8')}\n`;
    const ok = createVerify('RSA-SHA256')
      .update(message, 'utf8')
      .verify(cfg.wechatPublicKey, signature, 'base64');
    if (!ok) {
      throw new UnauthorizedException({
        code: 'WECHAT_PAY_SIGNATURE_INVALID',
        msg: 'WeChat Pay signature verification failed.',
      });
    }
  }

  /**
   * 查单 — GET the order by out_trade_no. The response transaction is PLAINTEXT
   * (only the async-notification `resource` is AES-GCM encrypted), so this works
   * WITHOUT the APIv3 key — the reconcile backstop for when the callback can't
   * decrypt or is missed. Verifies the response signature before trusting it.
   * Returns null on 404 (order not yet known at WeChat) so the caller keeps polling.
   */
  async queryOrder(outTradeNo: string): Promise<WechatTransaction | null> {
    const cfg = this.config();
    const no = requireOutTradeNo(outTradeNo);
    const pathAndQuery = `/v3/pay/transactions/out-trade-no/${no}?mchid=${cfg.mchId}`;
    let res: Response;
    try {
      res = await fetch(`${V3_HOST}${pathAndQuery}`, {
        method: 'GET',
        headers: {
          Authorization: this.authorizationHeader(cfg, 'GET', pathAndQuery, ''),
          Accept: 'application/json',
          'User-Agent': 'fizzdragon-server/1.0',
        },
      });
    } catch (e) {
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_UNREACHABLE',
        msg: `WeChat Pay query failed: ${e instanceof Error ? e.message : e}`,
      });
    }
    const rawBody = Buffer.from(await res.arrayBuffer());
    if (res.status === 404) return null; // ORDER_NOT_EXIST — not paid / unknown yet
    if (!res.ok) {
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_QUERY_FAILED',
        msg: `WeChat Pay query failed (${res.status}): ${rawBody.toString('utf8')}`,
      });
    }
    this.verifyMessageSignature(cfg, {
      serial: res.headers.get('Wechatpay-Serial') ?? undefined,
      signature: res.headers.get('Wechatpay-Signature') ?? undefined,
      timestamp: res.headers.get('Wechatpay-Timestamp') ?? undefined,
      nonce: res.headers.get('Wechatpay-Nonce') ?? undefined,
      signatureType: res.headers.get('Wechatpay-Signature-Type') ?? undefined,
      rawBody,
    });
    const tx = safeJson<WechatTransaction>(rawBody.toString('utf8'));
    if (!tx?.out_trade_no || !tx.trade_state) {
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_QUERY_BAD_BODY',
        msg: 'WeChat Pay query returned a malformed transaction.',
      });
    }
    return tx;
  }

  /**
   * Verify a WeChat payment notification's signature and decrypt its `resource`.
   * WeChat-specific (the generic `verifyWebhook` interface lacks the nonce/serial
   * headers WeChat requires) — the billing webhook route calls this directly.
   * Throws Unauthorized on any signature/timestamp/serial/decrypt failure.
   */
  verifyAndDecryptNotification(input: {
    serial?: string;
    signature?: string;
    timestamp?: string;
    nonce?: string;
    signatureType?: string;
    rawBody: Buffer;
  }): WechatTransaction | WechatRefundNotification {
    const cfg = this.config();
    this.verifyMessageSignature(cfg, input);
    const { rawBody } = input;

    const envelope = safeJson<{
      resource?: {
        ciphertext?: string;
        nonce?: string;
        associated_data?: string;
      };
    }>(rawBody.toString('utf8'));
    const resource = envelope?.resource;
    if (!resource?.ciphertext || !resource.nonce) {
      throw new UnauthorizedException({
        code: 'WECHAT_PAY_NOTIFY_NO_RESOURCE',
        msg: 'WeChat Pay notification has no resource to decrypt.',
      });
    }
    const plaintext = this.decryptResource(
      cfg.apiV3Key,
      resource.nonce,
      resource.associated_data ?? '',
      resource.ciphertext,
    );
    const decoded = safeJson<Record<string, unknown>>(plaintext);
    if (decoded && 'refund_status' in decoded) {
      const refund = decoded as unknown as WechatRefundNotification;
      if (
        refund.mchid !== cfg.mchId ||
        ![refund.out_trade_no, refund.out_refund_no, refund.refund_id].every(
          (value) => typeof value === 'string' && value.trim().length > 0,
        ) ||
        !['SUCCESS', 'CLOSED', 'PROCESSING', 'ABNORMAL'].includes(
          refund.refund_status,
        ) ||
        !Number.isSafeInteger(refund.amount?.total) ||
        refund.amount.total <= 0 ||
        !Number.isSafeInteger(refund.amount?.refund) ||
        refund.amount.refund <= 0 ||
        refund.amount.refund > refund.amount.total
      ) {
        throw new UnauthorizedException({
          code: 'WECHAT_PAY_REFUND_BAD_RESOURCE',
          msg: 'Invalid WeChat refund notification.',
        });
      }
      return refund;
    }
    const tx = decoded as unknown as WechatTransaction | undefined;
    if (!tx?.out_trade_no || !tx.trade_state) {
      throw new UnauthorizedException({
        code: 'WECHAT_PAY_NOTIFY_BAD_RESOURCE',
        msg: 'Decrypted WeChat Pay notification is malformed.',
      });
    }
    return tx;
  }

  /** AES-256-GCM decrypt of a notification/response resource (APIv3 key). */
  private decryptResource(
    apiV3Key: string,
    nonce: string,
    associatedData: string,
    ciphertextB64: string,
  ): string {
    // APIv3 key + nonce are used as RAW ASCII (utf8), NOT base64-decoded; only the
    // ciphertext is base64. The last 16 bytes of the ciphertext are the GCM tag.
    const key = Buffer.from(apiV3Key, 'utf8');
    const cipherBuf = Buffer.from(ciphertextB64, 'base64');
    const authTag = cipherBuf.subarray(cipherBuf.length - 16);
    const data = cipherBuf.subarray(0, cipherBuf.length - 16);
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(nonce, 'utf8'),
      );
      decipher.setAuthTag(authTag);
      decipher.setAAD(Buffer.from(associatedData, 'utf8'));
      return Buffer.concat([decipher.update(data), decipher.final()]).toString(
        'utf8',
      );
    } catch (e) {
      // A wrong APIv3 key or a tampered payload fails the GCM tag at final().
      throw new UnauthorizedException({
        code: 'WECHAT_PAY_NOTIFY_DECRYPT_FAILED',
        msg: `WeChat Pay resource decryption failed: ${e instanceof Error ? e.message : e}`,
      });
    }
  }

  // ─── Refund ────────────────────────────────────────────────────────────────

  async createRefund(
    input: CreateProviderRefundInput,
  ): Promise<CreateProviderRefundResult> {
    const cfg = this.config();
    const total = input.originalAmountMinor;
    if (
      total === undefined ||
      total <= 0n ||
      input.amountMinor <= 0n ||
      input.amountMinor > total ||
      total > BigInt(Number.MAX_SAFE_INTEGER) ||
      input.currency !== 'CNY'
    ) {
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_REFUND_INVALID_AMOUNT',
        msg: 'WeChat refund requires the original CNY order total and a valid refund amount.',
      });
    }
    // Recorded before the provider call, so even an early callback can match it.
    const outRefundNo = requireOutTradeNo(
      input.metadata.fizzdragon_refund_no ?? '',
    );
    const body = JSON.stringify({
      out_trade_no: input.providerPaymentIntentId, // our order no = WeChat out_trade_no
      out_refund_no: outRefundNo,
      reason: input.reason.slice(0, 80),
      notify_url: cfg.notifyUrl,
      amount: {
        refund: Number(input.amountMinor),
        total: Number(total),
        currency: 'CNY',
      },
    });
    const auth = this.authorizationHeader(cfg, 'POST', REFUND_PATH, body);
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${V3_HOST}${REFUND_PATH}`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'fizzdragon-server/1.0',
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      text = await res.text();
    } catch {
      throw new WechatRefundUnconfirmedException();
    }
    if (!res.ok) {
      if (res.status >= 500 || res.status === 408)
        throw new WechatRefundUnconfirmedException();
      throw new ServiceUnavailableException({
        code: 'WECHAT_PAY_REFUND_FAILED',
        msg: `WeChat Pay refund failed (${res.status}): ${text}`,
      });
    }
    const parsed = safeJson<{
      refund_id?: unknown;
      status?: unknown;
      out_refund_no?: unknown;
      out_trade_no?: unknown;
    }>(text);
    if (
      !parsed ||
      typeof parsed.refund_id !== 'string' ||
      !parsed.refund_id.trim() ||
      typeof parsed.status !== 'string' ||
      !['SUCCESS', 'CLOSED', 'PROCESSING', 'ABNORMAL'].includes(
        parsed.status,
      ) ||
      parsed.out_refund_no !== outRefundNo ||
      parsed.out_trade_no !== input.providerPaymentIntentId
    ) {
      throw new WechatRefundUnconfirmedException();
    }
    return {
      providerRefundId: parsed.refund_id,
      providerStatus: parsed.status,
      providerPaymentIntentId: input.providerPaymentIntentId,
      raw: parsed,
    };
  }

  // ─── Generic interface method (WeChat verifies via verifyAndDecrypt) ────────

  /**
   * The generic adapter hook does NOT carry the nonce/serial headers WeChat
   * needs, so the WeChat webhook route uses `verifyAndDecryptNotification`
   * instead. This exists only to satisfy the interface; it never runs on the
   * WeChat path.
   */
  verifyWebhook(): ProviderWebhookVerification {
    throw new ServiceUnavailableException({
      code: 'WECHAT_PAY_USE_VERIFY_AND_DECRYPT',
      msg: 'WeChat Pay notifications are verified via verifyAndDecryptNotification.',
    });
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const OUT_TRADE_NO_RE = /^[0-9a-zA-Z_\-|*]{6,32}$/;

function requireOutTradeNo(candidate: string): string {
  const value = (candidate ?? '').slice(0, 32);
  if (!OUT_TRADE_NO_RE.test(value)) {
    throw new ServiceUnavailableException({
      code: 'WECHAT_PAY_BAD_OUT_TRADE_NO',
      msg: `Order number "${candidate}" is not a valid WeChat out_trade_no ([0-9a-zA-Z_-|*]{6,32}).`,
    });
  }
  return value;
}

/** Assert the per-scene appid is configured; fail loud naming the missing env. */
function requireAppId(
  value: string | undefined,
  envName: string,
  product: string,
): string {
  if (!value) {
    throw new ServiceUnavailableException({
      code: 'WECHAT_PAY_APPID_MISSING',
      msg: `WeChat Pay ${product} requires ${envName} to be configured.`,
    });
  }
  return value;
}

/** Env-stored PEMs lose real newlines; accept either literal or \n-escaped. */
function normalizePem(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

function unixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function randomNonce(): string {
  return randomUUID().replace(/-/g, '');
}

function safeJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
