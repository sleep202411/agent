import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingOrderStatus,
  BillingOrderType,
  BillingPriceInterval,
  BillingProductType,
  BillingSiteRegion,
  BillingSubjectType,
  BillingSubscriptionStatus,
  EntitlementGrantStatus,
  PaymentIntentKind,
  PaymentIntentStatus,
  PaymentProvider,
  PaymentProviderEventStatus,
  Prisma,
  WalletAccountStatus,
  WalletLedgerEntryType,
  WalletOwnerType,
  WalletTransactionStatus,
  WorkspaceMemberRole,
  type BillingOrder,
  type BillingPaymentIntent,
  type BillingPrice,
  type BillingCatalogItem,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import type { CreateBillingCheckoutInput, ListBillingPricesQuery } from './dto';
import { PaymentProviderRegistry } from './payment-provider-registry.service';
import type { HostedCheckoutResult } from './providers/payment-provider';

type PriceWithItem = BillingPrice & { item: BillingCatalogItem };
type OrderWithPrice = BillingOrder & { price: BillingPrice };

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly permissions: WorkspacePermissionService,
  ) {}

  async listPrices(query: ListBillingPricesQuery) {
    const siteRegion =
      query.siteRegion ??
      siteRegionFromEnv(process.env.NEXT_PUBLIC_SITE_REGION);
    const prices = await this.prisma.billingPrice.findMany({
      where: {
        isActive: query.includeInactive ? undefined : true,
        archivedAt: query.includeInactive ? undefined : null,
        currency: query.currency,
        item: {
          siteRegion,
          isActive: query.includeInactive ? undefined : true,
          archivedAt: query.includeInactive ? undefined : null,
          productType: query.productType as BillingProductType | undefined,
        },
      },
      include: { item: true },
      orderBy: [{ amountMinor: 'asc' }, { createdAt: 'asc' }],
    });

    return { prices: prices.map((price) => this.priceDto(price)) };
  }

  async createCheckout(user: AuthUser, input: CreateBillingCheckoutInput) {
    this.assertReturnUrlAllowed(input.successUrl);
    this.assertReturnUrlAllowed(input.backUrl);

    const price = await this.prisma.billingPrice.findFirst({
      where: {
        id: input.priceId,
        isActive: true,
        archivedAt: null,
        item: { isActive: true, archivedAt: null },
      },
      include: { item: true },
    });
    if (!price) {
      throw new NotFoundException({
        code: 'BILLING_PRICE_NOT_FOUND',
        msg: 'Billing price not found.',
      });
    }
    if (!price.providerPriceId) {
      throw new ConflictException({
        code: 'BILLING_PRICE_PROVIDER_ID_MISSING',
        msg: 'Billing price is missing the provider price id.',
      });
    }

    const subject = await this.resolveCheckoutSubject(user, price, input);
    const provider = price.provider;
    const adapter = this.providerRegistry.get(provider);
    const quantity = input.quantity;
    const amountMinor = price.amountMinor * BigInt(quantity);
    const requestId = randomUUID();
    const orderNo = createOrderNo();
    const orderType = orderTypeForPrice(price);

    const order = await this.prisma.billingOrder.create({
      data: {
        orderNo,
        userId: user.userId,
        workspaceId: subject.workspaceId,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        siteRegion: price.item.siteRegion,
        orderType,
        status: BillingOrderStatus.pending_payment,
        itemId: price.itemId,
        priceId: price.id,
        provider,
        currency: price.currency,
        amountMinor,
        quantity,
        description: price.item.name,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        metadata: {
          checkout: {
            successUrl: input.successUrl,
            backUrl: input.backUrl,
          },
        },
      },
    });

    const mode =
      price.interval === BillingPriceInterval.one_time
        ? 'PAYMENT'
        : 'SUBSCRIPTION';
    let checkout: HostedCheckoutResult;
    try {
      checkout = await adapter.createHostedCheckout({
        requestId,
        mode,
        successUrl: input.successUrl,
        backUrl: input.backUrl,
        lineItems: [
          {
            providerPriceId: price.providerPriceId,
            quantity,
          },
        ],
        metadata: {
          fizzdragon_order_id: order.id,
          fizzdragon_order_no: order.orderNo,
          fizzdragon_user_id: user.userId,
          fizzdragon_subject_type: subject.subjectType,
          fizzdragon_subject_id: subject.subjectId,
        },
      });
    } catch (err) {
      await this.prisma.billingOrder.update({
        where: { id: order.id },
        data: {
          status: BillingOrderStatus.failed,
          metadata: {
            ...(order.metadata as Record<string, unknown>),
            providerError:
              err instanceof Error ? err.message : 'Provider checkout failed.',
          },
        },
      });
      throw err;
    }

    const paymentIntent = await this.prisma.billingPaymentIntent.create({
      data: {
        orderId: order.id,
        provider,
        kind: PaymentIntentKind.hosted_checkout,
        status: PaymentIntentStatus.requires_action,
        requestId,
        providerCheckoutId: checkout.providerCheckoutId,
        providerCustomerId: checkout.providerCustomerId,
        providerSubscriptionId: checkout.providerSubscriptionId,
        providerInvoiceId: checkout.providerInvoiceId,
        checkoutUrl: checkout.checkoutUrl,
        currency: order.currency,
        amountMinor: order.amountMinor,
        providerStatus: checkout.providerStatus,
        providerPayload: checkout.raw as Prisma.InputJsonValue,
        expiresAt: checkout.expiresAt ?? order.expiresAt,
      },
    });

    return {
      order: this.orderDto(order),
      paymentIntent: this.paymentIntentDto(paymentIntent),
    };
  }

  async getOrder(user: AuthUser, orderId: string) {
    const order = await this.prisma.billingOrder.findFirst({
      where: { id: orderId },
      include: { paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'BILLING_ORDER_NOT_FOUND',
        msg: 'Billing order not found.',
      });
    }
    if (order.userId !== user.userId) {
      if (!order.workspaceId) {
        throw new ForbiddenException({
          code: 'BILLING_ORDER_ACCESS_DENIED',
          msg: 'You do not have access to this billing order.',
        });
      }
      await this.permissions.requireWorkspaceRole(
        user.userId,
        order.workspaceId,
        WorkspaceMemberRole.billing,
      );
    }

    return {
      order: this.orderDto(order),
      paymentIntent: order.paymentIntents[0]
        ? this.paymentIntentDto(order.paymentIntents[0])
        : null,
    };
  }

  async handleAirwallexWebhook(input: {
    rawBody: Buffer;
    timestamp?: string | string[];
    signature?: string | string[];
    testSecret?: string | string[];
  }) {
    const adapter = this.providerRegistry.get(PaymentProvider.airwallex);
    const verification = adapter.verifyWebhook(input);
    const payload = JSON.parse(input.rawBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    const providerEventId = providerEventKey(payload, input.rawBody);
    const eventType = eventTypeFromPayload(payload);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`billing:airwallex:event:${providerEventId}`})::bigint)
      `;

      const existing = await tx.billingPaymentProviderEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: PaymentProvider.airwallex,
            providerEventId,
          },
        },
      });
      if (existing?.status === PaymentProviderEventStatus.processed) {
        return { received: true, deduped: true };
      }

      const match = await this.matchPaymentIntent(tx, payload);
      const providerEvent =
        existing ??
        (await tx.billingPaymentProviderEvent.create({
          data: {
            provider: PaymentProvider.airwallex,
            providerEventId,
            eventType,
            orderId: match?.orderId ?? null,
            paymentIntentId: match?.id ?? null,
            payload: {
              ...payload,
              fizzdragon: {
                signatureSkipped: verification.signatureSkipped,
              },
            } as Prisma.InputJsonValue,
          },
        }));

      if (!match) {
        await tx.billingPaymentProviderEvent.update({
          where: { id: providerEvent.id },
          data: {
            status: PaymentProviderEventStatus.ignored,
            processedAt: new Date(),
            error: 'No matching payment intent found.',
          },
        });
        return { received: true, matched: false };
      }

      await this.applyProviderEvent(tx, match, eventType, payload);
      await tx.billingPaymentProviderEvent.update({
        where: { id: providerEvent.id },
        data: {
          status: PaymentProviderEventStatus.processed,
          processedAt: new Date(),
        },
      });
      return { received: true, matched: true };
    });
  }

  private async applyProviderEvent(
    tx: Prisma.TransactionClient,
    intent: BillingPaymentIntent,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const providerStatus = stringAt(payload, ['data', 'status']);
    if (isPaymentSucceededEvent(eventType, providerStatus)) {
      await tx.billingPaymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.succeeded,
          providerStatus: providerStatus ?? eventType,
          providerPayload: payload as Prisma.InputJsonValue,
          providerInvoiceId:
            stringAt(payload, ['data', 'invoice_id']) ??
            stringAt(payload, ['data', 'id']) ??
            intent.providerInvoiceId,
          providerSubscriptionId:
            stringAt(payload, ['data', 'subscription_id']) ??
            intent.providerSubscriptionId,
          completedAt: now,
        },
      });
      const order = await tx.billingOrder.findUniqueOrThrow({
        where: { id: intent.orderId },
        include: { price: true },
      });
      const providerSubscriptionId =
        stringAt(payload, ['data', 'subscription_id']) ??
        intent.providerSubscriptionId;
      if (
        providerSubscriptionId &&
        order.orderType === BillingOrderType.subscription_checkout
      ) {
        await this.upsertSubscriptionFromProviderEvent(
          tx,
          order,
          providerSubscriptionId,
          payload,
          now,
        );
      }
      await this.markOrderPaidAndFulfill(tx, order, now);
      return;
    }

    if (isPaymentFailedEvent(eventType, providerStatus)) {
      await tx.billingPaymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.failed,
          providerStatus: providerStatus ?? eventType,
          providerPayload: payload as Prisma.InputJsonValue,
        },
      });
      await tx.billingOrder.updateMany({
        where: {
          id: intent.orderId,
          status: {
            in: [
              BillingOrderStatus.draft,
              BillingOrderStatus.pending_payment,
              BillingOrderStatus.failed,
            ],
          },
        },
        data: { status: BillingOrderStatus.failed, version: { increment: 1 } },
      });
    }
  }

  private async markOrderPaidAndFulfill(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
    now: Date,
  ): Promise<void> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:order:${order.id}`})::bigint)
    `;

    const current = await tx.billingOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { price: true },
    });
    if (current.status === BillingOrderStatus.fulfilled) return;

    await tx.billingOrder.update({
      where: { id: current.id },
      data: {
        status: BillingOrderStatus.paid,
        paidAt: current.paidAt ?? now,
        version: { increment: 1 },
      },
    });

    if (current.price.grantsWalletAmount) {
      await this.creditWalletGrantForOrderTx(tx, current);
    }
    if (current.price.grantsPlanKey) {
      await tx.entitlementGrant.upsert({
        where: {
          sourceType_sourceId: {
            sourceType: 'billing_order',
            sourceId: current.id,
          },
        },
        create: {
          subjectType: current.subjectType,
          subjectId: current.subjectId,
          planKey: current.price.grantsPlanKey,
          status: EntitlementGrantStatus.active,
          sourceType: 'billing_order',
          sourceId: current.id,
          startsAt: now,
          endsAt: grantEndsAt(now, current.price.grantDurationDays),
          metadata: {
            orderNo: current.orderNo,
            priceId: current.priceId,
          },
        },
        update: {
          status: EntitlementGrantStatus.active,
          startsAt: now,
          endsAt: grantEndsAt(now, current.price.grantDurationDays),
        },
      });
    }

    await tx.billingOrder.update({
      where: { id: current.id },
      data: {
        status: BillingOrderStatus.fulfilled,
        fulfilledAt: now,
        version: { increment: 1 },
      },
    });
  }

  private async upsertSubscriptionFromProviderEvent(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
    providerSubscriptionId: string,
    payload: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    const currentPeriodStart =
      dateAt(payload, ['data', 'current_period_start']) ??
      dateAt(payload, ['data', 'period_start']);
    const currentPeriodEnd =
      dateAt(payload, ['data', 'current_period_end']) ??
      dateAt(payload, ['data', 'period_end']);
    const existing = await tx.billingSubscription.findFirst({
      where: {
        provider: order.provider,
        providerSubscriptionId,
      },
    });
    const data = {
      userId: order.userId,
      workspaceId: order.workspaceId,
      subjectType: order.subjectType,
      subjectId: order.subjectId,
      provider: order.provider,
      providerSubscriptionId,
      status: BillingSubscriptionStatus.active,
      priceId: order.priceId,
      planKey: order.price.grantsPlanKey,
      currentPeriodStart: currentPeriodStart ?? now,
      currentPeriodEnd,
      metadata: {
        initialOrderId: order.id,
        initialOrderNo: order.orderNo,
      },
    };
    if (existing) {
      await tx.billingSubscription.update({
        where: { id: existing.id },
        data,
      });
      return;
    }
    await tx.billingSubscription.create({ data });
  }

  private async creditWalletGrantForOrderTx(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
  ): Promise<void> {
    if (!order.price.grantsWalletCurrency || !order.price.grantsWalletAmount) {
      return;
    }
    const ownerType =
      order.subjectType === BillingSubjectType.workspace
        ? WalletOwnerType.workspace
        : WalletOwnerType.user;

    const account = await tx.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency: {
          ownerType,
          ownerId: order.subjectId,
          currency: order.price.grantsWalletCurrency,
        },
      },
      create: {
        ownerType,
        ownerId: order.subjectId,
        currency: order.price.grantsWalletCurrency,
        status: WalletAccountStatus.active,
      },
      update: {},
    });

    const idempotencyKey = `billing_order:${order.id}:wallet_grant:${order.price.grantsWalletCurrency}`;
    const existing = await tx.walletTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return;

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${account.id}`})::bigint)
    `;

    const lockedAccount = await tx.walletAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    if (lockedAccount.status !== WalletAccountStatus.active) {
      throw new ConflictException({
        code: 'WALLET_ACCOUNT_NOT_ACTIVE',
        msg: 'Wallet account is not active.',
      });
    }

    const amount = order.price.grantsWalletAmount * BigInt(order.quantity);
    const nextAvailable = lockedAccount.availableBalance + amount;
    const transaction = await tx.walletTransaction.create({
      data: {
        status: WalletTransactionStatus.posted,
        sourceType: 'billing_order',
        sourceId: order.id,
        idempotencyKey,
        actorUserId: order.userId,
        workspaceId: order.workspaceId,
        description: `${order.price.grantsWalletCurrency} top-up from order ${order.orderNo}`,
        metadata: {
          orderNo: order.orderNo,
          priceId: order.priceId,
        },
      },
    });

    await tx.walletLedgerEntry.create({
      data: {
        transactionId: transaction.id,
        accountId: lockedAccount.id,
        entryType: WalletLedgerEntryType.credit,
        currency: lockedAccount.currency,
        amount,
        availableDelta: amount,
        heldDelta: 0n,
        availableBalanceAfter: nextAvailable,
        heldBalanceAfter: lockedAccount.heldBalance,
        reason: `billing_${order.price.grantsWalletCurrency}_topup`,
      },
    });

    await tx.walletAccount.update({
      where: { id: lockedAccount.id },
      data: {
        availableBalance: nextAvailable,
        version: { increment: 1 },
      },
    });
  }

  private async matchPaymentIntent(
    tx: Prisma.TransactionClient,
    payload: Record<string, unknown>,
  ): Promise<BillingPaymentIntent | null> {
    const providerCheckoutId =
      stringAt(payload, ['data', 'billing_checkout_id']) ??
      stringAt(payload, ['data', 'checkout_id']) ??
      (eventTypeFromPayload(payload).startsWith('billing_checkout.')
        ? stringAt(payload, ['data', 'id'])
        : null);
    const providerPaymentIntentId =
      stringAt(payload, ['data', 'payment_intent_id']) ??
      (eventTypeFromPayload(payload).startsWith('payment_intent.')
        ? stringAt(payload, ['data', 'id'])
        : null);
    const providerInvoiceId =
      stringAt(payload, ['data', 'invoice_id']) ??
      (eventTypeFromPayload(payload).startsWith('invoice.')
        ? stringAt(payload, ['data', 'id'])
        : null);
    const orderId = stringAt(payload, [
      'data',
      'metadata',
      'fizzdragon_order_id',
    ]);

    const or: Prisma.BillingPaymentIntentWhereInput[] = [];
    if (orderId) or.push({ orderId });
    if (providerCheckoutId) or.push({ providerCheckoutId });
    if (providerPaymentIntentId) or.push({ providerPaymentIntentId });
    if (providerInvoiceId) or.push({ providerInvoiceId });

    if (or.length === 0) return null;

    return tx.billingPaymentIntent.findFirst({
      where: {
        provider: PaymentProvider.airwallex,
        OR: or,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async resolveCheckoutSubject(
    user: AuthUser,
    price: PriceWithItem,
    input: CreateBillingCheckoutInput,
  ): Promise<{
    subjectType: BillingSubjectType;
    subjectId: string;
    workspaceId: string | null;
  }> {
    if (price.subjectType === BillingSubjectType.workspace) {
      if (!input.workspaceId) {
        throw new BadRequestException({
          code: 'WORKSPACE_REQUIRED_FOR_TEAM_PRICE',
          msg: 'A workspace id is required for this billing price.',
        });
      }
      await this.permissions.requireWorkspaceRole(
        user.userId,
        input.workspaceId,
        WorkspaceMemberRole.billing,
      );
      return {
        subjectType: BillingSubjectType.workspace,
        subjectId: input.workspaceId,
        workspaceId: input.workspaceId,
      };
    }

    return {
      subjectType: BillingSubjectType.user,
      subjectId: user.userId,
      workspaceId: null,
    };
  }

  private assertReturnUrlAllowed(rawUrl: string): void {
    const url = new URL(rawUrl);
    const allowed = allowedReturnOrigins();
    if (!allowed.has(url.origin)) {
      throw new BadRequestException({
        code: 'BILLING_RETURN_URL_NOT_ALLOWED',
        msg: 'Billing return URL origin is not allowed.',
      });
    }
  }

  private priceDto(price: PriceWithItem) {
    return {
      id: price.id,
      itemId: price.itemId,
      productType: price.item.productType,
      code: price.item.code,
      name: price.item.name,
      description: price.item.description,
      siteRegion: price.item.siteRegion,
      provider: price.provider,
      currency: price.currency,
      amountMinor: price.amountMinor.toString(),
      interval: price.interval,
      subjectType: price.subjectType,
      grantsWalletCurrency: price.grantsWalletCurrency,
      grantsWalletAmount: price.grantsWalletAmount?.toString() ?? null,
      grantsPlanKey: price.grantsPlanKey,
      grantDurationDays: price.grantDurationDays,
      isActive: price.isActive && price.item.isActive,
      metadata: price.metadata,
    };
  }

  private orderDto(order: BillingOrder) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      orderType: order.orderType,
      userId: order.userId,
      workspaceId: order.workspaceId,
      subjectType: order.subjectType,
      subjectId: order.subjectId,
      provider: order.provider,
      currency: order.currency,
      amountMinor: order.amountMinor.toString(),
      quantity: order.quantity,
      description: order.description,
      paidAt: order.paidAt?.toISOString() ?? null,
      fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
      expiresAt: order.expiresAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private paymentIntentDto(intent: BillingPaymentIntent) {
    return {
      id: intent.id,
      orderId: intent.orderId,
      provider: intent.provider,
      kind: intent.kind,
      status: intent.status,
      checkoutUrl: intent.checkoutUrl,
      clientSecret: intent.clientSecret,
      providerStatus: intent.providerStatus,
      expiresAt: intent.expiresAt?.toISOString() ?? null,
      completedAt: intent.completedAt?.toISOString() ?? null,
      createdAt: intent.createdAt.toISOString(),
      updatedAt: intent.updatedAt.toISOString(),
    };
  }
}

function orderTypeForPrice(price: PriceWithItem): BillingOrderType {
  if (price.item.productType === BillingProductType.bubble_pack) {
    return BillingOrderType.bubble_topup;
  }
  if (price.item.productType === BillingProductType.community_point_pack) {
    return BillingOrderType.community_point_topup;
  }
  if (price.interval === BillingPriceInterval.one_time) {
    return BillingOrderType.membership_purchase;
  }
  return BillingOrderType.subscription_checkout;
}

function providerEventKey(payload: Record<string, unknown>, rawBody: Buffer) {
  const id = stringAt(payload, ['id']);
  if (id) return id;
  return createHash('sha256').update(rawBody).digest('hex');
}

function eventTypeFromPayload(payload: Record<string, unknown>) {
  return (
    stringAt(payload, ['name']) ??
    stringAt(payload, ['type']) ??
    stringAt(payload, ['event_type']) ??
    'unknown'
  );
}

function isPaymentSucceededEvent(
  eventType: string,
  providerStatus?: string | null,
): boolean {
  const normalizedStatus = providerStatus?.toUpperCase();
  return (
    eventType === 'invoice.payment.paid' ||
    eventType === 'payment_intent.succeeded' ||
    eventType === 'billing_checkout.completed' ||
    normalizedStatus === 'SUCCEEDED' ||
    normalizedStatus === 'COMPLETED' ||
    normalizedStatus === 'PAID'
  );
}

function isPaymentFailedEvent(
  eventType: string,
  providerStatus?: string | null,
): boolean {
  const normalizedStatus = providerStatus?.toUpperCase();
  return (
    eventType.endsWith('.failed') ||
    eventType.endsWith('.cancelled') ||
    eventType.endsWith('.canceled') ||
    normalizedStatus === 'FAILED' ||
    normalizedStatus === 'CANCELLED' ||
    normalizedStatus === 'CANCELED' ||
    normalizedStatus === 'EXPIRED'
  );
}

function grantEndsAt(now: Date, days: number | null): Date | null {
  if (!days) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

function createOrderNo(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return `FD${stamp}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function stringAt(
  value: Record<string, unknown>,
  path: string[],
): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' && current.trim() ? current : null;
}

function dateAt(value: Record<string, unknown>, path: string[]): Date | null {
  const raw = stringAt(value, path);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function siteRegionFromEnv(value: string | undefined): BillingSiteRegion {
  return value === 'cn' ? BillingSiteRegion.cn : BillingSiteRegion.global;
}

function allowedReturnOrigins(): Set<string> {
  const configured = process.env.BILLING_ALLOWED_RETURN_ORIGINS?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const origins = new Set(configured ?? []);
  for (const value of [
    process.env.WEB_BASE_URL,
    process.env.PUBLIC_WEB_URL,
    process.env.NEXT_PUBLIC_WEB_BASE_URL,
  ]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore invalid env values; explicit request URL validation still fails.
    }
  }
  origins.add('https://fizzdragon.com');
  origins.add('https://studio.fizzdragon.com');
  origins.add('https://fizzdragon.fizzspace.cn');
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:9527');
    origins.add('http://127.0.0.1:9527');
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }
  return origins;
}
