export class PurchaseCancelledError extends Error {
  constructor() {
    super("Purchase cancelled");
    this.name = "PurchaseCancelledError";
  }
}

export type PurchaseResult = {
  mocked: boolean;
  productId: string;
};
