// Billing domain types shared across the /billing sub-app pages and panels.
// Moved AS-IS from components/admin/admin-billing-panel.tsx during the P2
// per-page split. The monolith keeps its own copies until Stage 2 deletes it.

export type PaymentProvider = "airwallex" | "wechat_pay" | "alipay" | "manual" | "internal";
export type BindingStatus = "active" | "inactive" | "sync_pending" | "sync_failed";
export type BillingPromotionStatus = "draft" | "active" | "paused" | "archived";
export type BillingMembershipPlanStatus = "draft" | "active" | "paused" | "archived";
export type BillingPromotionDurationType = "once" | "forever" | "repeating";
export type BillingOrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "fulfilled"
  | "canceled"
  | "expired"
  | "failed"
  | "refunded"
  | "partially_refunded";
export type BillingRefundStatus =
  | "requested"
  | "provider_pending"
  | "succeeded"
  | "failed"
  | "canceled";
export type BillingLedgerJournalType =
  | "payment_capture"
  | "fulfillment_allocation"
  | "settlement"
  | "refund"
  | "chargeback"
  | "revenue_recognition"
  | "provider_fee"
  | "manual_adjustment"
  | "reversal";
export type BillingSettlementStatus = "pending" | "reconciled" | "partially_reconciled" | "failed";
export type BillingReconciliationStatus = "running" | "completed" | "failed";
export type BillingReconciliationItemStatus =
  | "matched"
  | "mismatch"
  | "missing_internal"
  | "missing_provider"
  | "ignored";
export type PaymentProviderEventStatus = "received" | "processed" | "ignored" | "failed";
export type WalletCreditGrantType =
  | "purchase_topup"
  | "membership_included"
  | "check_in_reward"
  | "campaign_reward"
  | "admin_adjustment"
  | "refund_return"
  | "migration"
  | "system_grant"
  | "other";
export type WalletCreditGrantStatus = "active" | "exhausted" | "expired" | "reversed" | "voided";

export type BillingProviderBinding = {
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

export type BillingProviderBindingPrice = {
  id: string;
  code: string;
  name: string;
  productType: string;
  currency: string;
  amountMinor: string;
};

export type BillingPriceRow = {
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
  metadata: Record<string, unknown>;
  updatedAt: string;
};

export type BillingMembershipPlanRow = {
  id: string;
  planKey: string;
  productType: "membership_plan" | "team_membership_plan";
  subjectType: "user" | "workspace";
  status: BillingMembershipPlanStatus;
  rank: number;
  name: string;
  description: string | null;
  includedComputeCredits: string;
  includedSeats: number;
  maxSeats: number | null;
  seatOverageAllowed: boolean;
  billingIntervalDefault: string | null;
  /** Validated benefits JSONB — the entitlement/quota source of truth. */
  benefits: MembershipPlanBenefits;
  marketing: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdById: string | null;
  updatedById: string | null;
  archivedAt: string | null;
  prices: BillingPriceRow[];
  createdAt: string;
  updatedAt: string;
};

/** Mirrors the server MembershipBenefitsSchema (stored/wire shape). */
export type MembershipPlanBenefits = {
  queuePriority: number;
  imageDaily: number | "Infinity";
  videoDaily: number | "Infinity";
  chatDaily: number | "Infinity";
  workflowDaily: number | "Infinity";
  uploadMB: number;
  chatPerMinute: number;
  concurrentJobs: number | null;
  queuedJobs: number | null;
};

export type MembershipPlanBenefitsData = {
  id: string;
  planKey: string;
  name: string;
  status: BillingMembershipPlanStatus;
  benefits: MembershipPlanBenefits | Record<string, unknown>;
  issues: string[] | null;
};

export type BillingPromotionProviderBinding = {
  id: string;
  provider: PaymentProvider;
  status: BindingStatus;
  providerCouponId: string | null;
  syncError?: string | null;
  lastSyncedAt?: string | null;
  archivedAt?: string | null;
};

export type BillingPromotionRow = {
  id: string;
  applyMode: "code" | "automatic";
  code: string | null;
  name: string;
  description: string | null;
  status: BillingPromotionStatus;
  percentOffBps: number | null;
  amountOffMinor: number | null;
  amountOffCurrency: string | null;
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

export type BillingOrderRow = {
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

export type BillingRefundRow = {
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

export type BillingRefundQuoteIssue = {
  code: string;
  msg: string;
};

export type BillingRefundQuoteData = {
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

export type WalletAccountRow = {
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

export type WalletLedgerEntryRow = {
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
  creditAllocations: WalletCreditAllocationRow[];
  createdAt: string;
};

export type WalletCreditAllocationRow = {
  id: string;
  grantId: string;
  grantType: WalletCreditGrantType;
  grantStatus: WalletCreditGrantStatus;
  amount: string;
  availableDelta: string;
  heldDelta: string;
  consumedDelta: string;
  expiredDelta: string;
  reversedDelta: string;
  validFrom: string;
  expiresAt: string | null;
  sourceType: string;
  sourceId: string | null;
};

export type WalletCreditGrantRow = {
  id: string;
  accountId: string;
  transactionId: string | null;
  grantType: WalletCreditGrantType;
  status: WalletCreditGrantStatus;
  totalAmount: string;
  availableAmount: string;
  heldAmount: string;
  consumedAmount: string;
  expiredAmount: string;
  reversedAmount: string;
  priority: number;
  validFrom: string;
  expiresAt: string | null;
  sourceType: string;
  sourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AdminWalletAccountDetailData = {
  account: WalletAccountRow;
  entries: WalletLedgerEntryRow[];
  grants: WalletCreditGrantRow[];
};

export type BillingLedgerAccountRow = {
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

export type BillingLedgerJournalRow = {
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

export type BillingSettlementRow = {
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

export type BillingReconciliationItemRow = {
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

export type BillingReconciliationRunRow = {
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

export type BillingProviderEventRow = {
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

export type AdminBillingMembershipPlansData = {
  items: BillingMembershipPlanRow[];
};

export type AdminBillingPromotionsData = {
  items: BillingPromotionRow[];
};

// Workspace identity and its compute wallet balance.

export type AdminWorkspaceMemberRole = "owner" | "admin" | "editor" | "billing" | "viewer";

export type AdminWorkspaceRow = {
  site?: "cn" | "global";
  kind?: "personal" | "shared";
  id: string;
  name: string;
  status: string;
  ownerUserId: string;
  memberCount: number;
  createdAt: string;
  hasWallet: boolean;
  availableBalance: string;
  heldBalance: string;
  /** Only when the list was queried for one user (`?relatedUserId=`): what that
   *  user is in this workspace. `"owner"` also covers owning without a member row. */
  relatedUserRole?: AdminWorkspaceMemberRole | null;
};

export type AdminBillingWorkspacesData = {
  items: AdminWorkspaceRow[];
};

export type AdminComputeMemberUsageWorkspace = {
  workspaceId: string;
  workspaceName: string;
  workspaceStatus: string | null;
  isPersonal: boolean;
  credits: string;
  jobs: number;
  imageJobs: number;
  videoJobs: number;
};

export type AdminComputeMemberUsageMember = {
  userId: string;
  nickName: string | null;
  phone: string | null;
  email: string | null;
  totalCredits: string;
  totalJobs: number;
  totalImageJobs: number;
  totalVideoJobs: number;
  workspaces: AdminComputeMemberUsageWorkspace[];
};

export type AdminComputeMemberUsageData = {
  rangeDays: number;
  workspaceKind: "personal" | "shared" | "all";
  workspaceId: string | null;
  totalCredits: string;
  memberCount: number;
  workspaceCount: number;
  members: AdminComputeMemberUsageMember[];
};

export type AdminComputeProjectUsageSort = "credits" | "recent";

export type AdminComputeProjectUsageProject = {
  projectId: string | null;
  projectName: string | null;
  lastSpentAt: string | null;
  credits: string;
  jobs: number;
  imageJobs: number;
  videoJobs: number;
};

export type AdminComputeProjectUsageWorkspace = {
  workspaceId: string;
  workspaceName: string;
  workspaceStatus: string | null;
  isPersonal: boolean;
  lastSpentAt: string | null;
  totalCredits: string;
  totalJobs: number;
  totalImageJobs: number;
  totalVideoJobs: number;
  projectCount: number;
  nextProjectOffset?: number | null;
  projects: AdminComputeProjectUsageProject[];
};

export type AdminComputeProjectUsageData = {
  rangeDays: number;
  workspaceKind: "personal" | "shared" | "all";
  sort: AdminComputeProjectUsageSort;
  workspaceId: string | null;
  totalCredits: string;
  workspaceCount: number;
  projectCount: number;
  nextWorkspaceOffset?: number | null;
  workspaces: AdminComputeProjectUsageWorkspace[];
};

export type VoucherStatus = "active" | "redeemed" | "void" | "expired";
export type VoucherGrantType = "compute_credits";

export type VoucherRow = {
  id: string;
  code: string;
  batchId: string | null;
  grantType: VoucherGrantType;
  computeCreditAmount: number | null;
  status: VoucherStatus;
  expiresAt: string | null;
  redeemedByUserId: string | null;
  redeemedWorkspaceId: string | null;
  redeemedAt: string | null;
  note: string | null;
  createdAt: string;
};

export type AdminBillingVouchersData = {
  items: VoucherRow[];
};

export type GenerateVouchersResult = {
  batchId: string;
  count: number;
  vouchers: VoucherRow[];
};

export type CreditCampaignStatus = "draft" | "active" | "paused" | "ended";

export type CreditCampaignRow = {
  id: string;
  name: string;
  description: string | null;
  computeCreditAmount: number;
  status: CreditCampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  maxClaims: number | null;
  claimCount: number;
  note: string | null;
  createdAt: string;
};

export type AdminBillingCampaignsData = {
  items: CreditCampaignRow[];
};

export type CheckInConfigData = {
  enabled: boolean;
  rewards: number[];
  configured: boolean;
  updatedAt: string | null;
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

// Empty-state fallbacks so a failed initial server fetch still renders the
// page chrome. Moved AS-IS from admin-billing-panel.tsx.
export const emptyPrices: AdminBillingPricesData = { items: [] };

export const emptyMembershipPlans: AdminBillingMembershipPlansData = { items: [] };

export const emptyLedgerOverview: AdminBillingLedgerOverviewData = {
  generatedAt: new Date(0).toISOString(),
  metrics: {
    activeAccounts: 0,
    journalCount: 0,
    settlementCount: 0,
    openReconciliationCount: 0,
  },
  accounts: [],
};

export const emptyLedgerJournals: AdminBillingLedgerJournalsData = {
  items: [],
  nextCursor: null,
};
