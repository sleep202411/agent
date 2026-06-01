"use client";

import { Children, isValidElement, useEffect, useMemo, useState } from "react";
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
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/admin/page-header";
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
  ledgerEntryCount: number;
  updatedAt: string;
};

type WalletLedgerEntryRow = {
  id: string;
  transactionId: string;
  accountId: string;
  ownerType: string;
  ownerId: string;
  entryType: string;
  currency: string;
  balanceKind: string;
  amount: string;
  availableDelta: string;
  heldDelta: string;
  availableBalanceAfter: string;
  heldBalanceAfter: string;
  reason: string;
  sourceType: string;
  sourceId: string | null;
  idempotencyKey: string;
  description: string | null;
  createdAt: string;
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
  walletLedgerEntries: WalletLedgerEntryRow[];
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
  walletLedgerEntries: [],
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
  const [createPriceDialogOpen, setCreatePriceDialogOpen] = useState(false);
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
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const provider = stringField(form, "provider");
    const walletCurrency = stringField(form, "grantsWalletCurrency");
    const walletAmount = stringField(form, "grantsWalletAmount");
    const planKey = stringField(form, "grantsPlanKey");
    const grantDurationDays = stringField(form, "grantDurationDays");
    const productType = stringField(form, "productType");
    const currency = stringField(form, "currency").toUpperCase();
    const amountMinor = stringField(form, "amountMinor");
    try {
      await mutateEnvelope("/api/admin/billing/prices", {
        itemCode: buildBillingItemCode({
          productType,
          walletAmount,
          planKey,
          currency,
          amountMinor,
        }),
        itemName: stringField(form, "itemName"),
        itemDescription: stringField(form, "itemDescription") || undefined,
        productType,
        currency,
        amountMinor,
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
      formElement.reset();
      setCreatePriceDialogOpen(false);
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
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="订单积分运营台"
        description="内部商品和价格是事实源，Airwallex 与微信支付只作为 provider binding。"
        actions={
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
        }
      />

      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-2 xl:grid-cols-[auto_auto_auto]">
            <BillingNavGroup label="配置">
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
            </BillingNavGroup>
            <BillingNavGroup label="交易">
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
            </BillingNavGroup>
            <BillingNavGroup label="账务">
              <TabButton
                active={activeTab === "wallet"}
                onClick={() => setActiveTab("wallet")}
                icon={IconWallet}
              >
                积分钱包
              </TabButton>
              <TabButton
                active={activeTab === "ledger"}
                onClick={() => setActiveTab("ledger")}
                icon={IconScale}
              >
                资金账本
              </TabButton>
            </BillingNavGroup>
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
          createDialogOpen={createPriceDialogOpen}
          onProductTypeChange={setPriceProductType}
          onProviderChange={setPriceProvider}
          onCreateDialogOpenChange={setCreatePriceDialogOpen}
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
          entries={overview.walletLedgerEntries}
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

function AdminDialog({
  open,
  title,
  description,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-billing-dialog-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 id="admin-billing-dialog-title" className="text-base font-semibold text-slate-950">
              {title}
            </h3>
            {description ? (
              <p className="mt-1 max-w-xl text-sm leading-5 text-slate-600">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
            aria-label="关闭"
          >
            <IconX className="size-4" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
      </section>
    </div>
  );
}

function CatalogView({
  prices,
  productType,
  provider,
  loading,
  createDialogOpen,
  onProductTypeChange,
  onProviderChange,
  onCreateDialogOpenChange,
  onRefresh,
  onCreatePrice,
  onSyncBinding,
}: {
  prices: BillingPriceRow[];
  productType: string;
  provider: string;
  loading: boolean;
  createDialogOpen: boolean;
  onProductTypeChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onCreateDialogOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onCreatePrice: (event: React.FormEvent<HTMLFormElement>) => void;
  onSyncBinding: (bindingId: string) => void;
}) {
  const columns = useMemo<ColumnDef<BillingPriceRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "商品",
        cell: ({ row }) => {
          const price = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{price.name}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {price.code} · {productTypeLabel(price.productType)}
              </p>
            </>
          );
        },
      },
      {
        id: "price",
        header: "价格",
        enableSorting: false,
        cell: ({ row }) => {
          const price = row.original;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">
                {formatMoneyMinor(price.amountMinor, price.currency)}
              </p>
              <p className="text-[12px] text-slate-500">
                {intervalLabel(price.interval)} · {price.subjectType}
              </p>
            </>
          );
        },
      },
      {
        id: "grant",
        header: () => (
          <ColumnHeader help="订单支付成功后的履约结果：积分到账、会员权益开通，或无自动权益。">
            权益
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const price = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{grantLabel(price)}</p>
              <p className="text-[12px] text-slate-500">
                {price.grantDurationDays ? `${price.grantDurationDays} 天` : "长期/一次性"}
              </p>
            </>
          );
        },
      },
      {
        id: "binding",
        header: () => (
          <ColumnHeader help="内部价格和支付供应商价格/商品 ID 的绑定。Airwallex/微信需要同步，线下确认和内部发放不需要。">
            Provider Binding
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const price = row.original;
          return (
            <div className="flex max-w-[360px] flex-wrap gap-1.5">
              {price.providerBindings.map((binding) => (
                <ProviderBadge key={binding.id} binding={binding} onSync={onSyncBinding} />
              ))}
              {!price.providerBindings.length ? <RiskText>未配置渠道</RiskText> : null}
            </div>
          );
        },
      },
      {
        id: "sales",
        header: "销售",
        enableSorting: false,
        cell: ({ row }) => {
          const price = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{price.counts.orders} 订单</p>
              <p className="text-[12px] text-slate-500">{price.counts.subscriptions} 订阅</p>
            </>
          );
        },
      },
      {
        accessorKey: "isActive",
        header: "状态",
        cell: ({ row }) => {
          const price = row.original;
          return (
            <>
              <StatusPill tone={price.isActive && !price.archivedAt ? "success" : "muted"}>
                {price.isActive && !price.archivedAt ? "active" : "inactive"}
              </StatusPill>
              <p className="mt-1 text-[11px] text-slate-400">{formatDate(price.updatedAt)}</p>
            </>
          );
        },
      },
    ],
    // onSyncBinding is a render-stable closure used only in an onClick; the
    // column defs never need to rebuild for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">商品目录与价格版本</h3>
              <p className="mt-1 text-[12px] text-slate-500">
                社区积分、算力积分和会员套餐统一从内部价格出发。
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[180px_160px_auto_auto]">
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
              <Button size="sm" onClick={() => onCreateDialogOpenChange(true)} disabled={loading}>
                <IconPlus className="size-3.5" />
                新建套餐
              </Button>
            </div>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={prices}
          loading={loading}
          minWidth={1120}
          pageSize={20}
          emptyLabel="暂无商品价格"
          className="rounded-none border-0"
        />
      </section>

      <AdminDialog
        open={createDialogOpen}
        title="新建套餐"
        description="创建内部商品价格；支付供应商只通过 binding 同步，套餐权益直接进入当前 billing 钱包账本。"
        onClose={() => onCreateDialogOpenChange(false)}
      >
        <CreatePriceForm
          loading={loading}
          onSubmit={onCreatePrice}
          onCancel={() => onCreateDialogOpenChange(false)}
        />
      </AdminDialog>
    </>
  );
}

function CreatePriceForm({
  loading,
  onSubmit,
  onCancel,
}: {
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [productType, setProductType] = useState("community_point_pack");
  const [walletCurrency, setWalletCurrency] = useState("community_point");
  const [walletAmount, setWalletAmount] = useState("");
  const [planKey, setPlanKey] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [amountMinor, setAmountMinor] = useState("");

  const generatedItemCode = buildBillingItemCode({
    productType,
    walletAmount,
    planKey,
    currency,
    amountMinor,
  });

  function handleProductTypeChange(value: string) {
    setProductType(value);
    if (value === "community_point_pack") {
      setWalletCurrency("community_point");
    } else if (value === "bubble_pack") {
      setWalletCurrency("bubble");
    } else {
      setWalletCurrency("");
    }
  }

  function handleWalletCurrencyChange(value: string) {
    setWalletCurrency(value);
    if (!value) setWalletAmount("");
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormLabel
        label="商品名称"
        help="运营后台展示名，不等同于支付供应商侧商品名；同步时会复制到 provider payload。"
      >
        <TextInput name="itemName" required placeholder="1000 社区积分" />
      </FormLabel>
      <FormLabel
        label="商品类型"
        help="决定订单类型和履约方向：算力积分、社区积分、个人会员或团队会员。"
      >
        <Select name="productType" value={productType} onChange={handleProductTypeChange}>
          <option value="community_point_pack" title={productTypeHelp("community_point_pack")}>
            社区积分
          </option>
          <option value="bubble_pack" title={productTypeHelp("bubble_pack")}>
            算力积分
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
          <TextInput
            name="currency"
            required
            maxLength={3}
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            placeholder="USD"
          />
        </FormLabel>
        <FormLabel
          label="金额 minor"
          help="法币最小单位金额。USD 9900 表示 99.00 美元，CNY 9900 表示 99.00 元。"
        >
          <TextInput
            name="amountMinor"
            required
            inputMode="numeric"
            value={amountMinor}
            onChange={(event) => setAmountMinor(event.target.value)}
            placeholder="9900"
          />
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
        <FormLabel label="主体" help="权益归属对象。个人会员/积分通常归用户，团队会员可归工作区。">
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
          <Select
            name="grantsWalletCurrency"
            value={walletCurrency}
            onChange={handleWalletCurrencyChange}
          >
            <option value="">不发放积分</option>
            <option value="bubble">算力积分</option>
            <option value="community_point">社区积分</option>
          </Select>
          <TextInput
            name="grantsWalletAmount"
            inputMode="numeric"
            required={Boolean(walletCurrency)}
            disabled={!walletCurrency}
            value={walletAmount}
            onChange={(event) => setWalletAmount(event.target.value)}
            placeholder="发放数量"
          />
          <TextInput
            name="grantsPlanKey"
            value={planKey}
            onChange={(event) => setPlanKey(event.target.value)}
            placeholder="会员 plan key"
          />
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
      <AutoCodePreview code={generatedItemCode} />
      <div className="-mx-5 -mb-5 mt-1 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button type="submit" disabled={loading}>
          <IconPlus className="size-3.5" />
          {loading ? "创建中" : "创建套餐"}
        </Button>
      </div>
    </form>
  );
}

function AutoCodePreview({ code }: { code: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold text-slate-500">商品编码</span>
        <StatusPill tone="muted">自动生成</StatusPill>
      </div>
      <p className="mt-1 break-all font-mono text-[12px] font-semibold text-slate-900">{code}</p>
    </div>
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
  const columns = useMemo<ColumnDef<BillingPromotionRow, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        header: "券码",
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-semibold text-slate-950">{promotion.code}</p>
              <p className="mt-0.5 text-sm font-medium text-slate-800">{promotion.name}</p>
            </>
          );
        },
      },
      {
        id: "discount",
        header: "折扣",
        enableSorting: false,
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">
                {promotionDiscountLabel(promotion)}
              </p>
              <p className="text-[12px] text-slate-500">{promotion.durationType}</p>
            </>
          );
        },
      },
      {
        id: "scope",
        header: "适用范围",
        enableSorting: false,
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{promotionScopeLabel(promotion)}</p>
              <p className="text-[12px] text-slate-500">
                {promotion.startsAt ? formatDate(promotion.startsAt) : "立即"} -{" "}
                {promotion.endsAt ? formatDate(promotion.endsAt) : "长期"}
              </p>
            </>
          );
        },
      },
      {
        id: "coupon",
        header: () => (
          <ColumnHeader help="支付供应商侧的优惠券 ID。100% 免费兑换码可不绑定供应商，系统内部创建零元订单并履约。">
            Provider Coupon
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <div className="flex max-w-[360px] flex-wrap gap-1.5">
              {promotion.providerBindings.map((binding) => (
                <PromotionProviderBadge key={binding.id} binding={binding} onSync={onSyncBinding} />
              ))}
              {!promotion.providerBindings.length ? (
                isInternalFreePromotion(promotion) ? (
                  <StatusPill tone="muted">内部零元券</StatusPill>
                ) : (
                  <RiskText>未配置渠道券</RiskText>
                )
              ) : null}
            </div>
          );
        },
      },
      {
        id: "redemptions",
        header: "限制/核销",
        enableSorting: false,
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">
                {promotion.redemptionCount} / {promotion.maxRedemptions ?? "∞"}
              </p>
              <p className="text-[12px] text-slate-500">
                单用户 {promotion.maxRedemptionsPerUser ?? "∞"}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <>
              <PromotionStatusPill status={promotion.status} />
              <p className="mt-1 text-[11px] text-slate-400">{formatDate(promotion.updatedAt)}</p>
            </>
          );
        },
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => {
          const promotion = row.original;
          return (
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
          );
        },
      },
    ],
    // onPromotionStatus / onSyncBinding are render-stable closures used only in
    // onClick; the column defs only need to rebuild when loading toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading]
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_150px_150px_auto]">
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <TextInput
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                className="pl-9 pr-3"
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
        <DataTable
          columns={columns}
          data={promotions}
          loading={loading}
          minWidth={1160}
          pageSize={20}
          emptyLabel="暂无促销券"
          className="rounded-none border-0"
        />
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
  const columns = useMemo<ColumnDef<BillingOrderRow, unknown>[]>(
    () => [
      {
        accessorKey: "orderNo",
        header: "订单",
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">{order.orderNo}</p>
              <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-slate-500">
                {order.idempotencyKey}
              </p>
            </>
          );
        },
      },
      {
        id: "item",
        header: "商品",
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{order.item.name}</p>
              <p className="text-[12px] text-slate-500">
                {order.item.code} · {order.orderType}
              </p>
            </>
          );
        },
      },
      {
        id: "amount",
        header: "金额",
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
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
            </>
          );
        },
      },
      {
        id: "provider",
        header: () => (
          <ColumnHeader help="实际支付或履约来源；优惠码/兑换码会体现在折扣和订单履约，不作为渠道。">
            支付渠道
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{providerLabel(order.provider)}</p>
              <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                {order.paymentIntent?.providerStatus ?? "-"}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <OrderStatusPill status={order.status} />
              <p className="mt-1 text-[11px] text-slate-500">
                {order.paymentIntent?.status ?? "no_intent"}
              </p>
            </>
          );
        },
      },
      {
        id: "user",
        header: "用户/主体",
        enableSorting: false,
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="max-w-[180px] truncate text-[12px] text-slate-700">{order.userId}</p>
              <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                {order.subjectType}:{order.subjectId}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "时间",
        cell: ({ row }) => {
          const order = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">{formatDate(order.createdAt)}</p>
              <p className="text-[11px] text-slate-500">
                {order.fulfilledAt ? `履约 ${formatDate(order.fulfilledAt)}` : "未履约"}
              </p>
            </>
          );
        },
      },
    ],
    []
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_160px_150px_auto]">
          <label className="relative block">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <TextInput
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="pl-9 pr-3"
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
      <DataTable
        columns={columns}
        data={orders}
        loading={loading}
        minWidth={1140}
        pageSize={20}
        emptyLabel="暂无订单"
        className="rounded-none border-0"
      />
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

  const columns = useMemo<ColumnDef<BillingRefundRow, unknown>[]>(
    () => [
      {
        accessorKey: "refundNo",
        header: "退款",
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">{refund.refundNo}</p>
              <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-slate-500">
                {refund.providerRefundId ?? refund.requestId}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "orderNo",
        header: "订单",
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">{refund.orderNo}</p>
              <p className="text-[12px] text-slate-500">
                {refund.order.item.name} · {refund.order.userId}
              </p>
            </>
          );
        },
      },
      {
        id: "amount",
        header: "金额",
        enableSorting: false,
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">
                {formatMoneyMinor(refund.amountMinor, refund.currency)}
              </p>
              <p className="text-[12px] text-slate-500">{refund.reasonCode}</p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: () => (
          <ColumnHeader help="内部状态决定是否已记账；provider 状态保留 Airwallex/微信原始状态。">
            状态
          </ColumnHeader>
        ),
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <RefundStatusPill status={refund.status} />
              <p className="mt-1 text-[11px] text-slate-500">
                {refund.providerStatus ?? "provider_pending"}
              </p>
            </>
          );
        },
      },
      {
        id: "reversal",
        header: () => (
          <ColumnHeader help="已履约订单退款前会先冲回可用积分或撤销会员权益，避免退款后权益仍可消费。">
            权益冲回
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
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
            </>
          );
        },
      },
      {
        id: "failure",
        header: "失败原因",
        enableSorting: false,
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <p className="max-w-[240px] truncate text-[12px] text-slate-700">
                {refund.failureMessage ?? refund.operatorNote ?? "-"}
              </p>
              <p className="text-[11px] text-slate-500">{refund.failureCode ?? "-"}</p>
            </>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "时间",
        cell: ({ row }) => {
          const refund = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">{formatDate(refund.createdAt)}</p>
              <p className="text-[11px] text-slate-500">
                {refund.succeededAt
                  ? `成功 ${formatDate(refund.succeededAt)}`
                  : refund.failedAt
                    ? `失败 ${formatDate(refund.failedAt)}`
                    : "未完成"}
              </p>
            </>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="grid gap-2 lg:grid-cols-[minmax(260px,1fr)_170px_150px_auto]">
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <TextInput
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                className="pl-9 pr-3"
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
        <DataTable
          columns={columns}
          data={refunds}
          loading={loading}
          minWidth={1180}
          pageSize={20}
          emptyLabel="暂无退款"
          className="rounded-none border-0"
        />
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
  const columns = useMemo<ColumnDef<BillingProviderEventRow, unknown>[]>(
    () => [
      {
        id: "event",
        header: () => (
          <ColumnHeader help="供应商事件 ID 是 webhook 幂等键，同一个事件只能处理一次。">
            事件
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const event = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{providerLabel(event.provider)}</p>
              <p className="mt-0.5 font-mono text-[12px] text-slate-700">{event.eventType}</p>
              <p
                className="mt-0.5 max-w-[260px] truncate font-mono text-[11px] text-slate-500"
                title={event.providerEventId}
              >
                {event.providerEventId}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: () => (
          <ColumnHeader help="received 表示已入库待处理，failed 表示处理异常已保留，ignored 表示人工关闭。">
            状态
          </ColumnHeader>
        ),
        cell: ({ row }) => {
          const event = row.original;
          return (
            <>
              <ProviderEventStatusPill status={event.status} />
              <p className="mt-1 text-[11px] text-slate-500">
                {event.processedAt ? `处理 ${formatDate(event.processedAt)}` : "待处理"}
              </p>
            </>
          );
        },
      },
      {
        id: "business",
        header: () => (
          <ColumnHeader help="事件匹配到的内部订单、payment intent 或退款记录。">
            关联业务
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const event = row.original;
          return (
            <>
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
                  title={event.paymentIntent.providerPaymentIntentId ?? event.paymentIntent.id}
                >
                  PI {event.paymentIntent.providerStatus ?? event.paymentIntent.status}
                </p>
              ) : null}
            </>
          );
        },
      },
      {
        id: "payload",
        header: () => (
          <ColumnHeader help="供应商 payload 中关键定位字段，便于和 Airwallex 后台交叉检索。">
            Payload 摘要
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const event = row.original;
          return (
            <div className="space-y-1 text-[12px] text-slate-700">
              <PayloadLine label="data" value={event.payloadSummary?.dataId} />
              <PayloadLine label="status" value={event.payloadSummary?.dataStatus} />
              <PayloadLine label="checkout" value={event.payloadSummary?.billingCheckoutId} />
              <PayloadLine label="request" value={event.payloadSummary?.requestId} />
              <PayloadLine
                label="refund"
                value={event.payloadSummary?.refundId ?? event.refund?.providerRefundId}
              />
            </div>
          );
        },
      },
      {
        id: "error",
        header: () => <ColumnHeader help="处理失败原因或人工忽略原因。">异常/原因</ColumnHeader>,
        enableSorting: false,
        cell: ({ row }) => {
          const event = row.original;
          return (
            <p
              className={cn(
                "max-w-[260px] text-[12px] leading-5",
                event.status === "failed" ? "text-red-700" : "text-slate-600"
              )}
              title={event.error ?? undefined}
            >
              {event.error ?? "-"}
            </p>
          );
        },
      },
      {
        id: "ledger",
        header: () => (
          <ColumnHeader help="事件触发的账务 journal；支付、履约、退款都必须可追溯。">
            账务
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const event = row.original;
          return (
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
          );
        },
      },
      {
        accessorKey: "receivedAt",
        header: "时间",
        cell: ({ row }) => {
          const event = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">{formatDate(event.receivedAt)}</p>
              <p className="text-[11px] text-slate-500">接收</p>
            </>
          );
        },
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => {
          const event = row.original;
          const canOperate = event.status !== "processed";
          return canOperate ? (
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
                onChange={(inputEvent) => onIgnoreReasonChange(event.id, inputEvent.target.value)}
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
          );
        },
      },
    ],
    // onReprocess / onIgnore / onIgnoreReasonChange are render-stable closures
    // used only in onClick/onChange; the action cell also reads loading and the
    // ignoreReasons map, so rebuild on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, ignoreReasons]
  );

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
              <TextInput
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                className="pl-9 pr-3"
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
      <DataTable
        columns={columns}
        data={events}
        loading={loading}
        minWidth={1360}
        pageSize={20}
        emptyLabel="暂无支付供应商事件"
        className="rounded-none border-0"
      />
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
  entries,
  metrics,
  recentOrders,
}: {
  accounts: WalletAccountRow[];
  entries: WalletLedgerEntryRow[];
  metrics: AdminBillingOverviewData["metrics"];
  recentOrders: BillingOrderRow[];
}) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;
  const selectedAccountEntries = selectedAccount
    ? entries.filter((entry) => entry.accountId === selectedAccount.id)
    : [];

  const columns = useMemo<ColumnDef<WalletAccountRow, unknown>[]>(
    () => [
      {
        id: "account",
        header: "账户",
        enableSorting: false,
        cell: ({ row }) => {
          const account = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{account.ownerType}</p>
              <p className="max-w-[220px] truncate text-[11px] text-slate-500">{account.ownerId}</p>
            </>
          );
        },
      },
      {
        accessorKey: "currency",
        header: () => (
          <ColumnHeader help="平台钱包币种，不是法币。算力积分和社区积分相互隔离。">
            币种
          </ColumnHeader>
        ),
        cell: ({ row }) => currencyLabel(row.original.currency),
      },
      {
        accessorKey: "balanceKind",
        header: () => (
          <ColumnHeader help="可消费余额用于购买内容/服务；可提现余额只来自创作者收入，暂不开放提现流程。">
            余额类型
          </ColumnHeader>
        ),
        cell: ({ row }) => balanceKindLabel(row.original.balanceKind),
      },
      {
        accessorKey: "availableBalance",
        header: "可用余额",
        cell: ({ row }) => formatInteger(row.original.availableBalance),
      },
      {
        accessorKey: "heldBalance",
        header: "冻结",
        cell: ({ row }) => formatInteger(row.original.heldBalance),
      },
      {
        accessorKey: "ledgerEntryCount",
        header: "流水",
        cell: ({ row }) => formatInteger(String(row.original.ledgerEntryCount)),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const account = row.original;
          return (
            <StatusPill tone={account.status === "active" ? "success" : "muted"}>
              {account.status}
            </StatusPill>
          );
        },
      },
      {
        accessorKey: "updatedAt",
        header: "更新时间",
        cell: ({ row }) => formatDate(row.original.updatedAt),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSelectedAccountId(row.original.id)}
          >
            查看
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-950">钱包账户余额</h3>
          <p className="mt-1 text-[12px] text-slate-500">
            每行是一个用户或工作区的钱包账户；点击查看可打开余额详情和真实流水。
          </p>
        </div>
        <DataTable
          columns={columns}
          data={accounts}
          minWidth={940}
          pageSize={20}
          emptyLabel="暂无钱包账户"
          className="rounded-none border-0"
        />
      </section>

      <div className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <h3 className="text-sm font-semibold text-slate-950">最近钱包流水</h3>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            最近已记账的 wallet ledger entry，不包含仅初始化的空账户。
          </p>
          <div className="mt-3 space-y-2">
            {entries.slice(0, 6).map((entry) => (
              <div key={entry.id} className="rounded-lg border border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-slate-950">
                      {walletEntryTypeLabel(entry.entryType)} · {currencyLabel(entry.currency)}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {entry.ownerType}:{entry.ownerId}
                    </p>
                  </div>
                  <span className="text-[12px] font-semibold text-slate-950">
                    {formatSignedInteger(entry.availableDelta)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{formatDate(entry.createdAt)}</p>
              </div>
            ))}
            {!entries.length ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[12px] text-slate-500">
                暂无钱包流水
              </div>
            ) : null}
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

      <WalletAccountDetailDialog
        account={selectedAccount}
        entries={selectedAccountEntries}
        onClose={() => setSelectedAccountId(null)}
      />
    </div>
  );
}

function WalletAccountDetailDialog({
  account,
  entries,
  onClose,
}: {
  account: WalletAccountRow | null;
  entries: WalletLedgerEntryRow[];
  onClose: () => void;
}) {
  const columns = useMemo<ColumnDef<WalletLedgerEntryRow, unknown>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "时间",
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
      {
        id: "action",
        header: "动作",
        enableSorting: false,
        cell: ({ row }) => {
          const entry = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">
                {walletEntryTypeLabel(entry.entryType)}
              </p>
              <p className="text-[11px] text-slate-500">{entry.reason}</p>
            </>
          );
        },
      },
      {
        accessorKey: "availableDelta",
        header: "可用变动",
        cell: ({ row }) => formatSignedInteger(row.original.availableDelta),
      },
      {
        accessorKey: "heldDelta",
        header: "冻结变动",
        cell: ({ row }) => formatSignedInteger(row.original.heldDelta),
      },
      {
        id: "balanceAfter",
        header: "余额后",
        enableSorting: false,
        cell: ({ row }) => {
          const entry = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{formatInteger(entry.availableBalanceAfter)}</p>
              <p className="text-[11px] text-slate-500">
                冻结 {formatInteger(entry.heldBalanceAfter)}
              </p>
            </>
          );
        },
      },
      {
        id: "source",
        header: "来源",
        enableSorting: false,
        cell: ({ row }) => {
          const entry = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{entry.sourceType}</p>
              <p
                className="max-w-[180px] truncate font-mono text-[11px] text-slate-500"
                title={entry.sourceId ?? entry.idempotencyKey}
              >
                {entry.sourceId ?? entry.idempotencyKey}
              </p>
            </>
          );
        },
      },
    ],
    []
  );

  return (
    <AdminDialog
      open={Boolean(account)}
      title="钱包账户详情"
      description={
        account
          ? `${account.ownerType}:${account.ownerId} · ${currencyLabel(account.currency)} · ${balanceKindLabel(account.balanceKind)}`
          : undefined
      }
      onClose={onClose}
    >
      {account ? (
        <div className="space-y-4">
          <section className="grid gap-2 sm:grid-cols-3">
            <Metric label="可用余额" value={formatInteger(account.availableBalance)} />
            <Metric label="冻结余额" value={formatInteger(account.heldBalance)} />
            <Metric label="流水条数" value={account.ledgerEntryCount} />
          </section>
          <section className="rounded-lg border border-slate-200">
            <div className="border-b border-slate-200 px-3 py-2">
              <h4 className="text-sm font-semibold text-slate-950">账户流水</h4>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <DataTable
                columns={columns}
                data={entries}
                minWidth={780}
                emptyLabel="暂无该账户流水"
                className="rounded-none border-0"
              />
            </div>
          </section>
        </div>
      ) : null}
    </AdminDialog>
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
  const journalColumns = useMemo<ColumnDef<BillingLedgerJournalRow, unknown>[]>(
    () => [
      {
        accessorKey: "journalNo",
        header: "Journal",
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">
                {journal.journalNo}
              </p>
              <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-slate-500">
                {journal.description ?? journal.id}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "journalType",
        header: () => (
          <ColumnHeader help="journal 类型描述资金事件的业务来源，例如支付入账、履约分配、结算或退款。">
            类型
          </ColumnHeader>
        ),
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <>
              <StatusPill tone={journal.status === "posted" ? "success" : "muted"}>
                {ledgerJournalTypeLabel(journal.journalType)}
              </StatusPill>
              <p className="mt-1 text-[11px] text-slate-500">
                {journal.provider ? providerLabel(journal.provider) : "platform"}
              </p>
            </>
          );
        },
      },
      {
        id: "debit",
        header: () => <ColumnHeader help="双分录借方合计，必须等于贷方合计。">借方</ColumnHeader>,
        enableSorting: false,
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <p className="text-sm font-semibold text-slate-950">
              {formatMoneyMinor(journal.totalDebitMinor, journal.currency)}
            </p>
          );
        },
      },
      {
        id: "credit",
        header: () => <ColumnHeader help="双分录贷方合计，必须等于借方合计。">贷方</ColumnHeader>,
        enableSorting: false,
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <p className="text-sm font-semibold text-slate-950">
              {formatMoneyMinor(journal.totalCreditMinor, journal.currency)}
            </p>
          );
        },
      },
      {
        id: "source",
        header: "来源",
        enableSorting: false,
        cell: ({ row }) => {
          const journal = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">{journal.sourceType}</p>
              <p className="max-w-[180px] truncate text-[11px] text-slate-500">
                {journal.sourceId ?? journal.orderId ?? "-"}
              </p>
            </>
          );
        },
      },
      {
        id: "entries",
        header: () => (
          <ColumnHeader help="具体账户分录和账户余额。余额按账户正常方向计算，不是用户积分余额。">
            分录
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const journal = row.original;
          return (
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
          );
        },
      },
      {
        accessorKey: "postedAt",
        header: "时间",
        cell: ({ row }) => formatDate(row.original.postedAt),
      },
    ],
    []
  );

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
                <TextInput
                  value={currency}
                  onChange={(event) => onCurrencyChange(event.target.value.toUpperCase())}
                  className="uppercase"
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
          <DataTable
            columns={journalColumns}
            data={journals}
            loading={loading}
            minWidth={1180}
            pageSize={20}
            emptyLabel="暂无资金账本分录"
            className="rounded-none border-0"
          />
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
  const columns = useMemo<ColumnDef<BillingSettlementRow, unknown>[]>(
    () => [
      {
        accessorKey: "providerSettlementId",
        header: () => (
          <ColumnHeader help="支付供应商侧 settlement/payout 批次 ID，用于和渠道后台对账。">
            结算批次
          </ColumnHeader>
        ),
        cell: ({ row }) => {
          const settlement = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">
                {settlement.providerSettlementId}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {providerLabel(settlement.provider)}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: () => <ColumnHeader help="结算批次与内部账本的对账状态。">状态</ColumnHeader>,
        cell: ({ row }) => {
          const settlement = row.original;
          return (
            <StatusPill tone={settlement.status === "failed" ? "risk" : "muted"}>
              {settlementStatusLabel(settlement.status)}
            </StatusPill>
          );
        },
      },
      {
        id: "gross",
        header: () => <ColumnHeader help="渠道结算总金额，未扣手续费。">总额</ColumnHeader>,
        enableSorting: false,
        cell: ({ row }) => formatMoneyMinor(row.original.grossAmountMinor, row.original.currency),
      },
      {
        id: "fee",
        header: () => (
          <ColumnHeader help="渠道从结算中扣除的手续费。后续会生成 provider_fee journal。">
            手续费
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => formatMoneyMinor(row.original.feeAmountMinor, row.original.currency),
      },
      {
        id: "net",
        header: () => <ColumnHeader help="渠道实际打款金额，等于总额减手续费。">净额</ColumnHeader>,
        enableSorting: false,
        cell: ({ row }) => {
          const settlement = row.original;
          return (
            <p className="font-semibold text-slate-950">
              {formatMoneyMinor(settlement.netAmountMinor, settlement.currency)}
            </p>
          );
        },
      },
      {
        id: "links",
        header: "关联",
        enableSorting: false,
        cell: ({ row }) => {
          const settlement = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">Journal {settlement.journalCount}</p>
              <p className="text-[11px] text-slate-500">
                对账项 {settlement.reconciliationItemCount}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "settledAt",
        header: "时间",
        cell: ({ row }) => (row.original.settledAt ? formatDate(row.original.settledAt) : "-"),
      },
    ],
    []
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">渠道结算</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          用于核对支付渠道打款、手续费和内部 journal 是否一致。
        </p>
      </div>
      <DataTable
        columns={columns}
        data={settlements}
        minWidth={900}
        pageSize={20}
        emptyLabel="暂无渠道结算记录"
        className="rounded-none border-0"
      />
    </section>
  );
}

function ReconciliationRunsTable({ runs }: { runs: BillingReconciliationRunRow[] }) {
  const columns = useMemo<ColumnDef<BillingReconciliationRunRow, unknown>[]>(
    () => [
      {
        id: "run",
        header: "运行",
        enableSorting: false,
        cell: ({ row }) => {
          const run = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-medium text-slate-950">
                {run.id.slice(0, 8)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {providerLabel(run.provider)} {run.currency ?? ""}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: () => (
          <ColumnHeader help="本次对账任务是否仍在运行、完成或失败。">状态</ColumnHeader>
        ),
        cell: ({ row }) => {
          const run = row.original;
          const issueCount =
            run.mismatchCount + run.missingInternalCount + run.missingProviderCount;
          return (
            <>
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
                <p className="mt-1 max-w-[180px] truncate text-[11px] text-red-600">{run.error}</p>
              ) : null}
            </>
          );
        },
      },
      {
        id: "period",
        header: "周期",
        enableSorting: false,
        cell: ({ row }) => {
          const run = row.original;
          return (
            <>
              <p className="text-[12px] text-slate-700">{formatDate(run.periodStart)}</p>
              <p className="text-[11px] text-slate-500">{formatDate(run.periodEnd)}</p>
            </>
          );
        },
      },
      {
        accessorKey: "matchedCount",
        header: "匹配",
        cell: ({ row }) => formatInteger(String(row.original.matchedCount)),
      },
      {
        id: "diff",
        header: () => (
          <ColumnHeader help="金额不一致、内部缺失、渠道缺失三类异常合计。">差异</ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const run = row.original;
          const issueCount =
            run.mismatchCount + run.missingInternalCount + run.missingProviderCount;
          return (
            <>
              <p
                className={cn(
                  "text-sm font-semibold",
                  issueCount ? "text-red-700" : "text-slate-950"
                )}
              >
                {formatInteger(String(issueCount))}
              </p>
              <p className="text-[11px] text-slate-500">总项 {run.itemCount}</p>
            </>
          );
        },
      },
      {
        id: "samples",
        header: () => (
          <ColumnHeader help="最多展示近期未匹配样本，便于定位漏单、重复回调或渠道金额不一致。">
            异常样本
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const run = row.original;
          return (
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
                      item.differenceMinor ?? item.providerAmountMinor ?? item.internalAmountMinor,
                      item.currency
                    )}
                  </span>
                </div>
              ))}
              {!run.openItems.length ? (
                <span className="text-[12px] text-slate-500">无未处理异常</span>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "updatedAt",
        header: "更新时间",
        cell: ({ row }) => formatDate(row.original.updatedAt),
      },
    ],
    []
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">支付对账</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          对账运行、差异数量和未匹配项集中展示，后续处理退款、拒付和渠道漏单。
        </p>
      </div>
      <DataTable
        columns={columns}
        data={runs}
        minWidth={1050}
        pageSize={20}
        emptyLabel="暂无对账运行"
        className="rounded-none border-0"
      />
    </section>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
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

function BillingNavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
      <span className="px-2 text-[11px] font-semibold text-slate-400">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

// Sentinel mapped to "" — shadcn/radix SelectItem cannot use an empty string
// value, so the 全部/不发放/稍后配置 "all/none" options round-trip through this.
const SELECT_ALL_SENTINEL = "__all__";

type SelectOption = {
  value: string;
  label: React.ReactNode;
  title?: string;
};

// Parse the existing <option> children into shadcn SelectItem props so call
// sites keep their verbatim labels + per-option title tooltips while rendering
// through the composable Select primitives.
function optionsFromChildren(children: React.ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== "option") return;
    const props = child.props as {
      value?: string;
      title?: string;
      children?: React.ReactNode;
    };
    options.push({
      value: props.value ?? "",
      label: props.children,
      title: props.title,
    });
  });
  return options;
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
  const options = optionsFromChildren(children);
  const toSentinel = (raw: string) => (raw === "" ? SELECT_ALL_SENTINEL : raw);
  const fromSentinel = (raw: string) => (raw === SELECT_ALL_SENTINEL ? "" : raw);

  // Track the current value internally so the FormData-backed hidden input
  // submits the real (de-sentineled) string. radix's own `name` is not used so
  // an empty "all/none" option submits "" rather than the sentinel.
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = value !== undefined ? value : internalValue;

  const rootProps =
    value !== undefined
      ? {
          value: toSentinel(value),
          onValueChange: onChange ? (next: string) => onChange(fromSentinel(next)) : undefined,
        }
      : {
          defaultValue: defaultValue !== undefined ? toSentinel(defaultValue) : undefined,
          onValueChange: (next: string) => setInternalValue(fromSentinel(next)),
        };

  return (
    <ShadSelect {...rootProps}>
      {name ? <input type="hidden" name={name} value={currentValue} /> : null}
      <SelectTrigger
        title={title}
        className="h-9 w-full rounded-lg border-slate-200 bg-white px-2.5 text-sm text-slate-700 focus-visible:border-slate-950 focus-visible:ring-2 focus-visible:ring-slate-950/10"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value || SELECT_ALL_SENTINEL}
            value={toSentinel(option.value)}
            title={option.title}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}

function TextInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <Input
      {...props}
      className={cn(
        "h-9 rounded-lg border-slate-200 bg-white px-2.5 text-sm placeholder:text-slate-400 focus-visible:border-slate-950 focus-visible:ring-2 focus-visible:ring-slate-950/10",
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

// Column header with an inline help tooltip, mirroring the old <Th help> markup
// so DataTable header cells keep their InfoTip affordance.
function ColumnHeader({ children, help }: { children: React.ReactNode; help?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      {help ? <InfoTip text={help} /> : null}
    </span>
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

function buildBillingItemCode({
  productType,
  walletAmount,
  planKey,
  currency,
  amountMinor,
}: {
  productType: string;
  walletAmount: string;
  planKey: string;
  currency: string;
  amountMinor: string;
}) {
  const prefixes: Record<string, string> = {
    community_point_pack: "COMMUNITY_POINT",
    bubble_pack: "BUBBLE",
    membership_plan: "MEMBERSHIP",
    team_membership_plan: "TEAM_MEMBERSHIP",
  };
  const prefix = prefixes[productType] ?? "BILLING";
  const benefit = sanitizeCodeToken(walletAmount || planKey || "PACKAGE");
  const fiatCurrency = sanitizeCodeToken(currency || "CUR");
  const fiatAmount = sanitizeCodeToken(amountMinor || "AMOUNT");
  return [prefix, benefit, fiatCurrency, fiatAmount]
    .join("_")
    .replace(/_+/g, "_")
    .slice(0, 96)
    .replace(/_+$/g, "");
}

function sanitizeCodeToken(value: string) {
  const token = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || "AUTO";
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

function walletEntryTypeLabel(value: string) {
  const labels: Record<string, string> = {
    credit: "入账",
    debit: "扣款",
    hold: "冻结",
    release: "释放",
    settle: "结算",
    refund: "退款",
    adjustment: "调整",
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

function formatSignedInteger(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return "0";
  const formatted = new Intl.NumberFormat("zh-CN").format(Math.abs(numeric));
  return numeric > 0 ? `+${formatted}` : `-${formatted}`;
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
