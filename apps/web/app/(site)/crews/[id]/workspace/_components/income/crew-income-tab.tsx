"use client";

import { EarningTrend, postedProfitShare } from "@/app/(site)/crews/_components/earning-trend";
import { CrewComputeFinance } from "@/app/(site)/crews/_components/crew-compute-finance";
import { useCrewExpensesSummary } from "@/app/(site)/crews/_hooks/use-expenses";
import { AmendmentFinancePanel } from "@/app/(site)/crews/_components/amendment-finance-panel";

import { isCrewCursorError } from "@/app/(site)/crews/_hooks/api";

import { useLayoutEffect, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import {
  CREW_CURRENCY,
  formatCrewMoney,
  parseCrewMoney,
  formatCrewMoneyInput,
  type CrewLedgerCurrency,
} from "@/src/lib/crew-money";
import Link from "next/link";
import {
  IconArrowBackUp,
  IconCash,
  IconCheck,
  IconCircleCheck,
  IconClockHour4,
  IconCoins,
  IconDots,
  IconFileInvoice,
  IconGift,
  IconHistory,
  IconLoader2,
  IconPlus,
  IconReceipt2,
  IconRefresh,
  IconRosetteDiscountCheck,
  IconTrendingUp,
  IconUser,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  useApproveCrewEarning,
  useCreateCrewEarning,
  useCreateCrewPayout,
  useCrewEarningDetail,
  useCrewEarnings,
  useCrewPayoutDetail,
  useCrewPayouts,
  usePayCrewPayout,
  useRejectCrewEarning,
  useReverseCrewEarning,
  useVoidCrewPayout,
  type CrewEarningEntryDTO,
  type CrewEarningSourceType,
  type CrewEarningStatus,
  type CrewMemberDTO,
  type CrewPayoutDTO,
  type CrewPayoutMethod,
  type CrewPayoutStatus,
} from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";

type View = "earnings" | "payouts";
type Scope = "mine" | "crew";
type EarningFilter = "all" | CrewEarningStatus;
type PayoutFilter = "all" | CrewPayoutStatus;
type ManualSource = Exclude<CrewEarningSourceType, "task_reward">;
type PayoutAction = "pay" | "void";

const MANUAL_SOURCES: ManualSource[] = [
  "milestone_bonus",
  "revenue_share",
  "discretionary_bonus",
  "adjustment",
];
const PAYOUT_METHODS: CrewPayoutMethod[] = [
  "bank_transfer",
  "alipay",
  "wechat_pay",
  "paypal",
  "other",
];

export function CrewIncomeTab(props: Parameters<typeof IncomeSession>[0]) {
  const { user } = useCurrentUser();
  return <IncomeSession key={JSON.stringify([user?.id, props.crewId])} {...props} />;
}
function useIncomeSession() {
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}
function useIncomeAction() {
  const active = useIncomeSession();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  return {
    active,
    busy,
    begin: () => {
      if (!active.current || pending.current) return false;
      pending.current = true;
      setBusy(true);
      return true;
    },
    finish: () => {
      pending.current = false;
      if (active.current) setBusy(false);
    },
    key: (input: unknown) => {
      const fingerprint = JSON.stringify(input);
      if (retry.current?.fingerprint !== fingerprint)
        retry.current = { fingerprint, key: crypto.randomUUID() };
      return retry.current.key;
    },
    confirmed: () => {
      retry.current = null;
    },
  };
}

function IncomeSession({
  crewId,
  crewName,
  members,
  canViewCrewLedger,
  canCreateEarning,
  canApproveEarning,
  canReverseEarning,
  canCreatePayout,
  canManagePayout,
}: {
  crewId: string;
  crewName: string;
  members: CrewMemberDTO[];
  canViewCrewLedger: boolean;
  canCreateEarning: boolean;
  canApproveEarning: boolean;
  canReverseEarning: boolean;
  canCreatePayout: boolean;
  canManagePayout: boolean;
}) {
  const expenses = useTranslations("crewExpenses");
  const t = useTranslations("crewIncome");
  const locale = useLocale();
  const [view, setView] = useState<View>("earnings");
  const [scope, setScope] = useState<Scope>("mine");
  const effectiveScope = canViewCrewLedger ? scope : "mine";
  const [earningFilter, setEarningFilter] = useState<EarningFilter>("all");
  const [payoutFilter, setPayoutFilter] = useState<PayoutFilter>("all");
  const [createEarningOpen, setCreateEarningOpen] = useState(false);
  const [createPayoutOpen, setCreatePayoutOpen] = useState(false);
  const [earningDetail, setEarningDetail] = useState<CrewEarningEntryDTO | null>(null);
  const [payoutDetail, setPayoutDetail] = useState<CrewPayoutDTO | null>(null);
  const [earningDecision, setEarningDecision] = useState<{
    kind: "reject" | "reverse";
    earning: CrewEarningEntryDTO;
  } | null>(null);
  const [payoutAction, setPayoutAction] = useState<{
    kind: PayoutAction;
    payout: CrewPayoutDTO;
  } | null>(null);

  const earnings = useCrewEarnings(
    crewId,
    {
      currency: CREW_CURRENCY,
      scope: effectiveScope,
      status: earningFilter === "all" ? undefined : earningFilter,
    },
    view === "earnings"
  );
  const payouts = useCrewPayouts(
    crewId,
    {
      currency: CREW_CURRENCY,
      scope: effectiveScope,
      status: payoutFilter === "all" ? undefined : payoutFilter,
    },
    view === "payouts"
  );
  const displays = useUserDisplays([
    ...members.map((member) => member.userId),
    ...earnings.data.map((earning) => earning.userId),
    ...payouts.data.map((payout) => payout.userId),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1180px] pb-10">
      <header className="border-b border-white/[0.07] px-1 pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] text-[#858b95]">
              <IconCoins className="size-4" stroke={1.7} />
              <span>{t("workspaceLabel", { crew: crewName })}</span>
            </div>
            <h2 className="mt-2 text-[20px] font-semibold tracking-[-0.03em] text-[#f1f2f4]">
              {t("title")}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-[#737983]">{t("description")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canViewCrewLedger ? (
              <Segmented>
                <Segment active={effectiveScope === "mine"} onClick={() => setScope("mine")}>
                  <IconUser /> {t("scopes.mine")}
                </Segment>
                <Segment active={effectiveScope === "crew"} onClick={() => setScope("crew")}>
                  <IconUsers /> {t("scopes.crew")}
                </Segment>
              </Segmented>
            ) : null}
            {view === "earnings" && canCreateEarning ? (
              <Button size="sm" icon={<IconPlus />} onClick={() => setCreateEarningOpen(true)}>
                {t("create.action")}
              </Button>
            ) : null}
            {view === "payouts" && canCreatePayout ? (
              <Button size="sm" icon={<IconPlus />} onClick={() => setCreatePayoutOpen(true)}>
                {t("payout.create.action")}
              </Button>
            ) : null}
          </div>
        </div>
        <nav className="mt-5 flex gap-5" aria-label={t("viewLabel")}>
          <ViewTab active={view === "earnings"} onClick={() => setView("earnings")}>
            <IconCoins /> {t("views.earnings")}
          </ViewTab>
          <ViewTab active={view === "payouts"} onClick={() => setView("payouts")}>
            <IconCash /> {t("views.payouts")}
          </ViewTab>
        </nav>
      </header>

      {view === "earnings" ? (
        <EarningsLedger
          crewId={crewId}
          query={earnings}
          scope={effectiveScope}
          filter={earningFilter}
          setFilter={setEarningFilter}
          locale={locale}
          displays={displays}
          canApprove={canApproveEarning}
          canReverse={canReverseEarning}
          onDetails={setEarningDetail}
          onDecision={(kind, earning) => setEarningDecision({ kind, earning })}
        />
      ) : (
        <PayoutLedger
          query={payouts}
          scope={effectiveScope}
          filter={payoutFilter}
          setFilter={setPayoutFilter}
          locale={locale}
          displays={displays}
          canManage={canManagePayout}
          onDetails={setPayoutDetail}
          onAction={(kind, payout) => setPayoutAction({ kind, payout })}
        />
      )}

      <section className="mt-8 space-y-4 border-t border-white/10 pt-6">
        <CrewComputeFinance crewId={crewId} crewName={crewName} />
        <Link
          className="mb-3 inline-block text-sm"
          href={`/${locale}/crews/${encodeURIComponent(crewId)}/expenses`}
        >
          {expenses("title")}
        </Link>
        <ProjectSpendSummary crewId={crewId} canView={canViewCrewLedger} locale={locale} />

        {canApproveEarning && <AmendmentFinancePanel crewId={crewId} />}
      </section>

      {createEarningOpen && canCreateEarning ? (
        <CreateEarningDialog
          open={createEarningOpen}
          onOpenChange={setCreateEarningOpen}
          crewId={crewId}
          members={members}
          displays={displays}
        />
      ) : null}
      {createPayoutOpen && canCreatePayout ? (
        <CreatePayoutDialog
          open={createPayoutOpen}
          onOpenChange={setCreatePayoutOpen}
          crewId={crewId}
          members={members}
          displays={displays}
          locale={locale}
        />
      ) : null}
      {earningDecision &&
      (earningDecision.kind === "reverse" ? canReverseEarning : canApproveEarning) ? (
        <EarningDecisionDialog
          key={JSON.stringify([earningDecision.kind, earningDecision.earning.id])}
          value={earningDecision}
          onOpenChange={(open) => !open && setEarningDecision(null)}
          crewId={crewId}
        />
      ) : null}
      {payoutAction && canManagePayout ? (
        <PayoutActionDialog
          key={JSON.stringify([payoutAction.kind, payoutAction.payout.id])}
          value={payoutAction}
          onOpenChange={(open) => !open && setPayoutAction(null)}
          crewId={crewId}
          locale={locale}
        />
      ) : null}
      <EarningDetailDialog
        earning={earningDetail}
        onOpenChange={(open) => !open && setEarningDetail(null)}
        locale={locale}
      />
      <PayoutDetailDialog
        payout={payoutDetail}
        onOpenChange={(open) => !open && setPayoutDetail(null)}
        locale={locale}
      />
    </div>
  );
}

function EarningsLedger({
  crewId,
  query,
  scope,
  filter,
  setFilter,
  locale,
  displays,
  canApprove,
  canReverse,
  onDetails,
  onDecision,
}: {
  crewId: string;
  query: ReturnType<typeof useCrewEarnings>;
  scope: Scope;
  filter: EarningFilter;
  setFilter: (value: EarningFilter) => void;
  locale: string;
  displays: ReturnType<typeof useUserDisplays>;
  canApprove: boolean;
  canReverse: boolean;
  onDetails: (earning: CrewEarningEntryDTO) => void;
  onDecision: (kind: "reject" | "reverse", earning: CrewEarningEntryDTO) => void;
}) {
  const t = useTranslations("crewIncome");
  const dashboardT = useTranslations("crewFinanceDashboard");
  const action = useIncomeAction();
  const { active } = action;
  const approve = useApproveCrewEarning(crewId);
  const summary = query.summary;
  const approveEntry = async (earning: CrewEarningEntryDTO) => {
    if (!canApprove || earning.status !== "pending") return;
    if (!action.begin()) return;
    try {
      await approve.mutateAsync({ earningId: earning.id, expectedVersion: earning.version });
      if (!active.current) return;
      toast.success(t("messages.approved"));
    } catch (error) {
      if (!active.current) return;
      toast.error(error instanceof Error ? error.message : t("messages.actionFailed"));
    } finally {
      action.finish();
    }
  };
  return (
    <section className="pt-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          label={t("metrics.confirmedAmount")}
          value={
            <SummaryMoney
              value={summary?.byStatus?.posted?.amountMinor}
              failed={query.isError}
              locale={locale}
            />
          }
        />
        <Metric
          label={t("metrics.pendingAmount")}
          value={
            <SummaryMoney
              value={summary?.byStatus?.pending?.amountMinor}
              failed={query.isError}
              locale={locale}
            />
          }
        />
        <Metric
          label={dashboardT("profitShare")}
          value={
            <SummaryMoney
              value={postedProfitShare(summary?.postedBySource)}
              failed={query.isError}
              locale={locale}
            />
          }
        />
      </div>
      <EarningTrend
        value={summary?.postedDaily}
        failed={query.isError}
        loading={query.isPending}
        locale={locale}
        currency={CREW_CURRENCY}
      />
      <p className="mb-4 text-xs text-muted-foreground">
        {t("metrics.monthAmount")}:{" "}
        <SummaryMoney
          value={summary?.postedThisMonthAmountMinor}
          failed={query.isError}
          locale={locale}
        />
      </p>
      <LedgerHeader
        title={t("earnings.history")}
        description={t("earnings.historyDescription")}
        values={["all", "pending", "posted", "rejected", "reversed"]}
        value={filter}
        onChange={(value) => setFilter(value as EarningFilter)}
      />
      <ResultState
        query={query}
        emptyTitle={t("earnings.emptyTitle")}
        emptyDescription={t("earnings.emptyDescription")}
      >
        <div
          role="table"
          aria-label={t("earnings.history")}
          className="divide-y divide-white/[0.055] border-t border-white/[0.055]"
        >
          <div
            role="row"
            className="sr-only gap-3 px-2 py-3 text-xs text-muted-foreground md:not-sr-only md:grid md:grid-cols-[minmax(0,1fr)_110px_120px_130px]"
          >
            {["record", "status", "date", "amount"].map((key) => (
              <span role="columnheader" key={key}>
                {dashboardT(key)}
              </span>
            ))}
          </div>
          {query.data.map((earning) => (
            <div
              key={earning.id}
              role="row"
              className="grid gap-3 px-2 py-3.5 transition-colors hover:bg-white/[0.02] md:grid-cols-[minmax(0,1fr)_110px_120px_130px] md:items-center"
            >
              <div role="cell" className="flex min-w-0 items-center gap-3">
                {scope === "crew" ? (
                  <UserAvatar
                    src={displays.get(earning.userId)?.avatar}
                    name={displayNameOf(earning.userId, displays)}
                    seed={earning.userId}
                    size={28}
                  />
                ) : null}
                <div className="min-w-0">
                  {earning.task ? (
                    <Link
                      href={`?tab=tasks&task=${encodeURIComponent(earning.task.id)}`}
                      className="truncate text-[11px] font-medium text-[#dfe1e5] hover:underline"
                    >
                      {earning.title}
                    </Link>
                  ) : (
                    <p className="truncate text-[11px] font-medium text-[#dfe1e5]">
                      {earning.title}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-1.5 text-[9px] text-[#676d77]">
                    <SourceIcon source={earning.sourceType} />
                    {scope === "crew" ? `${displayNameOf(earning.userId, displays)} · ` : ""}
                    {t(`sources.${earning.sourceType}`)}
                  </p>
                </div>
              </div>
              <div role="cell">
                <StatusBadge status={earning.status} />
              </div>
              <div role="cell">
                <time className="text-[10px] text-[#727883]" dateTime={earning.createdAt}>
                  {formatDate(earning.createdAt, locale)}
                </time>
              </div>
              <div role="cell" className="flex items-center justify-between gap-2 md:justify-end">
                <MoneyAmount
                  currency={earning.currency}
                  value={earning.amountMinor}
                  locale={locale}
                  className="font-mono text-[11px] font-semibold text-[#e8e9ec]"
                />
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded-md text-[#777d87] transition-colors hover:bg-white/[0.06] hover:text-white [&_svg]:size-3.5"
                  onClick={() => onDetails(earning)}
                  aria-label={t("actions.viewDetails")}
                >
                  <IconDots />
                </button>
                {earning.status === "pending" && canApprove ? (
                  <>
                    <button
                      type="button"
                      className="grid size-7 place-items-center rounded-md text-[#777d87] transition-colors hover:bg-white/[0.06] hover:text-white [&_svg]:size-3.5"
                      onClick={() => onDecision("reject", earning)}
                      aria-label={t("actions.reject")}
                    >
                      <IconX />
                    </button>
                    <button
                      type="button"
                      className="grid size-7 place-items-center rounded-md text-emerald-300 transition-colors hover:bg-emerald-400/[0.08] [&_svg]:size-3.5"
                      disabled={action.busy}
                      onClick={() => void approveEntry(earning)}
                      aria-label={t("actions.approve")}
                    >
                      <IconCheck />
                    </button>
                  </>
                ) : null}
                {earning.status === "posted" && canReverse ? (
                  <button
                    type="button"
                    className="grid size-7 place-items-center rounded-md text-[#777d87] transition-colors hover:bg-white/[0.06] hover:text-white [&_svg]:size-3.5"
                    onClick={() => onDecision("reverse", earning)}
                    aria-label={t("actions.reverse")}
                  >
                    <IconArrowBackUp />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </ResultState>
    </section>
  );
}

function PayoutLedger({
  query,
  scope,
  filter,
  setFilter,
  locale,
  displays,
  canManage,
  onDetails,
  onAction,
}: {
  query: ReturnType<typeof useCrewPayouts>;
  scope: Scope;
  filter: PayoutFilter;
  setFilter: (value: PayoutFilter) => void;
  locale: string;
  displays: ReturnType<typeof useUserDisplays>;
  canManage: boolean;
  onDetails: (payout: CrewPayoutDTO) => void;
  onAction: (kind: PayoutAction, payout: CrewPayoutDTO) => void;
}) {
  const t = useTranslations("crewIncome");
  return (
    <section className="pt-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          label={t("metrics.availableAmount")}
          value={
            <SummaryMoney
              value={query.summary?.availableAmountMinor}
              failed={query.isError}
              locale={locale}
            />
          }
        />
        <Metric
          label={t("metrics.reservedAmount")}
          value={
            <SummaryMoney
              value={query.summary?.reservedAmountMinor}
              failed={query.isError}
              locale={locale}
            />
          }
        />
        <Metric
          label={t("metrics.paidAmount")}
          value={
            <SummaryMoney
              value={query.summary?.paidAmountMinor}
              failed={query.isError}
              locale={locale}
            />
          }
        />
      </div>
      <LedgerHeader
        title={t("payout.history")}
        description={t("payout.historyDescription")}
        values={["all", "pending", "paid", "voided"]}
        value={filter}
        onChange={(value) => setFilter(value as PayoutFilter)}
      />
      <ResultState
        query={query}
        emptyTitle={t("payout.emptyTitle")}
        emptyDescription={t("payout.emptyDescription")}
      >
        <div className="divide-y divide-white/[0.055] border-t border-white/[0.055]">
          {query.data.map((payout) => (
            <div
              key={payout.id}
              className="grid gap-3 px-2 py-3.5 transition-colors hover:bg-white/[0.02] md:grid-cols-[minmax(0,1fr)_110px_120px_170px] md:items-center"
            >
              <div className="flex min-w-0 items-center gap-3">
                {scope === "crew" ? (
                  <UserAvatar
                    src={displays.get(payout.userId)?.avatar}
                    name={displayNameOf(payout.userId, displays)}
                    seed={payout.userId}
                    size={28}
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium text-[#dfe1e5]">
                    {scope === "crew" ? displayNameOf(payout.userId, displays) : t("payout.record")}
                  </p>
                  <p className="mt-1 text-[9px] text-[#676d77]">
                    <MoneyAmount
                      currency={payout.currency}
                      value={payout.amountMinor}
                      locale={locale}
                    />{" "}
                    · {formatDate(payout.createdAt, locale)}
                  </p>
                </div>
              </div>
              <PayoutStatusBadge status={payout.status} />
              <span className="font-mono text-[11px] font-semibold text-[#e8e9ec]">
                {formatCrewMoney(payout.netAmountMinor, locale, payout.currency)}
              </span>
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded-md text-[#777d87] transition-colors hover:bg-white/[0.06] hover:text-white [&_svg]:size-3.5"
                  onClick={() => onDetails(payout)}
                  aria-label={t("actions.viewDetails")}
                >
                  <IconDots />
                </button>
                {canManage && payout.status === "pending" ? (
                  <>
                    <Button size="sm" onClick={() => onAction("pay", payout)}>
                      {t("payout.actions.pay")}
                    </Button>
                  </>
                ) : null}
                {canManage && payout.status === "pending" ? (
                  <button
                    type="button"
                    className="grid size-7 place-items-center rounded-md text-[#777d87] transition-colors hover:bg-white/[0.06] hover:text-white [&_svg]:size-3.5"
                    onClick={() => onAction("void", payout)}
                    aria-label={t("payout.actions.void")}
                  >
                    <IconX />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </ResultState>
    </section>
  );
}

function CreateEarningDialog({
  open,
  onOpenChange,
  crewId,
  members,
  displays,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  members: CrewMemberDTO[];
  displays: ReturnType<typeof useUserDisplays>;
}) {
  const t = useTranslations("crewIncome");
  const action = useIncomeAction();
  const { active } = action;
  const create = useCreateCrewEarning(crewId);
  const [memberId, setMemberId] = useState("");
  const [sourceType, setSourceType] = useState<ManualSource>("milestone_bonus");
  const [title, setTitle] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [description, setDescription] = useState("");
  const amountMinor = parseCrewMoney(amountInput);
  const parsedAmount = amountMinor && BigInt(amountMinor) > 0n ? amountMinor : null;
  const close = (value: boolean) => {
    if (!value) {
      setMemberId("");
      setTitle("");
      setAmountInput("");
      setDescription("");
    }
    onOpenChange(value);
  };
  const submit = async () => {
    if (!memberId || !title.trim() || !parsedAmount) return;
    if (!action.begin()) return;
    try {
      const input = {
        crewMemberId: memberId,
        sourceType,
        title: title.trim(),
        description: description.trim() || undefined,
        amountMinor: parsedAmount,
      };
      await create.mutateAsync({ ...input, idempotencyKey: action.key(input) });
      action.confirmed();
      if (!active.current) return;
      toast.success(t("messages.created"));
      close(false);
    } catch (error) {
      if (!active.current) return;
      toast.error(error instanceof Error ? error.message : t("messages.createFailed"));
    } finally {
      action.finish();
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("create.title")}</DialogTitle>
          <DialogDescription>{t("create.description")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <fieldset disabled={action.busy} className="contents">
            <MemberSelect
              value={memberId}
              onChange={setMemberId}
              members={members}
              displays={displays}
              label={t("create.member")}
            />
            <Field label={t("create.source")}>
              <Select
                value={sourceType}
                onValueChange={(value) => setSourceType(value as ManualSource)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_SOURCES.map((source) => (
                    <SelectItem key={source} value={source}>
                      {t(`sources.${source}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("create.titleLabel")}>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t("create.titlePlaceholder")}
                maxLength={180}
              />
            </Field>
            <Field label={`${t("create.amount")} (${CREW_CURRENCY})`}>
              <Input
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                inputMode="decimal"
                placeholder="0"
                aria-invalid={Boolean(amountInput) && !parsedAmount}
              />
            </Field>
            <Field label={t("create.note")} optional>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("create.notePlaceholder")}
                maxLength={10_000}
              />
            </Field>
            <p className="text-[10px] leading-5 text-[#767c86]">{t("create.pendingNotice")}</p>
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("actions.cancel")}
          </Button>
          <Button
            loading={action.busy}
            disabled={!memberId || !title.trim() || !parsedAmount}
            onClick={() => void submit()}
          >
            {t("create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatePayoutDialog({
  open,
  onOpenChange,
  crewId,
  members,
  displays,
  locale,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  members: CrewMemberDTO[];
  displays: ReturnType<typeof useUserDisplays>;
  locale: string;
}) {
  const t = useTranslations("crewIncome");
  const action = useIncomeAction();
  const { active } = action;
  const create = useCreateCrewPayout(crewId);
  const [memberId, setMemberId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [withholding, setWithholding] = useState("0");
  const [note, setNote] = useState("");
  const amountMinor = parseCrewMoney(amountInput);
  const parsedAmount = amountMinor && BigInt(amountMinor) > 0n ? amountMinor : null;
  const grossMinor = parsedAmount;
  const withholdingMinor = parseCrewMoney(withholding);
  const netMinor =
    grossMinor != null && withholdingMinor != null
      ? BigInt(grossMinor) - BigInt(withholdingMinor)
      : null;
  const valid = Boolean(
    memberId && parsedAmount && withholdingMinor != null && netMinor && netMinor > 0n
  );
  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setMemberId("");
      setAmountInput("");
      setWithholding("0");
      setNote("");
    }
    onOpenChange(nextOpen);
  };
  const submit = async () => {
    if (!valid || !parsedAmount || withholdingMinor == null) return;
    if (!action.begin()) return;
    try {
      const input = {
        crewMemberId: memberId,
        amountMinor: parsedAmount,
        currency: CREW_CURRENCY,
        withholdingAmountMinor: withholdingMinor,
        note: note.trim() || undefined,
      };
      await create.mutateAsync({ ...input, idempotencyKey: action.key(input) });
      action.confirmed();
      if (!active.current) return;
      toast.success(t("payout.messages.created"));
      close(false);
    } catch (error) {
      if (!active.current) return;
      toast.error(error instanceof Error ? error.message : t("payout.messages.actionFailed"));
    } finally {
      action.finish();
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("payout.create.title")}</DialogTitle>
          <DialogDescription>{t("payout.create.description")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <fieldset disabled={action.busy} className="contents">
            <MemberSelect
              value={memberId}
              onChange={setMemberId}
              members={members}
              displays={displays}
              label={t("payout.create.member")}
            />
            <Field label={`${t("payout.create.amount")} (${CREW_CURRENCY})`}>
              <Input
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("payout.create.gross")}>
                <Input value={grossMinor ? formatCrewMoneyInput(grossMinor) : ""} readOnly />
              </Field>
              <Field label={t("payout.create.withholding")}>
                <Input
                  value={withholding}
                  onChange={(event) => setWithholding(event.target.value)}
                  inputMode="decimal"
                />
              </Field>
            </div>
            <div className="flex items-center justify-between border-y border-white/[0.07] py-3">
              <span className="text-[11px] text-[#878d97]">{t("payout.create.net")}</span>
              <strong className="font-mono text-[15px] text-[#f0f1f3]">
                {netMinor && netMinor > 0n
                  ? formatCrewMoney(netMinor.toString(), locale, CREW_CURRENCY)
                  : "—"}
              </strong>
            </div>
            <Field label={t("payout.create.note")} optional>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={10_000}
              />
            </Field>
            <p className="text-[10px] leading-5 text-[#767c86]">{t("payout.create.notice")}</p>
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("actions.cancel")}
          </Button>
          <Button loading={action.busy} disabled={!valid} onClick={() => void submit()}>
            {t("payout.create.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EarningDecisionDialog({
  value,
  onOpenChange,
  crewId,
}: {
  value: { kind: "reject" | "reverse"; earning: CrewEarningEntryDTO } | null;
  onOpenChange: (open: boolean) => void;
  crewId: string;
}) {
  const t = useTranslations("crewIncome");
  const action = useIncomeAction();
  const { active } = action;
  const reject = useRejectCrewEarning(crewId);
  const reverse = useReverseCrewEarning(crewId);
  const [reason, setReason] = useState("");
  const mutation = value?.kind === "reverse" ? reverse : reject;
  const close = (nextOpen: boolean) => {
    if (!nextOpen) setReason("");
    onOpenChange(nextOpen);
  };
  const submit = async () => {
    if (!value || !reason.trim()) return;
    if (!action.begin()) return;
    try {
      await mutation.mutateAsync({
        earningId: value.earning.id,
        expectedVersion: value.earning.version,
        reason: reason.trim(),
      });
      if (!active.current) return;
      toast.success(t(`messages.${value.kind === "reverse" ? "reversed" : "rejected"}`));
      close(false);
    } catch (error) {
      if (!active.current) return;
      toast.error(error instanceof Error ? error.message : t("messages.actionFailed"));
    } finally {
      action.finish();
    }
  };
  return (
    <Dialog open={Boolean(value)} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t(`decision.${value?.kind === "reverse" ? "reverseTitle" : "rejectTitle"}`)}
          </DialogTitle>
          <DialogDescription>
            {t(
              `decision.${value?.kind === "reverse" ? "reverseDescription" : "rejectDescription"}`
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <fieldset disabled={action.busy} className="contents">
            <Textarea
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={t("decision.reasonPlaceholder")}
            />
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("actions.cancel")}
          </Button>
          <Button loading={action.busy} disabled={!reason.trim()} onClick={() => void submit()}>
            {t(value?.kind === "reverse" ? "actions.confirmReverse" : "actions.confirmReject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayoutActionDialog({
  value,
  onOpenChange,
  crewId,
  locale,
}: {
  value: { kind: PayoutAction; payout: CrewPayoutDTO } | null;
  onOpenChange: (open: boolean) => void;
  crewId: string;
  locale: string;
}) {
  const t = useTranslations("crewIncome");
  const action = useIncomeAction();
  const { active } = action;
  const pay = usePayCrewPayout(crewId);
  const voidPayout = useVoidCrewPayout(crewId);
  const [method, setMethod] = useState<CrewPayoutMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [proof, setProof] = useState("");
  const [reason, setReason] = useState("");
  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setMethod("bank_transfer");
      setReference("");
      setProof("");
      setReason("");
    }
    onOpenChange(nextOpen);
  };
  const mutation = value?.kind === "pay" ? pay : voidPayout;
  const valid = value?.kind === "pay" ? Boolean(reference.trim()) : Boolean(reason.trim());
  const submit = async () => {
    if (!value || !valid) return;
    if (!action.begin()) return;
    try {
      await mutation.mutateAsync({
        payoutId: value.payout.id,
        expectedVersion: value.payout.version,
        paymentMethod: method,
        paymentReference: reference.trim() || undefined,
        paymentProofUrl: proof.trim() || undefined,
        reason: reason.trim() || undefined,
      });
      if (!active.current) return;
      toast.success(t(`payout.messages.${value.kind}`));
      close(false);
    } catch (error) {
      if (!active.current) return;
      toast.error(error instanceof Error ? error.message : t("payout.messages.actionFailed"));
    } finally {
      action.finish();
    }
  };
  return (
    <Dialog open={Boolean(value)} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`payout.dialog.${value?.kind ?? "pay"}.title`)}</DialogTitle>
          <DialogDescription>
            {value
              ? t(`payout.dialog.${value.kind}.description`, {
                  grossAmount: formatCrewMoney(
                    value.payout.amountMinor,
                    locale,
                    value.payout.currency
                  ),
                  amount: formatCrewMoney(
                    value.payout.netAmountMinor,
                    locale,
                    value.payout.currency
                  ),
                })
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <fieldset disabled={action.busy} className="contents">
            {value?.kind === "pay" ? (
              <>
                <Field label={t("payout.dialog.method")}>
                  <Select
                    value={method}
                    onValueChange={(next) => setMethod(next as CrewPayoutMethod)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYOUT_METHODS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {t(`payout.methods.${item}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("payout.dialog.reference")}>
                  <Input value={reference} onChange={(event) => setReference(event.target.value)} />
                </Field>
                <Field label={t("payout.dialog.proof")} optional>
                  <Input
                    value={proof}
                    onChange={(event) => setProof(event.target.value)}
                    type="url"
                  />
                </Field>
              </>
            ) : value?.kind === "void" ? (
              <Field label={t("payout.dialog.reason")}>
                <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
            ) : null}
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("actions.cancel")}
          </Button>
          <Button loading={action.busy} disabled={!valid} onClick={() => void submit()}>
            {t(`payout.dialog.${value?.kind ?? "pay"}.submit`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EarningDetailDialog({
  earning,
  onOpenChange,
  locale,
}: {
  earning: CrewEarningEntryDTO | null;
  onOpenChange: (open: boolean) => void;
  locale: string;
}) {
  const t = useTranslations("crewIncome");
  const detail = useCrewEarningDetail(earning?.id ?? null);
  const record = detail.data ?? earning;
  return (
    <DetailDialog
      open={Boolean(earning)}
      onOpenChange={onOpenChange}
      title={record?.title ?? t("detail.title")}
      description={t("detail.description")}
    >
      {record ? (
        <>
          <DetailHero
            value={
              <MoneyAmount currency={record.currency} value={record.amountMinor} locale={locale} />
            }
            status={<StatusBadge status={record.status} />}
          />
          <DetailFacts
            facts={[
              [t("detail.recorded"), formatDateTime(record.createdAt, locale)],
              [t("detail.source"), t(`sources.${record.sourceType}`)],
              ...(record.rejectionReason
                ? [[t("detail.rejectionReason"), record.rejectionReason]]
                : []),
              ...(record.reversalReason
                ? [[t("detail.reversalReason"), record.reversalReason]]
                : []),
            ]}
          />
          {record.task ? (
            <Link
              className="text-[10px] text-[#c9ccd2] underline"
              href={`?tab=tasks&task=${encodeURIComponent(record.task.id)}`}
            >
              TASK-{record.task.number} {record.task.title}
            </Link>
          ) : null}
          <Audit events={detail.data?.events ?? []} locale={locale} prefix="detail.events" />
        </>
      ) : null}
    </DetailDialog>
  );
}

function PayoutDetailDialog({
  payout,
  onOpenChange,
  locale,
}: {
  payout: CrewPayoutDTO | null;
  onOpenChange: (open: boolean) => void;
  locale: string;
}) {
  const t = useTranslations("crewIncome");
  const detail = useCrewPayoutDetail(payout?.id ?? null);
  const record = detail.data ?? payout;
  return (
    <DetailDialog
      open={Boolean(payout)}
      onOpenChange={onOpenChange}
      title={t("payout.detail.title")}
      description={t("payout.detail.description")}
    >
      {record ? (
        <>
          <DetailHero
            value={formatCrewMoney(record.netAmountMinor, locale, record.currency)}
            subtitle={
              <MoneyAmount currency={record.currency} value={record.amountMinor} locale={locale} />
            }
            status={<PayoutStatusBadge status={record.status} />}
          />
          <DetailFacts
            facts={[
              [
                t("payout.detail.gross"),
                formatCrewMoney(record.amountMinor, locale, record.currency),
              ],
              [
                t("payout.detail.withholding"),
                formatCrewMoney(record.withholdingAmountMinor, locale, record.currency),
              ],
              [t("detail.recorded"), formatDateTime(record.createdAt, locale)],
              ...(record.paymentReference
                ? [[t("payout.detail.reference"), record.paymentReference]]
                : []),
              ...(record.voidReason ? [[t("payout.detail.voidReason"), record.voidReason]] : []),
            ]}
          />
          <div>
            <h4 className="text-[10px] font-medium text-[#8a909a]">
              {t("payout.detail.allocations")}
            </h4>
            <div className="mt-2 divide-y divide-white/[0.055]">
              {record.allocations.map((allocation) => (
                <div
                  key={allocation.id}
                  className="flex items-center justify-between gap-3 py-2 text-[10px]"
                >
                  <span className="truncate text-[#bfc3ca]">{allocation.earning.title}</span>
                  <MoneyAmount
                    currency={record.currency}
                    value={allocation.amountMinor}
                    locale={locale}
                    className="font-mono text-[#e4e6e9]"
                  />
                </div>
              ))}
            </div>
          </div>
          <Audit events={detail.data?.events ?? []} locale={locale} prefix="payout.detail.events" />
        </>
      ) : null}
    </DetailDialog>
  );
}

function DetailDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("crewIncome");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">{children}</DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {t("detail.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function DetailHero({
  value,
  subtitle,
  status,
}: {
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  status: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between border-y border-white/[0.07] py-4">
      <div>
        <p className="font-mono text-[21px] font-semibold text-[#f1f2f4]">{value}</p>
        {subtitle ? <p className="mt-1 text-[10px] text-[#777d87]">{subtitle}</p> : null}
      </div>
      {status}
    </div>
  );
}
function DetailFacts({ facts }: { facts: Array<Array<React.ReactNode>> }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {facts.map(([label, value], index) => (
        <div key={index}>
          <dt className="text-[9px] text-[#6e747e]">{label}</dt>
          <dd className="mt-1 text-[10px] text-[#bfc3ca]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Audit({
  events,
  locale,
  prefix,
}: {
  events: Array<{ id: string; action: string; createdAt: string }>;
  locale: string;
  prefix: string;
}) {
  const t = useTranslations("crewIncome");
  return (
    <div className="border-t border-white/[0.07] pt-4">
      <h4 className="flex items-center gap-2 text-[10px] font-medium text-[#8a909a]">
        <IconHistory className="size-3.5" />
        {t("detail.auditTrail")}
      </h4>
      <div className="mt-3 space-y-3">
        {events.map((event) => (
          <div key={event.id} className="flex items-center justify-between gap-4 text-[10px]">
            <span className="text-[#bdc1c8]">{t(`${prefix}.${eventKey(event.action)}`)}</span>
            <time className="text-[#686e78]">{formatDateTime(event.createdAt, locale)}</time>
          </div>
        ))}
      </div>
    </div>
  );
}

function LedgerHeader({
  title,
  description,
  values,
  value,
  onChange,
  translationPrefix = "filters",
}: {
  title: string;
  description: string;
  values: string[];
  value: string;
  onChange: (value: string) => void;
  translationPrefix?: string;
}) {
  const t = useTranslations("crewIncome");
  return (
    <div className="flex flex-col gap-3 px-1 py-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h3 className="text-[13px] font-semibold text-[#e8e9ec]">{title}</h3>
        <p className="mt-1 text-[10px] text-[#6f7580]">{description}</p>
      </div>
      <Segmented>
        {values.map((item) => (
          <Segment key={item} active={value === item} onClick={() => onChange(item)}>
            {t(`${translationPrefix}.${item}`)}
          </Segment>
        ))}
      </Segmented>
    </div>
  );
}
function ResultState({
  query,
  emptyTitle,
  emptyDescription,
  children,
}: {
  query: {
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    data: unknown[];
    refetch: () => unknown;
    hasNextPage?: boolean;
    isFetchingNextPage?: boolean;
    isFetching?: boolean;
    isFetchNextPageError?: boolean;
    fetchNextPage: () => unknown;
  };
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("crewIncome");
  if (query.isLoading && !query.data.length)
    return (
      <div className="flex min-h-56 items-center justify-center gap-2 text-[11px] text-[#777d87]">
        <IconLoader2 className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  const error = query.isError ? (
    <div role="alert" className="flex min-h-32 flex-col items-center justify-center text-center">
      <p className="text-[11px] text-[#a5aab2]">
        {query.error instanceof Error ? query.error.message : t("loadFailed")}
      </p>
      <Button
        size="sm"
        variant="ghost"
        color="muted"
        className="mt-3"
        icon={<IconRefresh />}
        disabled={query.isFetching}
        onClick={() =>
          void (query.isFetchNextPageError &&
          !isCrewCursorError(query.error, "CREW_EARNING_CURSOR_INVALID") &&
          !isCrewCursorError(query.error, "CREW_PAYOUT_CURSOR_INVALID")
            ? query.fetchNextPage()
            : query.refetch())
        }
      >
        {t("retry")}
      </Button>
    </div>
  ) : null;
  if (error && !query.data.length) return error;
  if (!query.data.length)
    return (
      <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
        <IconReceipt2 className="size-5 text-[#777d87]" />
        <p className="mt-3 text-[12px] text-[#c9ccd2]">{emptyTitle}</p>
        <p className="mt-1 max-w-sm text-[10px] leading-5 text-[#707681]">{emptyDescription}</p>
      </div>
    );
  return (
    <>
      {error}
      {children}
      {query.hasNextPage && !query.isError ? (
        <div className="flex justify-center py-4">
          <Button
            size="sm"
            variant="ghost"
            color="muted"
            disabled={query.isFetching}
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {t("loadMore")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/[0.035] p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-3 font-mono text-2xl font-semibold text-[#e9eaed]">{value}</p>
    </div>
  );
}
function Segmented({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-w-full overflow-x-auto rounded-lg bg-white/[0.04] p-0.5">
      {children}
    </div>
  );
}
function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-medium transition-colors [&_svg]:size-3.5",
        active ? "bg-[#25272d] text-[#f1f2f4]" : "text-[#777d87] hover:text-[#c9ccd2]"
      )}
    >
      {children}
    </button>
  );
}
function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex h-8 items-center gap-1.5 text-[11px] font-medium transition-colors [&_svg]:size-3.5",
        active
          ? "text-[#f0f1f3] after:absolute after:right-0 after:bottom-[-17px] after:left-0 after:h-px after:bg-[#e52227]"
          : "text-[#747a84] hover:text-[#bfc3ca]"
      )}
    >
      {children}
    </button>
  );
}
function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("crewIncome");
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium text-[#b9bdc5]">
        {label}
        {optional ? <span className="ml-1 text-[#676d77]">{t("optional")}</span> : null}
      </span>
      {children}
    </label>
  );
}
function MemberSelect({
  value,
  onChange,
  members,
  displays,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  members: CrewMemberDTO[];
  displays: ReturnType<typeof useUserDisplays>;
  label: string;
}) {
  const t = useTranslations("crewIncome");
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={t("create.memberPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {members
            .filter((member) => member.status === "active")
            .map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {displayNameOf(member.userId, displays)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function StatusBadge({ status }: { status: CrewEarningStatus }) {
  const t = useTranslations("crewIncome");
  const Icon =
    status === "posted"
      ? IconCircleCheck
      : status === "pending"
        ? IconClockHour4
        : status === "rejected"
          ? IconX
          : IconArrowBackUp;
  return (
    <span className="inline-flex h-6 w-fit items-center gap-1.5 rounded-md bg-white/[0.045] px-2 text-[9px] text-[#a8adb6]">
      <Icon className="size-3.5" />
      {t(`status.${status}`)}
    </span>
  );
}
function PayoutStatusBadge({ status }: { status: CrewPayoutStatus }) {
  const t = useTranslations("crewIncome");
  return (
    <span className="inline-flex h-6 w-fit items-center gap-1.5 rounded-md bg-white/[0.045] px-2 text-[9px] text-[#a8adb6]">
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "paid"
            ? "bg-emerald-400"
            : status === "voided"
              ? "bg-[#6d737e]"
              : "bg-amber-400"
        )}
      />
      {t(`payout.status.${status}`)}
    </span>
  );
}
function SourceIcon({ source }: { source: CrewEarningSourceType }) {
  const Icon =
    source === "task_reward"
      ? IconRosetteDiscountCheck
      : source === "contract_compensation"
        ? IconFileInvoice
        : source === "revenue_share"
          ? IconTrendingUp
          : source === "adjustment"
            ? IconReceipt2
            : IconGift;
  return <Icon className="size-3 shrink-0" />;
}

/** Never present an absent, malformed or failed financial snapshot as a zero balance. */
function SummaryMoney({
  value,
  failed,
  locale,
}: {
  value: unknown;
  failed: boolean;
  locale: string;
}) {
  const t = useTranslations("crewIncome");
  if (failed || typeof value !== "string" || !/^-?\d+$/.test(value)) {
    return <span className="text-sm text-muted-foreground">{t("metrics.unavailable")}</span>;
  }
  return <MoneyAmount currency={CREW_CURRENCY} value={value} locale={locale} />;
}

function MoneyAmount({
  value,
  currency,
  locale,
  className,
}: {
  value: string;
  currency: CrewLedgerCurrency;
  locale: string;
  className?: string;
}) {
  return <span className={className}>{formatCrewMoney(value, locale, currency)}</span>;
}
function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
function formatDateTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function eventKey(action: string) {
  return action.split(".").at(-1) ?? "unknown";
}

function ProjectSpendSummary({
  crewId,
  canView,
  locale,
}: {
  crewId: string;
  canView: boolean;
  locale: string;
}) {
  const t = useTranslations("crewIncome");
  const { data, isLoading, isError, error } = useCrewExpensesSummary(crewId, canView);

  if (!canView) return null;

  if (isLoading) {
    return (
      <div className="mt-4 rounded-lg border border-white/[0.065] bg-white/[0.015] p-3.5">
        <p className="text-[11px] text-[#737983]">{t("spendSummaryHeading")}…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3.5">
        <p className="text-[11px] text-red-400">
          {error instanceof Error ? error.message : t("loadFailed")}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const validTotals = [
    data.taskRewardsByCurrency,
    data.reimbursementsByCurrency,
    data.totalByCurrency,
  ].every(
    (group) =>
      group &&
      ["CNY", "USD"].every(
        (currency) => typeof group[currency] === "string" && /^-?\d+$/.test(group[currency])
      )
  );
  if (!validTotals)
    return (
      <div role="alert" className="mt-4 text-sm text-muted-foreground">
        {t("metrics.unavailable")}
      </div>
    );

  const currencies = (["CNY", "USD"] as const).filter((c) => {
    const rewards = BigInt(data.taskRewardsByCurrency[c] ?? "0");
    const reimbursements = BigInt(data.reimbursementsByCurrency[c] ?? "0");
    const total = BigInt(data.totalByCurrency[c] ?? "0");
    return rewards > 0n || reimbursements > 0n || total > 0n;
  });

  if (currencies.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      {currencies.map((currency) => (
        <div
          key={currency}
          className="rounded-lg border border-white/[0.065] bg-white/[0.015] p-3.5"
        >
          <div className="mb-2 text-[11px] font-medium text-[#858b95]">
            {t("spendSummaryHeading")} · {currency}
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-white/[0.05] pt-2">
            <div>
              <div className="text-[10px] text-[#737983]">{t("spendSummaryTaskRewards")}</div>
              <div className="mt-0.5 text-[14px] font-semibold tracking-[-0.02em] tabular-nums text-[#f1f2f4]">
                {formatCrewMoney(data.taskRewardsByCurrency[currency] ?? "0", locale, currency)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#737983]">{t("spendSummaryReimbursements")}</div>
              <div className="mt-0.5 text-[14px] font-semibold tracking-[-0.02em] tabular-nums text-[#f1f2f4]">
                {formatCrewMoney(data.reimbursementsByCurrency[currency] ?? "0", locale, currency)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-[#737983]">{t("spendSummaryTotal")}</div>
              <div className="mt-0.5 text-[14px] font-semibold tracking-[-0.02em] tabular-nums text-[#f1f2f4]">
                {formatCrewMoney(data.totalByCurrency[currency] ?? "0", locale, currency)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
