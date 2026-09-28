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

export type PurchaseResult = {
  mocked: boolean;
  productId: string;
  /** Present when Nest returned a WeChat Native `weixin://` code to render as a QR. */
  wechatScan?: WechatScanCheckout;
};
