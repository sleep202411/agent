export class PurchaseCancelledError extends Error {
  constructor() {
    super("Purchase cancelled");
    this.name = "PurchaseCancelledError";
  }
}

export type WechatScanCheckout = {
  orderId: string;
  codeUrl: string;
};

/** Prefixed Nest-less order id — `WechatScanPay` auto-marks these paid. */
export const MOCK_WECHAT_ORDER_PREFIX = "mock-wechat-";

export type PurchaseResult = {
  mocked: boolean;
  productId: string;
  /** Present when Nest returned a WeChat Native `weixin://` code to render as a QR. */
  wechatScan?: WechatScanCheckout;
};
