import { AirwallexProvider } from './airwallex.provider';
import type { CreateHostedCheckoutInput } from './payment-provider';

/**
 * Guards the Airwallex hosted-checkout request body. The create call rejects
 * with a 400 unless mode-specific data is attached:
 *   - PAYMENT      → invoice_data (one-off invoice built on completion)
 *   - SUBSCRIPTION → subscription_data ("subscription_data must be provided for
 *                    SUBSCRIPTION mode in checkout")
 * The SUBSCRIPTION omission silently broke every recurring-membership checkout
 * (community / studio) — see the comment in createHostedCheckout.
 */
describe('AirwallexProvider.createHostedCheckout', () => {
  const ORIGINAL_ENV = process.env.AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID;

  function baseInput(
    mode: 'PAYMENT' | 'SUBSCRIPTION',
  ): CreateHostedCheckoutInput {
    return {
      requestId: 'req_1',
      mode,
      successUrl: 'https://fizzdragon.com/billing/success',
      backUrl: 'https://fizzdragon.com/billing',
      lineItems: [
        {
          providerPriceId: 'pri_test',
          internalPriceId: 'price-1',
          name: 'Community Membership',
          currency: 'USD',
          amountMinor: 999n,
          quantity: 1,
        },
      ],
      metadata: { fizzdragon_order_id: 'order-1' },
    };
  }

  function buildProviderAndCapture() {
    const provider = new AirwallexProvider();
    jest
      .spyOn(
        provider as unknown as { getAccessToken: () => Promise<string> },
        'getAccessToken',
      )
      .mockResolvedValue('tok');
    const requestSpy = jest
      .spyOn(
        provider as unknown as {
          request: (...args: unknown[]) => Promise<unknown>;
        },
        'request',
      )
      .mockResolvedValue({
        id: 'co_1',
        url: 'https://pay.example',
        status: 'CREATED',
      });
    return { provider, requestSpy };
  }

  function createCallBody(
    requestSpy: jest.SpyInstance<Promise<unknown>, unknown[]>,
  ): Record<string, unknown> {
    const call = requestSpy.mock.calls.find(
      ([path]) => path === '/api/v1/billing_checkouts/create',
    );
    expect(call).toBeDefined();
    return (call![1] as { body: Record<string, unknown> }).body;
  }

  beforeEach(() => {
    process.env.AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID = 'acct_test';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL_ENV === undefined) {
      delete process.env.AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID;
    } else {
      process.env.AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID = ORIGINAL_ENV;
    }
  });

  it('attaches subscription_data (and no invoice_data) for SUBSCRIPTION mode', async () => {
    const { provider, requestSpy } = buildProviderAndCapture();

    await provider.createHostedCheckout(baseInput('SUBSCRIPTION'));

    const body = createCallBody(requestSpy);
    expect(body.mode).toBe('SUBSCRIPTION');
    expect(body).toHaveProperty('subscription_data');
    // Indefinite auto-renew: empty on purpose — no `duration` cap, no trial.
    expect(body.subscription_data).toEqual({});
    expect(body).not.toHaveProperty('invoice_data');
  });

  it('attaches invoice_data (and no subscription_data) for PAYMENT mode', async () => {
    const { provider, requestSpy } = buildProviderAndCapture();

    await provider.createHostedCheckout(baseInput('PAYMENT'));

    const body = createCallBody(requestSpy);
    expect(body.mode).toBe('PAYMENT');
    expect(body).toHaveProperty('invoice_data');
    expect(body.invoice_data).toEqual({ currency: 'USD' });
    expect(body).not.toHaveProperty('subscription_data');
  });
});
