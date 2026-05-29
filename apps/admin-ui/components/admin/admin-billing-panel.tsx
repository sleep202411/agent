"use client";

import { useMemo, useState } from "react";
import {
  IconActivity,
  IconAlertTriangle,
  IconCircleCheck,
  IconCoins,
  IconCreditCard,
  IconDatabase,
  IconCloudUpload,
  IconInfoCircle,
  IconPlus,
  IconRefresh,
  IconReceiptRefund,
  IconScale,
  IconSearch,
  IconTicket,
  IconWallet,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PaymentProvider = "airwallex" | "wechat_pay" | "manual" | "internal";
type BindingStatus = "active" | "inactive" | "sync_pending" | "sync_failed";
type BillingPromotionStatus = "draft" | "active" | "paused" | "archived";
type BillingPromotionDurationType = "once" | "forever" | "repeating";
type BillingOrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "fulfilled"
  | "canceled"
  | "expired"
  | "failed"
  | "refunded"
  | "partially_refunded";
type BillingRefundStatus = "requested" | "provider_pending" | "succeeded" | "failed" | "canceled";
type BillingLedgerJournalType =
  | "payment_capture"
  | "fulfillment_allocation"
  | "settlement"
  | "refund"
  | "chargeback"
  | "revenue_recognition"
  | "provider_fee"
  | "manual_adjustment"
  | "reversal";
type BillingSettlementStatus = "pending" | "reconciled" | "partially_reconciled" | "failed";
type BillingReconciliationStatus = "running" | "completed" | "failed";
type BillingReconciliationItemStatus =
  | "matched"
  | "mismatch"
  | "missing_internal"
  | "missing_provider"
  | "ignored";
type PaymentProviderEventStatus = "received" | "processed" | "ignored" | "failed";

type BillingProviderBinding = {
  id: string;
  provider: PaymentProvider;
  status: BindingStatus;
  providerProductId: string | null;
  providerPriceId: string | null;
  providerMode?: string | null;
  syncError?: string | null;
  lastSyncedAt?: string | null;
  archivedAt?: string | null;
  price?: BillingProviderBindingPrice;
};

type BillingProviderBindingPrice = {
  id: string;
  code: string;
  name: string;
  productType: string;
  currency: string;
  amountMinor: string;
};

type BillingPriceRow = {
  id: string;
  itemId: string;
  code: string;
  name: string;
  productType: string;
  description: string | null;
  currency: string;
  amountMinor: string;
  interval: string;
  subjectType: string;
  grantsWalletCurrency: string | null;
  grantsWalletBalanceKind: string | null;
  grantsWalletAmount: string | null;
  grantsPlanKey: string | null;
  grantDurationDays: number | null;
  isActive: boolean;
  archivedAt: string | null;
  providerBindings: BillingProviderBinding[];
  counts: { orders: number; subscriptions: number };
  updatedAt: string;
};

type BillingPromotionProviderBinding = {
  id: string;
  provider: PaymentProvider;
  status: BindingStatus;
  providerCouponId: string | null;
  syncError?: string | null;
  lastSyncedAt?: string | null;
  archivedAt?: string | null;
};

type BillingPromotionRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: BillingPromotionStatus;
  percentOffBps: number;
  durationType: BillingPromotionDurationType;
  durationCount: number | null;
  durationUnit: string | null;
  appliesProductType: string | null;
  appliesItem: {
    id: string;
    code: string;
    name: string;
    productType: string;
  } | null;
  appliesPrice: {
    id: string;
    code: string;
    name: string;
    currency: string;
    amountMinor: string;
  } | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  maxRedemptionsPerUser: number | null;
  redemptionCount: number;
  archivedAt: string | null;
  providerBindings: BillingPromotionProviderBinding[];
  counts: { redemptions: number };
  updatedAt: string;
};

type BillingOrderRow = {
  id: string;
  orderNo: string;
  idempotencyKey: string;
  status: BillingOrderStatus;
  orderType: string;
  userId: string;
  workspaceId: string | null;
  subjectType: string;
  subjectId: string;
  providerBindingId: string | null;
  provider: PaymentProvider;
  currency: string;
  subtotalAmountMinor: string;
  discountAmountMinor: string;
  amountMinor: string;
  refundedAmountMinor: string;
  refundableAmountMinor: string;
  quantity: number;
  description: string | null;
  paidAt: string | null;
  fulfilledAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  item: {
    id: string;
    code: string;
    name: string;
    productType: string;
  };
  paymentIntent: {
    id: string;
    status: string;
    providerStatus: string | null;
    checkoutUrl: string | null;
    expiresAt: string | null;
  } | null;
  refunds: Array<{
    id: string;
    refundNo: string;
    status: BillingRefundStatus;
    amountMinor: string;
    reasonCode: string;
    providerStatus: string | null;
    createdAt: string;
  }>;
};

type BillingRefundRow = {
  id: string;
  refundNo: string;
  orderId: string;
  orderNo: string;
  paymentIntentId: string | null;
  provider: PaymentProvider;
  status: BillingRefundStatus;
  idempotencyKey: string;
  requestId: string;
  providerRefundId: string | null;
  providerPaymentIntentId: string | null;
  providerStatus: string | null;
  currency: string;
  amountMinor: string;
  reasonCode: string;
  operatorNote: string | null;
  walletReversalCurrency: string | null;
  walletReversalAmount: string | null;
  walletTransactionId: string | null;
  entitlementGrantId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  requestedById: string;
  submittedAt: string | null;
  succeededAt: string | null;
  failedAt: string | null;
  createdAt: string;
  updatedAt: string;
  order: {
    id: string;
    orderNo: string;
    userId: string;
    subjectType: string;
    subjectId: string;
    status: BillingOrderStatus;
    currency: string;
    amountMinor: string;
    refundedAmountMinor: string;
    item: {
      id: string;
      code: string;
      name: string;
      productType: string;
    };
  };
};

type BillingRefundQuoteIssue = {
  code: string;
  msg: string;
};

type BillingRefundQuoteData = {
  order: {
    id: string;
    orderNo: string;
    status: BillingOrderStatus;
    orderType: string;
    provider: PaymentProvider;
    currency: string;
    amountMinor: string;
    refundedAmountMinor: string;
    userId: string;
    subjectType: string;
    subjectId: string;
    paidAt: string | null;
    fulfilledAt: string | null;
    item: {
      id: string;
      code: string;
      name: string;
      productType: string;
    };
    price: {
      id: string;
      grantsWalletCurrency: string | null;
      grantsWalletAmount: string | null;
      grantsPlanKey: string | null;
      grantDurationDays: number | null;
    };
  };
  policy: {
    userSelfServiceAllowed: false;
    adminOnly: true;
    providerSupported: boolean;
    automaticRefundAllowed: boolean;
    calculationMode: "amount" | "percent" | "suggested";
  };
  refundableAmountMinor: string;
  maxPolicyRefundMinor: string;
  suggestedAmountMinor: string;
  requestedAmountMinor: string;
  requestedPercentBps: number | null;
  benefitImpact:
    | {
        type: "none";
        automaticReversalAllowed: boolean;
        description: string;
      }
    | {
        type: "wallet";
        walletCurrency: string;
        totalGrantedAmount: string;
        alreadyReversedAmount: string;
        requestedReversalAmount: string;
        availableBalance: string;
        automaticReversalAllowed: boolean;
        description: string;
      }
    | {
        type: "membership";
        planKey: string;
        startsAt: string;
        endsAt: string | null;
        unusedBps: number;
        revokeEntitlement: boolean;
        automaticReversalAllowed: boolean;
        description: string;
      };
  blockers: BillingRefundQuoteIssue[];
  warnings: BillingRefundQuoteIssue[];
};

type WalletAccountRow = {
  id: string;
  ownerType: string;
  ownerId: string;
  currency: string;
  balanceKind: string;
  status: string;
  availableBalance: string;
  heldBalance: string;
  updatedAt: string;
};

type BillingLedgerAccountRow = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  normalBalance: string;
  currency: string;
  provider: PaymentProvider | null;
  postedDebitMinor: string;
  postedCreditMinor: string;
  balanceMinor: string;
  updatedAt: string;
};

type BillingLedgerJournalRow = {
  id: string;
  journalNo: string;
  journalType: BillingLedgerJournalType;
  status: string;
  provider: PaymentProvider | null;
  currency: string;
  totalDebitMinor: string;
  totalCreditMinor: string;
  sourceType: string;
  sourceId: string | null;
  orderId: string | null;
  description: string | null;
  postedAt: string;
  entries: Array<{
    id: string;
    direction: "debit" | "credit";
    amountMinor: string;
    balanceAfterMinor: string;
    description: string | null;
    account: {
      id: string;
      code: string;
      name: string;
      accountType: string;
      normalBalance: string;
    };
  }>;
};

type BillingSettlementRow = {
  id: string;
  provider: PaymentProvider;
  providerSettlementId: string;
  status: BillingSettlementStatus;
  currency: string;
  grossAmountMinor: string;
  feeAmountMinor: string;
  netAmountMinor: string;
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
  journalCount: number;
  reconciliationItemCount: number;
};

type BillingReconciliationItemRow = {
  id: string;
  status: BillingReconciliationItemStatus;
  issueType: string | null;
  orderId: string | null;
  paymentIntentId: string | null;
  providerEventId: string | null;
  settlementId: string | null;
  providerReference: string | null;
  currency: string;
  providerAmountMinor: string | null;
  internalAmountMinor: string | null;
  differenceMinor: string | null;
  createdAt: string;
};

type BillingReconciliationRunRow = {
  id: string;
  provider: PaymentProvider;
  status: BillingReconciliationStatus;
  currency: string | null;
  periodStart: string;
  periodEnd: string;
  checkedAt: string | null;
  matchedCount: number;
  mismatchCount: number;
  missingInternalCount: number;
  missingProviderCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  openItems: BillingReconciliationItemRow[];
};

type BillingProviderEventRow = {
  id: string;
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  status: PaymentProviderEventStatus;
  orderId: string | null;
  paymentIntentId: string | null;
  refundId: string | null;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
  order: {
    id: string;
    orderNo: string;
    status: BillingOrderStatus;
    userId: string;
    currency: string;
    amountMinor: string;
  } | null;
  paymentIntent: {
    id: string;
    status: string;
    providerStatus: string | null;
    providerCheckoutId: string | null;
    providerPaymentIntentId: string | null;
    completedAt: string | null;
  } | null;
  refund: {
    id: string;
    refundNo: string;
    status: BillingRefundStatus;
    providerRefundId: string | null;
    providerStatus: string | null;
    currency: string;
    amountMinor: string;
  } | null;
  payloadSummary: {
    id: string | null;
    eventType: string;
    dataId: string | null;
    dataStatus: string | null;
    requestId: string | null;
    billingCheckoutId: string | null;
    paymentIntentId: string | null;
    invoiceId: string | null;
    subscriptionId: string | null;
    refundId: string | null;
  } | null;
  ledgerJournals: Array<{
    id: string;
    journalNo: string;
    journalType: BillingLedgerJournalType;
    status: string;
  }>;
};

export type AdminBillingOverviewData = {
  generatedAt: string;
  metrics: {
    activeCatalogItems: number;
    activePrices: number;
    activeProviderBindings: number;
    incompleteProviderBindings: number;
    pendingOrders: number;
    fulfilledOrders7d: number;
    failedOrders7d: number;
    paymentFailures7d: number;
    revenue7d: Array<{ currency: string; amountMinor: string }>;
  };
  providerBindings: BillingProviderBinding[];
  walletAccounts: WalletAccountRow[];
  recentOrders: BillingOrderRow[];
};

export type AdminBillingPricesData = {
  items: BillingPriceRow[];
};

export type AdminBillingPromotionsData = {
  items: BillingPromotionRow[];
};

export type AdminBillingOrdersData = {
  items: BillingOrderRow[];
  nextCursor: string | null;
};

export type AdminBillingRefundsData = {
  items: BillingRefundRow[];
  nextCursor: string | null;
};

export type AdminBillingProviderEventsData = {
  items: BillingProviderEventRow[];
  nextCursor: string | null;
};

export type AdminBillingLedgerOverviewData = {
  generatedAt: string;
  metrics: {
    activeAccounts: number;
    journalCount: number;
    settlementCount: number;
    openReconciliationCount: number;
  };
  accounts: BillingLedgerAccountRow[];
};

export type AdminBillingLedgerJournalsData = {
  items: BillingLedgerJournalRow[];
  nextCursor: string | null;
};

export type AdminBillingSettlementsData = {
  items: BillingSettlementRow[];
  nextCursor: string | null;
};

export type AdminBillingReconciliationRunsData = {
  items: BillingReconciliationRunRow[];
  nextCursor: string | null;
};

const emptyOverview: AdminBillingOverviewData = {
  generatedAt: new Date(0).toISOString(),
  metrics: {
    activeCatalogItems: 0,
    activePrices: 0,
    activeProviderBindings: 0,
    incompleteProviderBindings: 0,
    pendingOrders: 0,
    fulfilledOrders7d: 0,
    failedOrders7d: 0,
    paymentFailures7d: 0,
    revenue7d: [],
  },
  providerBindings: [],
  walletAccounts: [],
  recentOrders: [],
};

const emptyPrices: AdminBillingPricesData = { items: [] };
const emptyPromotions: AdminBillingPromotionsData = { items: [] };
const emptyOrders: AdminBillingOrdersData = { items: [], nextCursor: null };
const emptyRefunds: AdminBillingRefundsData = { items: [], nextCursor: null };
const emptyProviderEvents: AdminBillingProviderEventsData = {
  items: [],
  nextCursor: null,
};
const emptyLedgerOverview: AdminBillingLedgerOverviewData = {
  generatedAt: new Date(0).toISOString(),
  metrics: {
    activeAccounts: 0,
    journalCount: 0,
    settlementCount: 0,
    openReconciliationCount: 0,
  },
  accounts: [],
};
const emptyLedgerJournals: AdminBillingLedgerJournalsData = {
  items: [],
  nextCursor: null,
};
const emptySettlements: AdminBillingSettlementsData = {
  items: [],
  nextCursor: null,
};
const emptyReconciliationRuns: AdminBillingReconciliationRunsData = {
  items: [],
  nextCursor: null,
};

export function AdminBillingPanel({
  siteLabel,
  databaseLabel,
  initialOverview,
  initialPrices,
  initialPromotions,
  initialOrders,
  initialRefunds,
  initialProviderEvents,
  initialLedgerOverview,
  initialLedgerJournals,
  initialSettlements,
  initialReconciliationRuns,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialOverview: AdminBillingOverviewData | null;
  initialPrices: AdminBillingPricesData | null;
  initialPromotions: AdminBillingPromotionsData | null;
  initialOrders: AdminBillingOrdersData | null;
  initialRefunds: AdminBillingRefundsData | null;
  initialProviderEvents: AdminBillingProviderEventsData | null;
  initialLedgerOverview: AdminBillingLedgerOverviewData | null;
  initialLedgerJournals: AdminBillingLedgerJournalsData | null;
  initialSettlements: AdminBillingSettlementsData | null;
  initialReconciliationRuns: AdminBillingReconciliationRunsData | null;
  initialError?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<
    "catalog" | "promotions" | "orders" | "refunds" | "events" | "wallet" | "ledger"
  >("catalog");
  const [overview, setOverview] = useState(initialOverview ?? emptyOverview);
  const [prices, setPrices] = useState(initialPrices ?? emptyPrices);
  const [promotions, setPromotions] = useState(initialPromotions ?? emptyPromotions);
  const [orders, setOrders] = useState(initialOrders ?? emptyOrders);
  const [refunds, setRefunds] = useState(initialRefunds ?? emptyRefunds);
  const [providerEvents, setProviderEvents] = useState(
    initialProviderEvents ?? emptyProviderEvents
  );
  const [refundQuote, setRefundQuote] = useState<BillingRefundQuoteData | null>(null);
  const [ledgerOverview, setLedgerOverview] = useState(
    initialLedgerOverview ?? emptyLedgerOverview
  );
  const [ledgerJournals, setLedgerJournals] = useState(
    initialLedgerJournals ?? emptyLedgerJournals
  );
  const [settlements, setSettlements] = useState(initialSettlements ?? emptySettlements);
  const [reconciliationRuns, setReconciliationRuns] = useState(
    initialReconciliationRuns ?? emptyReconciliationRuns
  );
  const [priceProductType, setPriceProductType] = useState("");
  const [priceProvider, setPriceProvider] = useState("");
  const [promotionStatus, setPromotionStatus] = useState("");
  const [promotionProvider, setPromotionProvider] = useState("");
  const [promotionQuery, setPromotionQuery] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [orderProvider, setOrderProvider] = useState("");
  const [orderQuery, setOrderQuery] = useState("");
  const [refundStatus, setRefundStatus] = useState("");
  const [refundProvider, setRefundProvider] = useState("");
  const [refundQuery, setRefundQuery] = useState("");
  const [providerEventStatus, setProviderEventStatus] = useState("");
  const [providerEventProvider, setProviderEventProvider] = useState("");
  const [providerEventType, setProviderEventType] = useState("");
  const [providerEventQuery, setProviderEventQuery] = useState("");
  const [providerEventIgnoreReasons, setProviderEventIgnoreReasons] = useState<
    Record<string, string>
  >({});
  const [ledgerType, setLedgerType] = useState("");
  const [ledgerProvider, setLedgerProvider] = useState("");
  const [ledgerCurrency, setLedgerCurrency] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const bindingRiskCount = useMemo(
    () =>
      overview.providerBindings.filter(
        (binding) =>
          binding.status === "sync_failed" ||
          (binding.provider === "airwallex" &&
            binding.status === "active" &&
            !binding.providerPriceId)
      ).length,
    [overview.providerBindings]
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [
        nextOverview,
        nextPrices,
        nextPromotions,
        nextOrders,
        nextRefunds,
        nextProviderEvents,
        nextLedgerOverview,
        nextLedgerJournals,
        nextSettlements,
        nextReconciliationRuns,
      ] = await Promise.all([
        requestEnvelope<AdminBillingOverviewData>("/api/admin/billing/overview"),
        requestEnvelope<AdminBillingPricesData>(`/api/admin/billing/prices${priceQueryString()}`),
        requestEnvelope<AdminBillingPromotionsData>(
          `/api/admin/billing/promotions${promotionQueryString()}`
        ),
        requestEnvelope<AdminBillingOrdersData>(`/api/admin/billing/orders${orderQueryString()}`),
        requestEnvelope<AdminBillingRefundsData>(
          `/api/admin/billing/refunds${refundQueryString()}`
        ),
        requestEnvelope<AdminBillingProviderEventsData>(
          `/api/admin/billing/provider-events${providerEventQueryString()}`
        ),
        requestEnvelope<AdminBillingLedgerOverviewData>("/api/admin/billing/ledger/overview"),
        requestEnvelope<AdminBillingLedgerJournalsData>(
          `/api/admin/billing/ledger/journals${ledgerQueryString()}`
        ),
        requestEnvelope<AdminBillingSettlementsData>(
          `/api/admin/billing/ledger/settlements${ledgerQueryString()}`
        ),
        requestEnvelope<AdminBillingReconciliationRunsData>(
          `/api/admin/billing/ledger/reconciliation-runs${ledgerQueryString()}`
        ),
      ]);
      setOverview(nextOverview);
      setPrices(nextPrices);
      setPromotions(nextPromotions);
      setOrders(nextOrders);
      setRefunds(nextRefunds);
      setProviderEvents(nextProviderEvents);
      setLedgerOverview(nextLedgerOverview);
      setLedgerJournals(nextLedgerJournals);
      setSettlements(nextSettlements);
      setReconciliationRuns(nextReconciliationRuns);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshPrices() {
    setLoading(true);
    setError(null);
    try {
      setPrices(
        await requestEnvelope<AdminBillingPricesData>(
          `/api/admin/billing/prices${priceQueryString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshPromotions() {
    setLoading(true);
    setError(null);
    try {
      setPromotions(
        await requestEnvelope<AdminBillingPromotionsData>(
          `/api/admin/billing/promotions${promotionQueryString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshOrders() {
    setLoading(true);
    setError(null);
    try {
      setOrders(
        await requestEnvelope<AdminBillingOrdersData>(
          `/api/admin/billing/orders${orderQueryString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshRefunds() {
    setLoading(true);
    setError(null);
    try {
      setRefunds(
        await requestEnvelope<AdminBillingRefundsData>(
          `/api/admin/billing/refunds${refundQueryString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshProviderEvents() {
    setLoading(true);
    setError(null);
    try {
      setProviderEvents(
        await requestEnvelope<AdminBillingProviderEventsData>(
          `/api/admin/billing/provider-events${providerEventQueryString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleReprocessProviderEvent(eventId: string) {
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/billing/provider-events/${eventId}/reprocess`, {});
      await Promise.all([
        refreshProviderEvents(),
        refreshOrders(),
        refreshRefunds(),
        refreshLedger(),
      ]);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleIgnoreProviderEvent(eventId: string) {
    const reason = providerEventIgnoreReasons[eventId]?.trim();
    if (!reason) {
      setError("请输入忽略原因。");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/billing/provider-events/${eventId}/ignore`, { reason });
      setProviderEventIgnoreReasons((current) => {
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      await refreshProviderEvents();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshLedger() {
    setLoading(true);
    setError(null);
    try {
      const [nextOverview, nextJournals, nextSettlements, nextReconciliationRuns] =
        await Promise.all([
          requestEnvelope<AdminBillingLedgerOverviewData>("/api/admin/billing/ledger/overview"),
          requestEnvelope<AdminBillingLedgerJournalsData>(
            `/api/admin/billing/ledger/journals${ledgerQueryString()}`
          ),
          requestEnvelope<AdminBillingSettlementsData>(
            `/api/admin/billing/ledger/settlements${ledgerQueryString()}`
          ),
          requestEnvelope<AdminBillingReconciliationRunsData>(
            `/api/admin/billing/ledger/reconciliation-runs${ledgerQueryString()}`
          ),
        ]);
      setLedgerOverview(nextOverview);
      setLedgerJournals(nextJournals);
      setSettlements(nextSettlements);
      setReconciliationRuns(nextReconciliationRuns);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePrice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const provider = stringField(form, "provider");
    const walletCurrency = stringField(form, "grantsWalletCurrency");
    const walletAmount = stringField(form, "grantsWalletAmount");
    const planKey = stringField(form, "grantsPlanKey");
    const grantDurationDays = stringField(form, "grantDurationDays");
    try {
      await mutateEnvelope("/api/admin/billing/prices", {
        itemCode: stringField(form, "itemCode"),
        itemName: stringField(form, "itemName"),
        itemDescription: stringField(form, "itemDescription") || undefined,
        productType: stringField(form, "productType"),
        currency: stringField(form, "currency").toUpperCase(),
        amountMinor: stringField(form, "amountMinor"),
        interval: stringField(form, "interval"),
        subjectType: stringField(form, "subjectType"),
        grantsWalletCurrency: walletCurrency || undefined,
        grantsWalletAmount: walletCurrency && walletAmount ? walletAmount : undefined,
        grantsPlanKey: planKey || undefined,
        grantDurationDays: grantDurationDays ? Number(grantDurationDays) : undefined,
        providerBindings: provider
          ? [
              {
                provider,
                status: "sync_pending",
              },
            ]
          : [],
      });
      event.currentTarget.reset();
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncPriceBinding(bindingId: string) {
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/billing/provider-bindings/${bindingId}/sync`, {});
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePromotion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const provider = stringField(form, "provider");
    const percentOff = stringField(form, "percentOff");
    const appliesProductType = stringField(form, "appliesProductType");
    const maxRedemptions = stringField(form, "maxRedemptions");
    const maxRedemptionsPerUser = stringField(form, "maxRedemptionsPerUser");
    try {
      await mutateEnvelope("/api/admin/billing/promotions", {
        code: stringField(form, "code"),
        name: stringField(form, "name"),
        description: stringField(form, "description") || undefined,
        status: stringField(form, "status"),
        percentOffBps: percentOff ? Math.round(Number(percentOff) * 100) : undefined,
        durationType: "once",
        appliesProductType: appliesProductType || undefined,
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
        maxRedemptionsPerUser: maxRedemptionsPerUser ? Number(maxRedemptionsPerUser) : undefined,
        providerBindings: provider
          ? [
              {
                provider,
                status: "sync_pending",
              },
            ]
          : [],
      });
      event.currentTarget.reset();
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handlePromotionStatus(promotionId: string, status: BillingPromotionStatus) {
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/billing/promotions/${promotionId}`, { status }, "PATCH");
      await refreshPromotions();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncPromotionBinding(bindingId: string) {
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/billing/promotion-provider-bindings/${bindingId}/sync`, {});
      await refreshPromotions();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleQuoteRefund(formElement: HTMLFormElement) {
    setLoading(true);
    setError(null);
    try {
      const quote = await mutateEnvelope<BillingRefundQuoteData>(
        "/api/admin/billing/refunds/quote",
        buildRefundQuotePayload(new FormData(formElement))
      );
      setRefundQuote(quote);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRefund(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const payload = buildRefundCreatePayload(form, refundQuote);
      await mutateEnvelope("/api/admin/billing/refunds", {
        ...payload,
        idempotencyKey:
          stringField(form, "idempotencyKey") ||
          (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `refund-${Date.now()}`),
      });
      event.currentTarget.reset();
      setRefundQuote(null);
      await Promise.all([refreshRefunds(), refreshOrders(), refreshLedger()]);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function priceQueryString() {
    const params = new URLSearchParams();
    if (priceProductType) params.set("productType", priceProductType);
    if (priceProvider) params.set("provider", priceProvider);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  function promotionQueryString() {
    const params = new URLSearchParams();
    if (promotionStatus) params.set("status", promotionStatus);
    if (promotionProvider) params.set("provider", promotionProvider);
    if (promotionQuery.trim()) params.set("q", promotionQuery.trim());
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  function orderQueryString() {
    const params = new URLSearchParams();
    if (orderStatus) params.set("status", orderStatus);
    if (orderProvider) params.set("provider", orderProvider);
    if (orderQuery.trim()) params.set("q", orderQuery.trim());
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  function refundQueryString() {
    const params = new URLSearchParams();
    if (refundStatus) params.set("status", refundStatus);
    if (refundProvider) params.set("provider", refundProvider);
    if (refundQuery.trim()) params.set("q", refundQuery.trim());
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  function providerEventQueryString() {
    const params = new URLSearchParams();
    if (providerEventStatus) params.set("status", providerEventStatus);
    if (providerEventProvider) params.set("provider", providerEventProvider);
    if (providerEventType.trim()) params.set("eventType", providerEventType.trim());
    if (providerEventQuery.trim()) params.set("q", providerEventQuery.trim());
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  function ledgerQueryString() {
    const params = new URLSearchParams();
    if (ledgerType) params.set("journalType", ledgerType);
    if (ledgerProvider) params.set("provider", ledgerProvider);
    if (ledgerCurrency.trim()) params.set("currency", ledgerCurrency.trim().toUpperCase());
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[12px] font-medium text-slate-500">
              {siteLabel} · {databaseLabel}
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              订单积分运营台
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              内部商品和价格是事实源，Airwallex 与微信支付只作为 provider binding。
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[620px] xl:grid-cols-4">
            <Metric label="有效商品" value={overview.metrics.activeCatalogItems} />
            <Metric label="有效价格" value={overview.metrics.activePrices} />
            <Metric label="支付映射" value={overview.metrics.activeProviderBindings} />
            <Metric
              label="映射风险"
              value={bindingRiskCount + overview.metrics.incompleteProviderBindings}
              tone="risk"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1">
            <TabButton
              active={activeTab === "catalog"}
              onClick={() => setActiveTab("catalog")}
              icon={IconDatabase}
            >
              商品价格
            </TabButton>
            <TabButton
              active={activeTab === "promotions"}
              onClick={() => setActiveTab("promotions")}
              icon={IconTicket}
            >
              促销券
            </TabButton>
            <TabButton
              active={activeTab === "orders"}
              onClick={() => setActiveTab("orders")}
              icon={IconCreditCard}
            >
              订单支付
            </TabButton>
            <TabButton
              active={activeTab === "refunds"}
              onClick={() => setActiveTab("refunds")}
              icon={IconReceiptRefund}
            >
              退款
            </TabButton>
            <TabButton
              active={activeTab === "events"}
              onClick={() => setActiveTab("events")}
              icon={IconActivity}
            >
              支付事件
            </TabButton>
            <TabButton
              active={activeTab === "wallet"}
              onClick={() => setActiveTab("wallet")}
              icon={IconWallet}
            >
              钱包流水
            </TabButton>
            <TabButton
              active={activeTab === "ledger"}
              onClick={() => setActiveTab("ledger")}
              icon={IconScale}
            >
              资金账本
            </TabButton>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        </div>
      </section>

      {error ? <ErrorBanner message={error} /> : null}

      {activeTab === "catalog" ? (
        <CatalogView
          prices={prices.items}
          productType={priceProductType}
          provider={priceProvider}
          loading={loading}
          onProductTypeChange={setPriceProductType}
          onProviderChange={setPriceProvider}
          onRefresh={() => void refreshPrices()}
          onCreatePrice={handleCreatePrice}
          onSyncBinding={handleSyncPriceBinding}
        />
      ) : null}

      {activeTab === "promotions" ? (
        <PromotionsView
          promotions={promotions.items}
          status={promotionStatus}
          provider={promotionProvider}
          query={promotionQuery}
          loading={loading}
          onStatusChange={setPromotionStatus}
          onProviderChange={setPromotionProvider}
          onQueryChange={setPromotionQuery}
          onRefresh={() => void refreshPromotions()}
          onCreatePromotion={handleCreatePromotion}
          onPromotionStatus={handlePromotionStatus}
          onSyncBinding={handleSyncPromotionBinding}
        />
      ) : null}

      {activeTab === "orders" ? (
        <OrdersView
          orders={orders.items}
          status={orderStatus}
          provider={orderProvider}
          query={orderQuery}
          loading={loading}
          onStatusChange={setOrderStatus}
          onProviderChange={setOrderProvider}
          onQueryChange={setOrderQuery}
          onRefresh={() => void refreshOrders()}
        />
      ) : null}

      {activeTab === "refunds" ? (
        <RefundsView
          refunds={refunds.items}
          quote={refundQuote}
          status={refundStatus}
          provider={refundProvider}
          query={refundQuery}
          loading={loading}
          onStatusChange={setRefundStatus}
          onProviderChange={setRefundProvider}
          onQueryChange={setRefundQuery}
          onRefresh={() => void refreshRefunds()}
          onQuoteRefund={handleQuoteRefund}
          onCreateRefund={handleCreateRefund}
        />
      ) : null}

      {activeTab === "events" ? (
        <ProviderEventsView
          events={providerEvents.items}
          status={providerEventStatus}
          provider={providerEventProvider}
          eventType={providerEventType}
          query={providerEventQuery}
          ignoreReasons={providerEventIgnoreReasons}
          loading={loading}
          onStatusChange={setProviderEventStatus}
          onProviderChange={setProviderEventProvider}
          onEventTypeChange={setProviderEventType}
          onQueryChange={setProviderEventQuery}
          onIgnoreReasonChange={(eventId, reason) =>
            setProviderEventIgnoreReasons((current) => ({ ...current, [eventId]: reason }))
          }
          onRefresh={() => void refreshProviderEvents()}
          onReprocess={handleReprocessProviderEvent}
          onIgnore={handleIgnoreProviderEvent}
        />
      ) : null}

      {activeTab === "wallet" ? (
        <WalletView
          accounts={overview.walletAccounts}
          metrics={overview.metrics}
          recentOrders={overview.recentOrders}
        />
      ) : null}

      {activeTab === "ledger" ? (
        <LedgerView
          overview={ledgerOverview}
          journals={ledgerJournals.items}
          settlements={settlements.items}
          reconciliationRuns={reconciliationRuns.items}
          journalType={ledgerType}
          provider={ledgerProvider}
          currency={ledgerCurrency}
          loading={loading}
          onJournalTypeChange={setLedgerType}
          onProviderChange={setLedgerProvider}
          onCurrencyChange={setLedgerCurrency}
          onRefresh={() => void refreshLedger()}
        />
      ) : null}
    </div>
  );
}

function CatalogView({
  prices,
  productType,
  provider,
  loading,
  onProductTypeChange,
  onProviderChange,
  onRefresh,
  onCreatePrice,
  onSyncBinding,
}: {
  prices: BillingPriceRow[];
  productType: string;
  provider: string;
  loading: boolean;
  onProductTypeChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onRefresh: () => void;
  onCreatePrice: (event: React.FormEvent<HTMLFormElement>) => void;
  onSyncBinding: (bindingId: string) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">商品目录与价格版本</h3>
              <p className="mt-1 text-[12px] text-slate-500">
                社区积分、算力积分和会员套餐统一从内部价格出发。
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[180px_160px_auto]">
              <Select
                value={productType}
                onChange={onProductTypeChange}
                title="按内部商品类型过滤；商品类型决定履约发放的是算力积分、社区积分还是会员权益。"
              >
                <option value="">全部商品类型</option>
                <option
                  value="community_point_pack"
                  title={productTypeHelp("community_point_pack")}
                >
                  社区积分
                </option>
                <option value="bubble_pack" title={productTypeHelp("bubble_pack")}>
                  算力积分
                </option>
                <option value="membership_plan" title={productTypeHelp("membership_plan")}>
                  会员套餐
                </option>
                <option
                  value="team_membership_plan"
                  title={productTypeHelp("team_membership_plan")}
                >
                  团队会员
                </option>
              </Select>
              <Select
                value={provider}
                onChange={onProviderChange}
                title="支付或履约来源。线下确认不是兑换码，内部发放用于平台承担成本的零元订单。"
              >
                <option value="">全部渠道</option>
                <option value="airwallex" title={providerHelp("airwallex")}>
                  Airwallex
                </option>
                <option value="wechat_pay" title={providerHelp("wechat_pay")}>
                  微信支付
                </option>
                <option value="manual" title={providerHelp("manual")}>
                  线下确认
                </option>
                <option value="internal" title={providerHelp("internal")}>
                  内部发放
                </option>
              </Select>
              <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                应用
              </Button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <Th>商品</Th>
                <Th>价格</Th>
                <Th help="订单支付成功后的履约结果：积分到账、会员权益开通，或无自动权益。">
                  权益
                </Th>
                <Th help="内部价格和支付供应商价格/商品 ID 的绑定。Airwallex/微信需要同步，线下确认和内部发放不需要。">
                  Provider Binding
                </Th>
                <Th>销售</Th>
                <Th>状态</Th>
              </tr>
            </thead>
            <tbody>
              {prices.map((price) => (
                <tr key={price.id}>
                  <Td>
                    <p className="text-sm font-medium text-slate-950">{price.name}</p>
                    <p className="mt-0.5 text-[12px] text-slate-500">
                      {price.code} · {productTypeLabel(price.productType)}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-sm font-semibold text-slate-950">
                      {formatMoneyMinor(price.amountMinor, price.currency)}
                    </p>
                    <p className="text-[12px] text-slate-500">
                      {intervalLabel(price.interval)} · {price.subjectType}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-sm text-slate-700">{grantLabel(price)}</p>
                    <p className="text-[12px] text-slate-500">
                      {price.grantDurationDays ? `${price.grantDurationDays} 天` : "长期/一次性"}
                    </p>
                  </Td>
                  <Td>
                    <div className="flex max-w-[360px] flex-wrap gap-1.5">
                      {price.providerBindings.map((binding) => (
                        <ProviderBadge key={binding.id} binding={binding} onSync={onSyncBinding} />
                      ))}
                      {!price.providerBindings.length ? <RiskText>未配置渠道</RiskText> : null}
                    </div>
                  </Td>
                  <Td>
                    <p className="text-sm text-slate-700">{price.counts.orders} 订单</p>
                    <p className="text-[12px] text-slate-500">{price.counts.subscriptions} 订阅</p>
                  </Td>
                  <Td>
                    <StatusPill tone={price.isActive && !price.archivedAt ? "success" : "muted"}>
                      {price.isActive && !price.archivedAt ? "active" : "inactive"}
                    </StatusPill>
                    <p className="mt-1 text-[11px] text-slate-400">{formatDate(price.updatedAt)}</p>
                  </Td>
                </tr>
              ))}
              {!prices.length ? <EmptyRow colSpan={6} label="暂无商品价格" /> : null}
            </tbody>
          </table>
        </div>
      </section>
      <CreatePriceForm loading={loading} onSubmit={onCreatePrice} />
    </div>
  );
}

function CreatePriceForm({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">新建价格</h3>
          <p className="mt-1 text-[12px] text-slate-500">
            商品目录为事实源，渠道价格通过 binding 同步。
          </p>
        </div>
        <IconPlus className="size-4 text-slate-400" />
      </div>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3">
        <FormLabel
          label="商品编码"
          help="内部稳定编码。后续报表、对账和供应商同步都依赖它，创建后不要随意改语义。"
        >
          <TextInput name="itemCode" required placeholder="BUBBLE_1000_USD" />
        </FormLabel>
        <FormLabel
          label="商品名称"
          help="运营后台展示名，不等同于支付供应商侧商品名；同步时会复制到 provider payload。"
        >
          <TextInput name="itemName" required placeholder="1000 算力积分" />
        </FormLabel>
        <FormLabel
          label="商品类型"
          help="决定订单类型和履约方向：算力积分、社区积分、个人会员或团队会员。"
        >
          <Select name="productType" defaultValue="bubble_pack">
            <option value="bubble_pack" title={productTypeHelp("bubble_pack")}>
              算力积分
            </option>
            <option value="community_point_pack" title={productTypeHelp("community_point_pack")}>
              社区积分
            </option>
            <option value="membership_plan" title={productTypeHelp("membership_plan")}>
              会员套餐
            </option>
            <option value="team_membership_plan" title={productTypeHelp("team_membership_plan")}>
              团队会员
            </option>
          </Select>
        </FormLabel>
        <div className="grid grid-cols-2 gap-2">
          <FormLabel
            label="币种"
            help="订单法币币种，使用 ISO 4217 三位码，例如 USD、CNY。不是平台积分币种。"
          >
            <TextInput name="currency" required maxLength={3} placeholder="USD" />
          </FormLabel>
          <FormLabel
            label="金额 minor"
            help="法币最小单位金额。USD 9900 表示 99.00 美元，CNY 9900 表示 99.00 元。"
          >
            <TextInput name="amountMinor" required inputMode="numeric" placeholder="9900" />
          </FormLabel>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FormLabel label="周期" help="一次性适用于积分包；月付/年付适用于会员订阅价格。">
            <Select name="interval" defaultValue="one_time">
              <option value="one_time">一次性</option>
              <option value="month">月付</option>
              <option value="year">年付</option>
            </Select>
          </FormLabel>
          <FormLabel
            label="主体"
            help="权益归属对象。个人会员/积分通常归用户，团队会员可归工作区。"
          >
            <Select name="subjectType" defaultValue="user">
              <option value="user">用户</option>
              <option value="workspace">工作区</option>
            </Select>
          </FormLabel>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-1.5">
            <p className="text-[12px] font-semibold text-slate-500">履约权益</p>
            <InfoTip text="支付完成后系统自动发放的权益。社区积分/算力积分进入可消费余额；可提现社区积分只能由创作者收入产生，不允许通过商品或券发放。" />
          </div>
          <div className="mt-2 grid gap-2">
            <Select name="grantsWalletCurrency" defaultValue="">
              <option value="">不发放积分</option>
              <option value="bubble">算力积分</option>
              <option value="community_point">社区积分</option>
            </Select>
            <TextInput name="grantsWalletAmount" inputMode="numeric" placeholder="发放数量" />
            <TextInput name="grantsPlanKey" placeholder="会员 plan key" />
            <TextInput name="grantDurationDays" inputMode="numeric" placeholder="会员天数" />
          </div>
        </div>
        <FormLabel
          label="供应商"
          help="选择后创建 provider binding。线下确认用于线下收款补单；兑换码请在促销券里创建。"
        >
          <Select name="provider" defaultValue="airwallex">
            <option value="">稍后配置</option>
            <option value="airwallex" title={providerHelp("airwallex")}>
              Airwallex
            </option>
            <option value="wechat_pay" title={providerHelp("wechat_pay")}>
              微信支付
            </option>
            <option value="manual" title={providerHelp("manual")}>
              线下确认
            </option>
          </Select>
        </FormLabel>
        <TextInput name="itemDescription" placeholder="内部备注，可选" />
        <Button type="submit" disabled={loading}>
          <IconPlus className="size-3.5" />
          创建
        </Button>
      </form>
    </section>
  );
}

function PromotionsView({
  promotions,
  status,
  provider,
  query,
  loading,
  onStatusChange,
  onProviderChange,
  onQueryChange,
  onRefresh,
  onCreatePromotion,
  onPromotionStatus,
  onSyncBinding,
}: {
  promotions: BillingPromotionRow[];
  status: string;
  provider: string;
  query: string;
  loading: boolean;
  onStatusChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onCreatePromotion: (event: React.FormEvent<HTMLFormElement>) => void;
  onPromotionStatus: (promotionId: string, status: BillingPromotionStatus) => void;
  onSyncBinding: (bindingId: string) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_150px_150px_auto]">
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                placeholder="搜索券码、名称"
              />
            </label>
            <Select value={status} onChange={onStatusChange}>
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="active">启用</option>
              <option value="paused">暂停</option>
              <option value="archived">归档</option>
            </Select>
            <Select
              value={provider}
              onChange={onProviderChange}
              title="促销券同步渠道。免费兑换码通常无需供应商，走内部零元履约；付费折扣需要同步到支付供应商。"
            >
              <option value="">全部渠道</option>
              <option value="airwallex" title={providerHelp("airwallex")}>
                Airwallex
              </option>
              <option value="wechat_pay" title={providerHelp("wechat_pay")}>
                微信支付
              </option>
              <option value="manual" title={providerHelp("manual")}>
                线下确认
              </option>
            </Select>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              应用
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1160px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <Th>券码</Th>
                <Th>折扣</Th>
                <Th>适用范围</Th>
                <Th help="支付供应商侧的优惠券 ID。100% 免费兑换码可不绑定供应商，系统内部创建零元订单并履约。">
                  Provider Coupon
                </Th>
                <Th>限制/核销</Th>
                <Th>状态</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((promotion) => (
                <tr key={promotion.id}>
                  <Td>
                    <p className="font-mono text-[12px] font-semibold text-slate-950">
                      {promotion.code}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-slate-800">{promotion.name}</p>
                  </Td>
                  <Td>
                    <p className="text-sm font-semibold text-slate-950">
                      {promotionDiscountLabel(promotion)}
                    </p>
                    <p className="text-[12px] text-slate-500">{promotion.durationType}</p>
                  </Td>
                  <Td>
                    <p className="text-sm text-slate-700">{promotionScopeLabel(promotion)}</p>
                    <p className="text-[12px] text-slate-500">
                      {promotion.startsAt ? formatDate(promotion.startsAt) : "立即"} -{" "}
                      {promotion.endsAt ? formatDate(promotion.endsAt) : "长期"}
                    </p>
                  </Td>
                  <Td>
                    <div className="flex max-w-[360px] flex-wrap gap-1.5">
                      {promotion.providerBindings.map((binding) => (
                        <PromotionProviderBadge
                          key={binding.id}
                          binding={binding}
                          onSync={onSyncBinding}
                        />
                      ))}
                      {!promotion.providerBindings.length ? (
                        isInternalFreePromotion(promotion) ? (
                          <StatusPill tone="muted">内部零元券</StatusPill>
                        ) : (
                          <RiskText>未配置渠道券</RiskText>
                        )
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <p className="text-sm text-slate-700">
                      {promotion.redemptionCount} / {promotion.maxRedemptions ?? "∞"}
                    </p>
                    <p className="text-[12px] text-slate-500">
                      单用户 {promotion.maxRedemptionsPerUser ?? "∞"}
                    </p>
                  </Td>
                  <Td>
                    <PromotionStatusPill status={promotion.status} />
                    <p className="mt-1 text-[11px] text-slate-400">
                      {formatDate(promotion.updatedAt)}
                    </p>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loading || promotion.status === "active"}
                        onClick={() => onPromotionStatus(promotion.id, "active")}
                      >
                        启用
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loading || promotion.status === "paused"}
                        onClick={() => onPromotionStatus(promotion.id, "paused")}
                      >
                        暂停
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
              {!promotions.length ? <EmptyRow colSpan={7} label="暂无促销券" /> : null}
            </tbody>
          </table>
        </div>
      </section>
      <CreatePromotionForm loading={loading} onSubmit={onCreatePromotion} />
    </div>
  );
}

function CreatePromotionForm({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">新建促销券</h3>
          <p className="mt-1 text-[12px] text-slate-500">
            当前只开放百分比折扣；100% 可作为免费兑换券，固定法币抵扣暂不提供运营入口。
          </p>
        </div>
        <IconTicket className="size-4 text-slate-400" />
      </div>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <FormLabel
            label="券码"
            help="用户可输入的优惠码/兑换码。它是促销规则，不是 payment provider。"
          >
            <TextInput name="code" required placeholder="WELCOME100" />
          </FormLabel>
          <FormLabel label="状态" help="草稿不可用；启用后可核销；暂停保留历史但不允许新订单使用。">
            <Select name="status" defaultValue="draft">
              <option value="draft">草稿</option>
              <option value="active">启用</option>
              <option value="paused">暂停</option>
            </Select>
          </FormLabel>
        </div>
        <FormLabel label="名称" help="后台运营识别用名称，建议描述活动或发放场景。">
          <TextInput name="name" required placeholder="新用户促销" />
        </FormLabel>
        <FormLabel
          label="折扣百分比"
          help="输入 100 表示 100% off，可作为免费兑换券；输入 20 表示减免订单金额的 20%。"
        >
          <TextInput name="percentOff" required inputMode="decimal" placeholder="100" />
        </FormLabel>
        <FormLabel label="适用类型" help="限制兑换码只能用于某类商品；留空表示全部商品可用。">
          <Select name="appliesProductType" defaultValue="">
            <option value="">全部商品</option>
            <option value="bubble_pack" title={productTypeHelp("bubble_pack")}>
              算力积分
            </option>
            <option value="community_point_pack" title={productTypeHelp("community_point_pack")}>
              社区积分
            </option>
            <option value="membership_plan" title={productTypeHelp("membership_plan")}>
              会员套餐
            </option>
            <option value="team_membership_plan" title={productTypeHelp("team_membership_plan")}>
              团队会员
            </option>
          </Select>
        </FormLabel>
        <div className="grid grid-cols-2 gap-2">
          <FormLabel label="总次数" help="全站最大核销次数。为空表示不限总次数。">
            <TextInput name="maxRedemptions" inputMode="numeric" placeholder="可选" />
          </FormLabel>
          <FormLabel label="单用户" help="单个用户最多核销次数。兑换码通常填 1。">
            <TextInput name="maxRedemptionsPerUser" inputMode="numeric" placeholder="1" />
          </FormLabel>
        </div>
        <FormLabel
          label="供应商"
          help="付费折扣同步到 Airwallex/微信；内部免费兑换码选择无需供应商。"
        >
          <Select name="provider" defaultValue="airwallex">
            <option value="">无需供应商</option>
            <option value="airwallex" title={providerHelp("airwallex")}>
              Airwallex
            </option>
            <option value="wechat_pay" title={providerHelp("wechat_pay")}>
              微信支付
            </option>
            <option value="manual" title={providerHelp("manual")}>
              线下确认
            </option>
          </Select>
        </FormLabel>
        <TextInput name="description" placeholder="内部备注，可选" />
        <Button type="submit" disabled={loading}>
          <IconPlus className="size-3.5" />
          创建
        </Button>
      </form>
    </section>
  );
}

function OrdersView({
  orders,
  status,
  provider,
  query,
  loading,
  onStatusChange,
  onProviderChange,
  onQueryChange,
  onRefresh,
}: {
  orders: BillingOrderRow[];
  status: string;
  provider: string;
  query: string;
  loading: boolean;
  onStatusChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_160px_150px_auto]">
          <label className="relative block">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
              placeholder="搜索订单号、用户、主体"
            />
          </label>
          <Select value={status} onChange={onStatusChange}>
            <option value="">全部状态</option>
            <option value="pending_payment">待支付</option>
            <option value="paid">已支付</option>
            <option value="fulfilled">已履约</option>
            <option value="failed">失败</option>
            <option value="refunded">已退款</option>
            <option value="partially_refunded">部分退款</option>
          </Select>
          <Select
            value={provider}
            onChange={onProviderChange}
            title="订单支付渠道。线下确认表示后台确认的线下收款；兑换码会显示为促销抵扣，不是渠道。"
          >
            <option value="">全部渠道</option>
            <option value="airwallex" title={providerHelp("airwallex")}>
              Airwallex
            </option>
            <option value="wechat_pay" title={providerHelp("wechat_pay")}>
              微信支付
            </option>
            <option value="manual" title={providerHelp("manual")}>
              线下确认
            </option>
          </Select>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
            应用
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1140px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <Th>订单</Th>
              <Th>商品</Th>
              <Th>金额</Th>
              <Th help="实际支付或履约来源；优惠码/兑换码会体现在折扣和订单履约，不作为渠道。">
                支付渠道
              </Th>
              <Th>状态</Th>
              <Th>用户/主体</Th>
              <Th>时间</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <Td>
                  <p className="font-mono text-[12px] font-medium text-slate-950">
                    {order.orderNo}
                  </p>
                  <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-slate-500">
                    {order.idempotencyKey}
                  </p>
                </Td>
                <Td>
                  <p className="text-sm font-medium text-slate-950">{order.item.name}</p>
                  <p className="text-[12px] text-slate-500">
                    {order.item.code} · {order.orderType}
                  </p>
                </Td>
                <Td>
                  <p className="text-sm font-semibold text-slate-950">
                    {formatMoneyMinor(order.amountMinor, order.currency)}
                  </p>
                  <p className="text-[12px] text-slate-500">
                    {order.refundedAmountMinor !== "0"
                      ? `已退 ${formatMoneyMinor(order.refundedAmountMinor, order.currency)}`
                      : order.discountAmountMinor !== "0"
                        ? `原价 ${formatMoneyMinor(order.subtotalAmountMinor, order.currency)}`
                        : `x ${order.quantity}`}
                  </p>
                </Td>
                <Td>
                  <p className="text-sm text-slate-700">{providerLabel(order.provider)}</p>
                  <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                    {order.paymentIntent?.providerStatus ?? "-"}
                  </p>
                </Td>
                <Td>
                  <OrderStatusPill status={order.status} />
                  <p className="mt-1 text-[11px] text-slate-500">
                    {order.paymentIntent?.status ?? "no_intent"}
                  </p>
                </Td>
                <Td>
                  <p className="max-w-[180px] truncate text-[12px] text-slate-700">
                    {order.userId}
                  </p>
                  <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                    {order.subjectType}:{order.subjectId}
                  </p>
                </Td>
                <Td>
                  <p className="text-[12px] text-slate-700">{formatDate(order.createdAt)}</p>
                  <p className="text-[11px] text-slate-500">
                    {order.fulfilledAt ? `履约 ${formatDate(order.fulfilledAt)}` : "未履约"}
                  </p>
                </Td>
              </tr>
            ))}
            {!orders.length ? <EmptyRow colSpan={7} label="暂无订单" /> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RefundsView({
  refunds,
  quote,
  status,
  provider,
  query,
  loading,
  onStatusChange,
  onProviderChange,
  onQueryChange,
  onRefresh,
  onQuoteRefund,
  onCreateRefund,
}: {
  refunds: BillingRefundRow[];
  quote: BillingRefundQuoteData | null;
  status: string;
  provider: string;
  query: string;
  loading: boolean;
  onStatusChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onQuoteRefund: (formElement: HTMLFormElement) => void;
  onCreateRefund: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const [refundMode, setRefundMode] = useState("suggested");
  const canSubmitRefund = Boolean(quote && quote.blockers.length === 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_170px_150px_auto]">
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                placeholder="搜索退款号、订单号、用户"
              />
            </label>
            <Select value={status} onChange={onStatusChange}>
              <option value="">全部状态</option>
              <option value="requested">已请求</option>
              <option value="provider_pending">渠道处理中</option>
              <option value="succeeded">成功</option>
              <option value="failed">失败</option>
              <option value="canceled">已取消</option>
            </Select>
            <Select value={provider} onChange={onProviderChange}>
              <option value="">全部渠道</option>
              <option value="airwallex">Airwallex</option>
              <option value="wechat_pay">微信支付</option>
              <option value="manual">线下确认</option>
            </Select>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              应用
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <Th>退款</Th>
                <Th>订单</Th>
                <Th>金额</Th>
                <Th help="内部状态决定是否已记账；provider 状态保留 Airwallex/微信原始状态。">
                  状态
                </Th>
                <Th help="已履约订单退款前会先冲回可用积分或撤销会员权益，避免退款后权益仍可消费。">
                  权益冲回
                </Th>
                <Th>失败原因</Th>
                <Th>时间</Th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((refund) => (
                <tr key={refund.id}>
                  <Td>
                    <p className="font-mono text-[12px] font-medium text-slate-950">
                      {refund.refundNo}
                    </p>
                    <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-slate-500">
                      {refund.providerRefundId ?? refund.requestId}
                    </p>
                  </Td>
                  <Td>
                    <p className="font-mono text-[12px] font-medium text-slate-950">
                      {refund.orderNo}
                    </p>
                    <p className="text-[12px] text-slate-500">
                      {refund.order.item.name} · {refund.order.userId}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-sm font-semibold text-slate-950">
                      {formatMoneyMinor(refund.amountMinor, refund.currency)}
                    </p>
                    <p className="text-[12px] text-slate-500">{refund.reasonCode}</p>
                  </Td>
                  <Td>
                    <RefundStatusPill status={refund.status} />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {refund.providerStatus ?? "provider_pending"}
                    </p>
                  </Td>
                  <Td>
                    <p className="text-[12px] text-slate-700">
                      {refund.walletReversalAmount
                        ? `${walletCurrencyLabel(refund.walletReversalCurrency)} -${refund.walletReversalAmount}`
                        : refund.entitlementGrantId
                          ? "会员权益已撤销"
                          : "无虚拟权益"}
                    </p>
                    <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                      {refund.walletTransactionId ?? refund.entitlementGrantId ?? "-"}
                    </p>
                  </Td>
                  <Td>
                    <p className="max-w-[240px] truncate text-[12px] text-slate-700">
                      {refund.failureMessage ?? refund.operatorNote ?? "-"}
                    </p>
                    <p className="text-[11px] text-slate-500">{refund.failureCode ?? "-"}</p>
                  </Td>
                  <Td>
                    <p className="text-[12px] text-slate-700">{formatDate(refund.createdAt)}</p>
                    <p className="text-[11px] text-slate-500">
                      {refund.succeededAt
                        ? `成功 ${formatDate(refund.succeededAt)}`
                        : refund.failedAt
                          ? `失败 ${formatDate(refund.failedAt)}`
                          : "未完成"}
                    </p>
                  </Td>
                </tr>
              ))}
              {!refunds.length ? <EmptyRow colSpan={7} label="暂无退款" /> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="h-fit rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-slate-950">创建退款</h3>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            退款不开放给前台用户；先评估政策，再提交到支付供应商。
          </p>
        </div>
        <form className="space-y-3" onSubmit={onCreateRefund}>
          <FormLabel
            label="订单 ID"
            help="必须是已支付或已履约订单；退款不会跨国际站/中国站数据库。"
          >
            <TextInput name="orderId" placeholder="UUID" required />
          </FormLabel>

          <FormLabel
            label="计算方式"
            help="建议金额由后台按订单剩余可退金额、积分可冲回余额、会员未使用周期统一计算。"
          >
            <Select name="refundMode" value={refundMode} onChange={setRefundMode}>
              <option value="suggested">按建议金额</option>
              <option value="amount">指定金额</option>
              <option value="percent">按剩余可退比例</option>
            </Select>
          </FormLabel>

          {refundMode === "amount" ? (
            <FormLabel label="退款金额 minor" help="使用法币最小单位，例如 USD 9.99 填 999。">
              <TextInput name="amountMinor" inputMode="numeric" placeholder="999" required />
            </FormLabel>
          ) : null}

          {refundMode === "percent" ? (
            <FormLabel
              label="退款比例"
              help="按订单当前剩余可退金额计算，例如 50 表示退还剩余可退金额的 50%。"
            >
              <TextInput
                name="refundPercent"
                inputMode="decimal"
                min="0.01"
                max="100"
                step="0.01"
                placeholder="50"
                required
              />
            </FormLabel>
          ) : null}

          <FormLabel label="原因" help="原因会进入审计和 provider refund reason。">
            <Select name="reasonCode" defaultValue="customer_requested">
              <option value="customer_requested">客户申请</option>
              <option value="duplicate_payment">重复支付</option>
              <option value="fraud_review">风控退款</option>
              <option value="service_issue">服务问题</option>
              <option value="operator_correction">运营纠错</option>
            </Select>
          </FormLabel>
          <FormLabel
            label="幂等键"
            help="重复提交同一个退款动作必须使用同一个幂等键，避免重复退款。"
          >
            <TextInput name="idempotencyKey" placeholder="可留空自动生成" />
          </FormLabel>
          <FormLabel label="内部备注" help="备注只给后台审计，不展示给用户。">
            <TextInput name="operatorNote" placeholder="可选" />
          </FormLabel>

          <RefundQuotePanel quote={quote} />

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={(event) => {
                const form = event.currentTarget.form;
                if (form) onQuoteRefund(form);
              }}
            >
              <IconScale className="size-4" />
              评估退款
            </Button>
            <Button type="submit" disabled={loading || !canSubmitRefund}>
              <IconReceiptRefund className="size-4" />
              提交退款
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function RefundQuotePanel({ quote }: { quote: BillingRefundQuoteData | null }) {
  if (!quote) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-500">
        先评估退款，后台会计算可退金额、权益冲回和阻断原因。
      </div>
    );
  }

  const hasBlockers = quote.blockers.length > 0;
  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border px-3 py-3",
        hasBlockers ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[12px] font-semibold text-slate-950">
            {quote.order.orderNo}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {quote.order.item.name} · {quote.policy.calculationMode}
          </p>
        </div>
        <StatusPill tone={hasBlockers ? "risk" : "success"}>
          {hasBlockers ? "不可自动退款" : "可提交"}
        </StatusPill>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <p className="text-slate-500">剩余可退</p>
          <p className="mt-0.5 font-semibold text-slate-950">
            {formatMoneyMinor(quote.refundableAmountMinor, quote.order.currency)}
          </p>
        </div>
        <div>
          <p className="text-slate-500">策略上限</p>
          <p className="mt-0.5 font-semibold text-slate-950">
            {formatMoneyMinor(quote.maxPolicyRefundMinor, quote.order.currency)}
          </p>
        </div>
        <div>
          <p className="text-slate-500">本次金额</p>
          <p className="mt-0.5 font-semibold text-slate-950">
            {formatMoneyMinor(quote.requestedAmountMinor, quote.order.currency)}
          </p>
        </div>
      </div>

      <div className="rounded-md border border-white/70 bg-white/70 px-2.5 py-2 text-[12px] leading-5 text-slate-700">
        <p className="font-semibold text-slate-950">权益影响</p>
        {quote.benefitImpact.type === "wallet" ? (
          <p className="mt-1">
            {currencyLabel(quote.benefitImpact.walletCurrency)}：可用{" "}
            {formatInteger(quote.benefitImpact.availableBalance)}，本次冲回{" "}
            {formatInteger(quote.benefitImpact.requestedReversalAmount)}，累计已冲回{" "}
            {formatInteger(quote.benefitImpact.alreadyReversedAmount)}。
          </p>
        ) : quote.benefitImpact.type === "membership" ? (
          <p className="mt-1">
            {quote.benefitImpact.planKey} 未使用 {formatBpsPercent(quote.benefitImpact.unusedBps)}
            ，提交后撤销剩余会员权益。
          </p>
        ) : (
          <p className="mt-1">{quote.benefitImpact.description}</p>
        )}
      </div>

      {quote.blockers.length ? (
        <div className="space-y-1">
          {quote.blockers.map((issue) => (
            <p key={`${issue.code}:${issue.msg}`} className="flex gap-1.5 text-[12px] text-red-700">
              <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{issue.msg}</span>
            </p>
          ))}
        </div>
      ) : null}

      {quote.warnings.length ? (
        <div className="space-y-1">
          {quote.warnings.map((issue) => (
            <p key={`${issue.code}:${issue.msg}`} className="text-[11px] leading-4 text-slate-600">
              {issue.msg}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProviderEventsView({
  events,
  status,
  provider,
  eventType,
  query,
  ignoreReasons,
  loading,
  onStatusChange,
  onProviderChange,
  onEventTypeChange,
  onQueryChange,
  onIgnoreReasonChange,
  onRefresh,
  onReprocess,
  onIgnore,
}: {
  events: BillingProviderEventRow[];
  status: string;
  provider: string;
  eventType: string;
  query: string;
  ignoreReasons: Record<string, string>;
  loading: boolean;
  onStatusChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onEventTypeChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onIgnoreReasonChange: (eventId: string, value: string) => void;
  onRefresh: () => void;
  onReprocess: (eventId: string) => void;
  onIgnore: (eventId: string) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">支付供应商事件</h3>
            <p className="mt-1 text-[12px] text-slate-500">
              Webhook 接收、处理、失败和人工补偿入口集中在这里。
            </p>
          </div>
          <div className="grid gap-2 xl:grid-cols-[minmax(220px,1fr)_145px_150px_210px_auto]">
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                placeholder="搜索 event id、订单号、退款号、错误"
              />
            </label>
            <Select
              value={status}
              onChange={onStatusChange}
              title="provider event 当前处理状态。failed/ignored 需要运营确认是否重放或关闭。"
            >
              <option value="">全部状态</option>
              <option value="received">已接收</option>
              <option value="processed">已处理</option>
              <option value="ignored">已忽略</option>
              <option value="failed">失败</option>
            </Select>
            <Select
              value={provider}
              onChange={onProviderChange}
              title="支付供应商。国际站当前为 Airwallex，中国站后续接微信支付。"
            >
              <option value="">全部渠道</option>
              <option value="airwallex" title={providerHelp("airwallex")}>
                Airwallex
              </option>
              <option value="wechat_pay" title={providerHelp("wechat_pay")}>
                微信支付
              </option>
            </Select>
            <TextInput
              value={eventType}
              onChange={(event) => onEventTypeChange(event.target.value)}
              placeholder="event type"
              title="按供应商事件类型过滤，例如 billing_checkout.completed、payment_intent.succeeded、refund.settled。"
            />
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              应用
            </Button>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1360px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <Th help="供应商事件 ID 是 webhook 幂等键，同一个事件只能处理一次。">事件</Th>
              <Th help="received 表示已入库待处理，failed 表示处理异常已保留，ignored 表示人工关闭。">
                状态
              </Th>
              <Th help="事件匹配到的内部订单、payment intent 或退款记录。">关联业务</Th>
              <Th help="供应商 payload 中关键定位字段，便于和 Airwallex 后台交叉检索。">
                Payload 摘要
              </Th>
              <Th help="处理失败原因或人工忽略原因。">异常/原因</Th>
              <Th help="事件触发的账务 journal；支付、履约、退款都必须可追溯。">账务</Th>
              <Th>时间</Th>
              <Th>操作</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const canOperate = event.status !== "processed";
              return (
                <tr key={event.id}>
                  <Td>
                    <p className="text-sm font-medium text-slate-950">
                      {providerLabel(event.provider)}
                    </p>
                    <p className="mt-0.5 font-mono text-[12px] text-slate-700">{event.eventType}</p>
                    <p
                      className="mt-0.5 max-w-[260px] truncate font-mono text-[11px] text-slate-500"
                      title={event.providerEventId}
                    >
                      {event.providerEventId}
                    </p>
                  </Td>
                  <Td>
                    <ProviderEventStatusPill status={event.status} />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {event.processedAt ? `处理 ${formatDate(event.processedAt)}` : "待处理"}
                    </p>
                  </Td>
                  <Td>
                    {event.order ? (
                      <>
                        <p className="font-mono text-[12px] font-medium text-slate-950">
                          {event.order.orderNo}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {orderStatusLabel(event.order.status)} · {event.order.userId}
                        </p>
                      </>
                    ) : (
                      <p className="text-[12px] text-slate-500">未匹配订单</p>
                    )}
                    {event.refund ? (
                      <p className="mt-1 text-[12px] text-slate-700">
                        退款 {event.refund.refundNo} · {refundStatusLabel(event.refund.status)}
                      </p>
                    ) : null}
                    {event.paymentIntent ? (
                      <p
                        className="mt-1 max-w-[220px] truncate font-mono text-[11px] text-slate-500"
                        title={
                          event.paymentIntent.providerPaymentIntentId ?? event.paymentIntent.id
                        }
                      >
                        PI {event.paymentIntent.providerStatus ?? event.paymentIntent.status}
                      </p>
                    ) : null}
                  </Td>
                  <Td>
                    <div className="space-y-1 text-[12px] text-slate-700">
                      <PayloadLine label="data" value={event.payloadSummary?.dataId} />
                      <PayloadLine label="status" value={event.payloadSummary?.dataStatus} />
                      <PayloadLine
                        label="checkout"
                        value={event.payloadSummary?.billingCheckoutId}
                      />
                      <PayloadLine label="request" value={event.payloadSummary?.requestId} />
                      <PayloadLine
                        label="refund"
                        value={event.payloadSummary?.refundId ?? event.refund?.providerRefundId}
                      />
                    </div>
                  </Td>
                  <Td>
                    <p
                      className={cn(
                        "max-w-[260px] text-[12px] leading-5",
                        event.status === "failed" ? "text-red-700" : "text-slate-600"
                      )}
                      title={event.error ?? undefined}
                    >
                      {event.error ?? "-"}
                    </p>
                  </Td>
                  <Td>
                    <div className="space-y-1">
                      {event.ledgerJournals.map((journal) => (
                        <p key={journal.id} className="text-[12px] text-slate-700">
                          {ledgerJournalTypeLabel(journal.journalType)} · {journal.journalNo}
                        </p>
                      ))}
                      {!event.ledgerJournals.length ? (
                        <p className="text-[12px] text-slate-500">无 journal</p>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <p className="text-[12px] text-slate-700">{formatDate(event.receivedAt)}</p>
                    <p className="text-[11px] text-slate-500">接收</p>
                  </Td>
                  <Td>
                    {canOperate ? (
                      <div className="grid min-w-[230px] gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={loading}
                          onClick={() => onReprocess(event.id)}
                        >
                          <IconRefresh className="size-3.5" />
                          重放
                        </Button>
                        <TextInput
                          value={ignoreReasons[event.id] ?? ""}
                          onChange={(inputEvent) =>
                            onIgnoreReasonChange(event.id, inputEvent.target.value)
                          }
                          placeholder="忽略原因"
                          title="忽略会写入审计。只用于确认无需再处理的重复、测试或无法匹配事件。"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={loading}
                          onClick={() => onIgnore(event.id)}
                        >
                          <IconCircleCheck className="size-3.5" />
                          忽略
                        </Button>
                      </div>
                    ) : (
                      <StatusPill tone="success">已完成</StatusPill>
                    )}
                  </Td>
                </tr>
              );
            })}
            {!events.length ? <EmptyRow colSpan={8} label="暂无支付供应商事件" /> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PayloadLine({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="truncate font-mono" title={value}>
        {value}
      </span>
    </p>
  );
}

function WalletView({
  accounts,
  metrics,
  recentOrders,
}: {
  accounts: WalletAccountRow[];
  metrics: AdminBillingOverviewData["metrics"];
  recentOrders: BillingOrderRow[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-950">钱包账户最近变动</h3>
          <p className="mt-1 text-[12px] text-slate-500">
            余额、冻结金额和账户状态只读展示；人工调账必须走审计和双人复核。
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <Th>账户</Th>
                <Th help="平台钱包币种，不是法币。算力积分和社区积分相互隔离。">币种</Th>
                <Th help="可消费余额用于购买内容/服务；可提现余额只来自创作者收入，暂不开放提现流程。">
                  余额类型
                </Th>
                <Th>可用余额</Th>
                <Th>冻结</Th>
                <Th>状态</Th>
                <Th>更新时间</Th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <Td>
                    <p className="text-sm font-medium text-slate-950">{account.ownerType}</p>
                    <p className="max-w-[240px] truncate text-[11px] text-slate-500">
                      {account.ownerId}
                    </p>
                  </Td>
                  <Td>{currencyLabel(account.currency)}</Td>
                  <Td>{balanceKindLabel(account.balanceKind)}</Td>
                  <Td>{formatInteger(account.availableBalance)}</Td>
                  <Td>{formatInteger(account.heldBalance)}</Td>
                  <Td>
                    <StatusPill tone={account.status === "active" ? "success" : "muted"}>
                      {account.status}
                    </StatusPill>
                  </Td>
                  <Td>{formatDate(account.updatedAt)}</Td>
                </tr>
              ))}
              {!accounts.length ? <EmptyRow colSpan={7} label="暂无钱包账户" /> : null}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h3 className="text-sm font-semibold text-slate-950">7 日账单状态</h3>
        <div className="mt-4 grid gap-2">
          <Metric label="已履约订单" value={metrics.fulfilledOrders7d} />
          <Metric label="失败订单" value={metrics.failedOrders7d} tone="risk" />
          <Metric label="支付失败事件" value={metrics.paymentFailures7d} tone="risk" />
        </div>
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="text-[12px] font-semibold text-slate-500">最近订单</p>
          <div className="mt-3 space-y-2">
            {recentOrders.slice(0, 5).map((order) => (
              <div key={order.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12px] font-medium text-slate-950">
                    {order.item.name}
                  </p>
                  <OrderStatusPill status={order.status} />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {formatMoneyMinor(order.amountMinor, order.currency)} ·{" "}
                  {formatDate(order.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function LedgerView({
  overview,
  journals,
  settlements,
  reconciliationRuns,
  journalType,
  provider,
  currency,
  loading,
  onJournalTypeChange,
  onProviderChange,
  onCurrencyChange,
  onRefresh,
}: {
  overview: AdminBillingLedgerOverviewData;
  journals: BillingLedgerJournalRow[];
  settlements: BillingSettlementRow[];
  reconciliationRuns: BillingReconciliationRunRow[];
  journalType: string;
  provider: string;
  currency: string;
  loading: boolean;
  onJournalTypeChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="border-b border-slate-200 p-4">
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">资金双分录账本</h3>
                <p className="mt-1 text-[12px] text-slate-500">
                  支付、履约、退款、结算和收入确认都会沉淀为 append-only journal。
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[190px_150px_110px_auto]">
                <Select
                  value={journalType}
                  onChange={onJournalTypeChange}
                  title="资金账本 journal 类型。所有资金状态变化都必须以双分录方式入账。"
                >
                  <option value="">全部分录类型</option>
                  <option value="payment_capture" title={ledgerJournalTypeHelp("payment_capture")}>
                    支付入账
                  </option>
                  <option
                    value="fulfillment_allocation"
                    title={ledgerJournalTypeHelp("fulfillment_allocation")}
                  >
                    履约分配
                  </option>
                  <option value="settlement" title={ledgerJournalTypeHelp("settlement")}>
                    结算
                  </option>
                  <option value="refund" title={ledgerJournalTypeHelp("refund")}>
                    退款
                  </option>
                  <option value="chargeback" title={ledgerJournalTypeHelp("chargeback")}>
                    拒付
                  </option>
                  <option
                    value="revenue_recognition"
                    title={ledgerJournalTypeHelp("revenue_recognition")}
                  >
                    收入确认
                  </option>
                </Select>
                <Select
                  value={provider}
                  onChange={onProviderChange}
                  title="按账务来源渠道过滤。内部发放表示平台承担成本的零元履约或迁移补偿。"
                >
                  <option value="">全部渠道</option>
                  <option value="airwallex" title={providerHelp("airwallex")}>
                    Airwallex
                  </option>
                  <option value="wechat_pay" title={providerHelp("wechat_pay")}>
                    微信支付
                  </option>
                  <option value="manual" title={providerHelp("manual")}>
                    线下确认
                  </option>
                  <option value="internal" title={providerHelp("internal")}>
                    内部发放
                  </option>
                </Select>
                <input
                  value={currency}
                  onChange={(event) => onCurrencyChange(event.target.value.toUpperCase())}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm uppercase outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  maxLength={3}
                  placeholder="USD"
                />
                <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                  <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                  应用
                </Button>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                  <Th>Journal</Th>
                  <Th help="journal 类型描述资金事件的业务来源，例如支付入账、履约分配、结算或退款。">
                    类型
                  </Th>
                  <Th help="双分录借方合计，必须等于贷方合计。">借方</Th>
                  <Th help="双分录贷方合计，必须等于借方合计。">贷方</Th>
                  <Th>来源</Th>
                  <Th help="具体账户分录和账户余额。余额按账户正常方向计算，不是用户积分余额。">
                    分录
                  </Th>
                  <Th>时间</Th>
                </tr>
              </thead>
              <tbody>
                {journals.map((journal) => (
                  <tr key={journal.id}>
                    <Td>
                      <p className="font-mono text-[12px] font-medium text-slate-950">
                        {journal.journalNo}
                      </p>
                      <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-slate-500">
                        {journal.description ?? journal.id}
                      </p>
                    </Td>
                    <Td>
                      <StatusPill tone={journal.status === "posted" ? "success" : "muted"}>
                        {ledgerJournalTypeLabel(journal.journalType)}
                      </StatusPill>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {journal.provider ? providerLabel(journal.provider) : "platform"}
                      </p>
                    </Td>
                    <Td>
                      <p className="text-sm font-semibold text-slate-950">
                        {formatMoneyMinor(journal.totalDebitMinor, journal.currency)}
                      </p>
                    </Td>
                    <Td>
                      <p className="text-sm font-semibold text-slate-950">
                        {formatMoneyMinor(journal.totalCreditMinor, journal.currency)}
                      </p>
                    </Td>
                    <Td>
                      <p className="text-[12px] text-slate-700">{journal.sourceType}</p>
                      <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                        {journal.sourceId ?? journal.orderId ?? "-"}
                      </p>
                    </Td>
                    <Td>
                      <div className="space-y-1.5">
                        {journal.entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="grid grid-cols-[52px_minmax(170px,1fr)_120px] gap-2 text-[12px]"
                          >
                            <span
                              className={cn(
                                "w-fit rounded-full border px-2 py-0.5",
                                entry.direction === "debit"
                                  ? "border-sky-200 bg-sky-50 text-sky-700"
                                  : "border-violet-200 bg-violet-50 text-violet-700"
                              )}
                            >
                              {entry.direction === "debit" ? "借" : "贷"}
                            </span>
                            <span className="truncate text-slate-600" title={entry.account.code}>
                              {entry.account.name}
                            </span>
                            <span className="text-right font-mono text-slate-950">
                              {formatMoneyMinor(entry.amountMinor, journal.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Td>
                    <Td>{formatDate(journal.postedAt)}</Td>
                  </tr>
                ))}
                {!journals.length ? <EmptyRow colSpan={7} label="暂无资金账本分录" /> : null}
              </tbody>
            </table>
          </div>
        </section>
        <SettlementsTable settlements={settlements} />
        <ReconciliationRunsTable runs={reconciliationRuns} />
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-slate-950">账务控制面</h3>
          <InfoTip text="显示总账账户、journal、结算和对账运行的控制指标；这里不直接改余额。" />
        </div>
        <div className="mt-4 grid gap-2">
          <Metric label="活跃账户" value={overview.metrics.activeAccounts} />
          <Metric label="Journal" value={overview.metrics.journalCount} />
          <Metric label="Settlement" value={overview.metrics.settlementCount} />
          <Metric
            label="对账运行中"
            value={overview.metrics.openReconciliationCount}
            tone={overview.metrics.openReconciliationCount ? "risk" : "default"}
          />
        </div>
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="text-[12px] font-semibold text-slate-500">账户余额</p>
          <div className="mt-3 max-h-[420px] space-y-2 overflow-auto pr-1">
            {overview.accounts.map((account) => (
              <div key={account.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12px] font-medium text-slate-950">{account.name}</p>
                  <span className="shrink-0 text-[11px] text-slate-500">{account.currency}</span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-slate-500">{account.code}</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">
                  {formatMoneyMinor(account.balanceMinor, account.currency)}
                </p>
              </div>
            ))}
            {!overview.accounts.length ? (
              <p className="rounded-lg border border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
                暂无账务账户
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function SettlementsTable({ settlements }: { settlements: BillingSettlementRow[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">渠道结算</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          用于核对支付渠道打款、手续费和内部 journal 是否一致。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <Th help="支付供应商侧 settlement/payout 批次 ID，用于和渠道后台对账。">结算批次</Th>
              <Th help="结算批次与内部账本的对账状态。">状态</Th>
              <Th help="渠道结算总金额，未扣手续费。">总额</Th>
              <Th help="渠道从结算中扣除的手续费。后续会生成 provider_fee journal。">手续费</Th>
              <Th help="渠道实际打款金额，等于总额减手续费。">净额</Th>
              <Th>关联</Th>
              <Th>时间</Th>
            </tr>
          </thead>
          <tbody>
            {settlements.map((settlement) => (
              <tr key={settlement.id}>
                <Td>
                  <p className="font-mono text-[12px] font-medium text-slate-950">
                    {settlement.providerSettlementId}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {providerLabel(settlement.provider)}
                  </p>
                </Td>
                <Td>
                  <StatusPill tone={settlement.status === "failed" ? "risk" : "muted"}>
                    {settlementStatusLabel(settlement.status)}
                  </StatusPill>
                </Td>
                <Td>{formatMoneyMinor(settlement.grossAmountMinor, settlement.currency)}</Td>
                <Td>{formatMoneyMinor(settlement.feeAmountMinor, settlement.currency)}</Td>
                <Td>
                  <p className="font-semibold text-slate-950">
                    {formatMoneyMinor(settlement.netAmountMinor, settlement.currency)}
                  </p>
                </Td>
                <Td>
                  <p className="text-[12px] text-slate-700">Journal {settlement.journalCount}</p>
                  <p className="text-[11px] text-slate-500">
                    对账项 {settlement.reconciliationItemCount}
                  </p>
                </Td>
                <Td>{settlement.settledAt ? formatDate(settlement.settledAt) : "-"}</Td>
              </tr>
            ))}
            {!settlements.length ? <EmptyRow colSpan={7} label="暂无渠道结算记录" /> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReconciliationRunsTable({ runs }: { runs: BillingReconciliationRunRow[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">支付对账</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          对账运行、差异数量和未匹配项集中展示，后续处理退款、拒付和渠道漏单。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1050px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <Th>运行</Th>
              <Th help="本次对账任务是否仍在运行、完成或失败。">状态</Th>
              <Th>周期</Th>
              <Th>匹配</Th>
              <Th help="金额不一致、内部缺失、渠道缺失三类异常合计。">差异</Th>
              <Th help="最多展示近期未匹配样本，便于定位漏单、重复回调或渠道金额不一致。">
                异常样本
              </Th>
              <Th>更新时间</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const issueCount =
                run.mismatchCount + run.missingInternalCount + run.missingProviderCount;
              return (
                <tr key={run.id}>
                  <Td>
                    <p className="font-mono text-[12px] font-medium text-slate-950">
                      {run.id.slice(0, 8)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {providerLabel(run.provider)} {run.currency ?? ""}
                    </p>
                  </Td>
                  <Td>
                    <StatusPill
                      tone={
                        run.status === "failed"
                          ? "risk"
                          : run.status === "completed" && issueCount === 0
                            ? "success"
                            : "muted"
                      }
                    >
                      {reconciliationStatusLabel(run.status)}
                    </StatusPill>
                    {run.error ? (
                      <p className="mt-1 max-w-[180px] truncate text-[11px] text-red-600">
                        {run.error}
                      </p>
                    ) : null}
                  </Td>
                  <Td>
                    <p className="text-[12px] text-slate-700">{formatDate(run.periodStart)}</p>
                    <p className="text-[11px] text-slate-500">{formatDate(run.periodEnd)}</p>
                  </Td>
                  <Td>{formatInteger(String(run.matchedCount))}</Td>
                  <Td>
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        issueCount ? "text-red-700" : "text-slate-950"
                      )}
                    >
                      {formatInteger(String(issueCount))}
                    </p>
                    <p className="text-[11px] text-slate-500">总项 {run.itemCount}</p>
                  </Td>
                  <Td>
                    <div className="space-y-1.5">
                      {run.openItems.map((item) => (
                        <div
                          key={item.id}
                          className="grid grid-cols-[92px_minmax(120px,1fr)_110px] gap-2 text-[12px]"
                        >
                          <span className="truncate text-red-700">
                            {reconciliationItemStatusLabel(item.status)}
                          </span>
                          <span
                            className="truncate text-slate-600"
                            title={item.providerReference ?? item.orderId ?? undefined}
                          >
                            {item.providerReference ?? item.orderId ?? "-"}
                          </span>
                          <span className="text-right font-mono text-slate-950">
                            {formatNullableMoneyMinor(
                              item.differenceMinor ??
                                item.providerAmountMinor ??
                                item.internalAmountMinor,
                              item.currency
                            )}
                          </span>
                        </div>
                      ))}
                      {!run.openItems.length ? (
                        <span className="text-[12px] text-slate-500">无未处理异常</span>
                      ) : null}
                    </div>
                  </Td>
                  <Td>{formatDate(run.updatedAt)}</Td>
                </tr>
              );
            })}
            {!runs.length ? <EmptyRow colSpan={7} label="暂无对账运行" /> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "risk";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "risk" ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"
      )}
    >
      <p
        className={cn(
          "text-[11px] font-medium",
          tone === "risk" ? "text-red-600" : "text-slate-500"
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tracking-tight",
          tone === "risk" ? "text-red-700" : "text-slate-950"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof IconCoins;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition",
        active ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-white hover:text-slate-950"
      )}
    >
      <Icon className="size-4" />
      {children}
    </button>
  );
}

function Select({
  name,
  value,
  defaultValue,
  onChange,
  title,
  children,
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  title?: string;
  children: React.ReactNode;
}) {
  const controlProps =
    value !== undefined
      ? {
          value,
          onChange: onChange
            ? (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)
            : undefined,
        }
      : { defaultValue };
  return (
    <select
      name={name}
      title={title}
      {...controlProps}
      className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none transition focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
    >
      {children}
    </select>
  );
}

function TextInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10",
        className
      )}
    />
  );
}

function FormLabel({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
        {label}
        {help ? <InfoTip text={help} /> : null}
      </span>
      {children}
    </label>
  );
}

function Th({ children, help }: { children: React.ReactNode; help?: string }) {
  return (
    <th className="border-b border-slate-200 bg-slate-50 px-3 py-2.5">
      <span className="inline-flex items-center gap-1.5">
        {children}
        {help ? <InfoTip text={help} /> : null}
      </span>
    </th>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span
      className="group relative inline-flex size-4 items-center justify-center rounded-full text-slate-400 outline-none transition hover:bg-slate-100 hover:text-slate-700 focus-visible:bg-slate-100 focus-visible:text-slate-700"
      tabIndex={0}
      aria-label={text}
      title={text}
    >
      <IconInfoCircle className="size-3.5" />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-64 -translate-x-1/2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-left text-[11px] font-medium leading-4 text-white shadow-xl group-hover:block group-focus-visible:block"
      >
        {text}
        <span className="absolute left-1/2 top-full size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-slate-800 bg-slate-950" />
      </span>
    </span>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b border-slate-100 px-3 py-3 align-top text-sm text-slate-700">
      {children}
    </td>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-slate-500">
        {label}
      </td>
    </tr>
  );
}

function ProviderBadge({
  binding,
  onSync,
}: {
  binding: BillingProviderBinding;
  onSync?: (bindingId: string) => void;
}) {
  const risky =
    binding.status === "sync_failed" ||
    (binding.provider === "airwallex" && binding.status === "active" && !binding.providerPriceId);
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
          risky
            ? "border-red-200 bg-red-50 text-red-700"
            : binding.status === "active"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
        )}
        title={
          binding.syncError ??
          binding.providerPriceId ??
          binding.providerProductId ??
          providerHelp(binding.provider)
        }
      >
        {risky ? <IconAlertTriangle className="size-3" /> : <IconCircleCheck className="size-3" />}
        {providerLabel(binding.provider)}
      </span>
      {onSync && binding.provider !== "manual" && binding.provider !== "internal" ? (
        <button
          type="button"
          onClick={() => onSync(binding.id)}
          className="inline-flex size-6 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
          title="同步供应商价格"
        >
          <IconCloudUpload className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

function PromotionProviderBadge({
  binding,
  onSync,
}: {
  binding: BillingPromotionProviderBinding;
  onSync: (bindingId: string) => void;
}) {
  const risky =
    binding.status === "sync_failed" || (binding.status === "active" && !binding.providerCouponId);
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
          risky
            ? "border-red-200 bg-red-50 text-red-700"
            : binding.status === "active"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-slate-50 text-slate-600"
        )}
        title={binding.syncError ?? binding.providerCouponId ?? providerHelp(binding.provider)}
      >
        {risky ? <IconAlertTriangle className="size-3" /> : <IconCircleCheck className="size-3" />}
        {providerLabel(binding.provider)}
      </span>
      {binding.provider !== "manual" && binding.provider !== "internal" ? (
        <button
          type="button"
          onClick={() => onSync(binding.id)}
          className="inline-flex size-6 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950"
          title="同步供应商优惠券"
        >
          <IconCloudUpload className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}

function RiskText({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] font-medium text-red-600">{children}</span>;
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "success" | "risk" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
        tone === "success" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "risk" && "border-red-200 bg-red-50 text-red-700",
        tone === "muted" && "border-slate-200 bg-slate-50 text-slate-600"
      )}
    >
      {children}
    </span>
  );
}

function OrderStatusPill({ status }: { status: BillingOrderStatus }) {
  const tone =
    status === "fulfilled" || status === "paid"
      ? "success"
      : status === "failed" || status === "expired"
        ? "risk"
        : "muted";
  return <StatusPill tone={tone}>{orderStatusLabel(status)}</StatusPill>;
}

function RefundStatusPill({ status }: { status: BillingRefundStatus }) {
  const tone =
    status === "succeeded"
      ? "success"
      : status === "failed" || status === "canceled"
        ? "risk"
        : "muted";
  return <StatusPill tone={tone}>{refundStatusLabel(status)}</StatusPill>;
}

function ProviderEventStatusPill({ status }: { status: PaymentProviderEventStatus }) {
  const tone = status === "processed" ? "success" : status === "failed" ? "risk" : "muted";
  return <StatusPill tone={tone}>{providerEventStatusLabel(status)}</StatusPill>;
}

function PromotionStatusPill({ status }: { status: BillingPromotionStatus }) {
  const tone = status === "active" ? "success" : status === "archived" ? "risk" : "muted";
  return <StatusPill tone={tone}>{promotionStatusLabel(status)}</StatusPill>;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

async function requestEnvelope<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    message?: string;
    data?: T;
  } | null;
  if (!response.ok || payload?.code !== 200) {
    throw new Error(payload?.msg ?? payload?.message ?? `请求失败：${response.status}`);
  }
  return payload.data as T;
}

async function mutateEnvelope<T = unknown>(
  url: string,
  body: Record<string, unknown>,
  method = "POST"
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    message?: string;
    data?: T;
  } | null;
  if (!response.ok || payload?.code !== 200) {
    throw new Error(payload?.msg ?? payload?.message ?? `请求失败：${response.status}`);
  }
  return payload.data as T;
}

function buildRefundQuotePayload(form: FormData): Record<string, unknown> {
  return {
    orderId: stringField(form, "orderId"),
    reasonCode: stringField(form, "reasonCode") || undefined,
    ...refundAmountChoice(form),
  };
}

function buildRefundCreatePayload(
  form: FormData,
  quote: BillingRefundQuoteData | null
): Record<string, unknown> {
  const orderId = stringField(form, "orderId");
  const amountChoice = refundAmountChoice(form);
  const mode = stringField(form, "refundMode") || "suggested";
  if (!quote || quote.order.id !== orderId) {
    throw new Error("请先评估当前订单的退款。");
  }
  if (quote.blockers.length > 0) {
    throw new Error("当前评估存在阻断项，不能提交自动退款。");
  }
  if (mode === "suggested") {
    if (quote.policy.calculationMode !== "suggested") {
      throw new Error("退款方式已变化，请重新评估。");
    }
    amountChoice.amountMinor = quote.requestedAmountMinor;
  } else if (
    mode === "amount" &&
    (quote.policy.calculationMode !== "amount" ||
      amountChoice.amountMinor !== quote.requestedAmountMinor)
  ) {
    throw new Error("退款金额已变化，请重新评估。");
  } else if (
    mode === "percent" &&
    (quote.policy.calculationMode !== "percent" ||
      amountChoice.percentBps !== quote.requestedPercentBps)
  ) {
    throw new Error("退款比例已变化，请重新评估。");
  }

  return {
    orderId,
    ...amountChoice,
    reasonCode: stringField(form, "reasonCode"),
    operatorNote: stringField(form, "operatorNote") || undefined,
  };
}

function refundAmountChoice(form: FormData): {
  amountMinor?: string;
  percentBps?: number;
} {
  const mode = stringField(form, "refundMode") || "suggested";
  if (mode === "amount") {
    const amountMinor = stringField(form, "amountMinor");
    if (!amountMinor) throw new Error("请输入退款金额。");
    return { amountMinor };
  }
  if (mode === "percent") {
    const percent = Number(stringField(form, "refundPercent"));
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new Error("退款比例必须大于 0 且不超过 100。");
    }
    return { percentBps: Math.round(percent * 100) };
  }
  return {};
}

function stringField(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function providerLabel(provider: string) {
  const labels: Record<string, string> = {
    airwallex: "Airwallex",
    wechat_pay: "微信支付",
    manual: "线下确认",
    internal: "内部发放",
  };
  return labels[provider] ?? provider;
}

function providerHelp(provider: string) {
  const labels: Record<string, string> = {
    airwallex: "国际站支付供应商。用于银行卡、本地支付、订阅、优惠券同步和结算对账。",
    wechat_pay: "中国站支付供应商。只在中国站部署中使用，不和国际站数据库共享。",
    manual: "后台确认的线下收款或企业转账。不是兑换码，仍然必须走订单、履约、ledger 和审计。",
    internal: "平台内部承担成本的发放，例如迁移补偿、运营赠送或 100% 免费兑换码的零元订单。",
  };
  return labels[provider] ?? provider;
}

function productTypeLabel(value: string) {
  const labels: Record<string, string> = {
    community_point_pack: "社区积分",
    bubble_pack: "算力积分",
    membership_plan: "会员",
    team_membership_plan: "团队会员",
  };
  return labels[value] ?? value;
}

function productTypeHelp(value: string) {
  const labels: Record<string, string> = {
    community_point_pack: "购买后发放可消费社区积分；可提现社区积分只能来自创作者收入。",
    bubble_pack: "购买后发放算力积分，用于 AI 生成等平台能力消耗。",
    membership_plan: "购买后开通个人会员权益，可按月/年订阅或一次性购买。",
    team_membership_plan: "购买后开通工作区或团队会员权益。",
  };
  return labels[value] ?? value;
}

function intervalLabel(value: string) {
  const labels: Record<string, string> = { one_time: "一次性", month: "月付", year: "年付" };
  return labels[value] ?? value;
}

function orderStatusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    pending_payment: "待支付",
    paid: "已支付",
    fulfilled: "已履约",
    canceled: "已取消",
    expired: "已过期",
    failed: "失败",
    refunded: "已退款",
    partially_refunded: "部分退款",
  };
  return labels[value] ?? value;
}

function refundStatusLabel(value: string) {
  const labels: Record<string, string> = {
    requested: "已请求",
    provider_pending: "渠道处理中",
    succeeded: "成功",
    failed: "失败",
    canceled: "已取消",
  };
  return labels[value] ?? value;
}

function providerEventStatusLabel(value: string) {
  const labels: Record<string, string> = {
    received: "已接收",
    processed: "已处理",
    ignored: "已忽略",
    failed: "失败",
  };
  return labels[value] ?? value;
}

function promotionStatusLabel(value: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    active: "启用",
    paused: "暂停",
    archived: "归档",
  };
  return labels[value] ?? value;
}

function walletCurrencyLabel(value: string | null) {
  const labels: Record<string, string> = {
    bubble: "算力积分",
    community_point: "社区积分",
  };
  return value ? (labels[value] ?? value) : "钱包";
}

function ledgerJournalTypeLabel(value: string) {
  const labels: Record<string, string> = {
    payment_capture: "支付入账",
    fulfillment_allocation: "履约分配",
    settlement: "结算",
    refund: "退款",
    chargeback: "拒付",
    revenue_recognition: "收入确认",
    provider_fee: "渠道费用",
    manual_adjustment: "人工调整",
    reversal: "反向冲销",
  };
  return labels[value] ?? value;
}

function ledgerJournalTypeHelp(value: string) {
  const labels: Record<string, string> = {
    payment_capture: "支付供应商确认收款后入账：借记渠道应收，贷记客户资金清算。",
    fulfillment_allocation: "订单履约后把客户资金清算到钱包负债、递延会员收入或即时收入。",
    settlement: "渠道结算/打款到账时的 journal，用于核对 provider payout。",
    refund: "退款发生时冲减原支付和履约影响，必须可追溯到原订单。",
    chargeback: "渠道拒付或争议扣款，和普通退款区分处理。",
    revenue_recognition: "递延会员收入按服务期确认收入。",
    provider_fee: "支付渠道手续费，从结算批次或 provider fee 明细生成。",
    manual_adjustment: "财务纠错分录。不能作为常规发积分入口，必须带审计原因。",
    reversal: "反向冲销已 posted journal，保留原分录不可删除。",
  };
  return labels[value] ?? value;
}

function settlementStatusLabel(value: string) {
  const labels: Record<string, string> = {
    pending: "待对账",
    reconciled: "已对账",
    partially_reconciled: "部分对账",
    failed: "失败",
  };
  return labels[value] ?? value;
}

function reconciliationStatusLabel(value: string) {
  const labels: Record<string, string> = {
    running: "运行中",
    completed: "已完成",
    failed: "失败",
  };
  return labels[value] ?? value;
}

function reconciliationItemStatusLabel(value: string) {
  const labels: Record<string, string> = {
    matched: "已匹配",
    mismatch: "金额不一致",
    missing_internal: "内部缺失",
    missing_provider: "渠道缺失",
    ignored: "已忽略",
  };
  return labels[value] ?? value;
}

function promotionDiscountLabel(promotion: BillingPromotionRow) {
  return `${promotion.percentOffBps / 100}%`;
}

function promotionScopeLabel(promotion: BillingPromotionRow) {
  if (promotion.appliesPrice) {
    return `${promotion.appliesPrice.name} · ${formatMoneyMinor(
      promotion.appliesPrice.amountMinor,
      promotion.appliesPrice.currency
    )}`;
  }
  if (promotion.appliesItem) {
    return `${promotion.appliesItem.name} · ${productTypeLabel(promotion.appliesItem.productType)}`;
  }
  if (promotion.appliesProductType) {
    return productTypeLabel(promotion.appliesProductType);
  }
  return "全部商品";
}

function isInternalFreePromotion(promotion: BillingPromotionRow) {
  return promotion.percentOffBps === 10000;
}

function grantLabel(price: BillingPriceRow) {
  if (price.grantsWalletCurrency && price.grantsWalletAmount) {
    const kind = price.grantsWalletBalanceKind
      ? ` · ${balanceKindLabel(price.grantsWalletBalanceKind)}`
      : "";
    return `${formatInteger(price.grantsWalletAmount)} ${currencyLabel(price.grantsWalletCurrency)}${kind}`;
  }
  if (price.grantsPlanKey) return `会员权益 ${price.grantsPlanKey}`;
  return "无自动权益";
}

function currencyLabel(value: string) {
  const labels: Record<string, string> = {
    community_point: "社区积分",
    bubble: "算力积分",
  };
  return labels[value] ?? value;
}

function balanceKindLabel(value: string) {
  const labels: Record<string, string> = {
    consumable: "可消费",
    withdrawable: "可提现",
  };
  return labels[value] ?? value;
}

function formatMoneyMinor(amountMinor: string, currency: string) {
  const value = BigInt(amountMinor);
  const zero = BigInt(0);
  const centsPerUnit = BigInt(100);
  const sign = value < zero ? "-" : "";
  const abs = value < zero ? -value : value;
  const major = abs / centsPerUnit;
  const minor = abs % centsPerUnit;
  return `${currency} ${sign}${major.toString()}.${minor.toString().padStart(2, "0")}`;
}

function formatNullableMoneyMinor(amountMinor: string | null, currency: string) {
  return amountMinor ? formatMoneyMinor(amountMinor, currency) : "-";
}

function formatInteger(value: string) {
  return new Intl.NumberFormat("zh-CN").format(Number(value));
}

function formatBpsPercent(value: number) {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
