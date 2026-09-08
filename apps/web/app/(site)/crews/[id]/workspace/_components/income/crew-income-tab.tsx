"use client";

import { createContext, useContext, useState } from "react";
import { CREW_CURRENCY, formatCrewMoney, type CrewLedgerCurrency } from "@/src/lib/crew-money";
const LedgerCurrencyContext = createContext<CrewLedgerCurrency>(CREW_CURRENCY);

import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { CREW_POINTS_PER_USD } from "@repo/shared";

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/src/i18n/i18n";

type View = "points" | "payouts";
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
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export function CrewIncomeTab({
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
  const t = useTranslations("crewIncome");
  const locale = useLocale();
  const [currency, setCurrency] = useState<CrewLedgerCurrency>(CREW_CURRENCY);
  const [view, setView] = useState<View>("points");
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
      currency,
      scope: effectiveScope,
      status: earningFilter === "all" ? undefined : earningFilter,
    },
    view === "points"
  );
  const payouts = useCrewPayouts(
    crewId,
    {
      currency,
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
    <LedgerCurrencyContext.Provider value={currency}>
      <div className="mx-auto w-full max-w-[1180px] pb-10">
        <NativeSelect
          aria-label={t("ledgerCurrency")}
          value={currency}
          onChange={(value) => setCurrency(value as CrewLedgerCurrency)}
          className="mb-4 rounded-md bg-background px-3 py-2 text-sm"
        >
          <NativeSelectOption value={CREW_CURRENCY}>{CREW_CURRENCY}</NativeSelectOption>
          <NativeSelectOption value="POINTS">{t("historicalBalances")}</NativeSelectOption>
        </NativeSelect>
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
              {view === "points" && canCreateEarning && currency !== "POINTS" ? (
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
            <ViewTab active={view === "points"} onClick={() => setView("points")}>
              <IconCoins /> {t("views.points")}
            </ViewTab>
            <ViewTab active={view === "payouts"} onClick={() => setView("payouts")}>
              <IconCash /> {t("views.payouts")}
            </ViewTab>
          </nav>
        </header>

        {view === "points" ? (
          <PointsLedger
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

        <CreateEarningDialog
          open={createEarningOpen}
          onOpenChange={setCreateEarningOpen}
          crewId={crewId}
          members={members}
          displays={displays}
        />
        <CreatePayoutDialog
          open={createPayoutOpen}
          onOpenChange={setCreatePayoutOpen}
          crewId={crewId}
          members={members}
          displays={displays}
          locale={locale}
        />
        <EarningDecisionDialog
          value={earningDecision}
          onOpenChange={(open) => !open && setEarningDecision(null)}
          crewId={crewId}
        />
        <PayoutActionDialog
          value={payoutAction}
          onOpenChange={(open) => !open && setPayoutAction(null)}
          crewId={crewId}
          locale={locale}
        />
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
    </LedgerCurrencyContext.Provider>
  );
}

function PointsLedger({
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
  const approve = useApproveCrewEarning(crewId);
  const summary = query.summary;
  const approveEntry = async (earning: CrewEarningEntryDTO) => {
    try {
      await approve.mutateAsync({ earningId: earning.id, expectedVersion: earning.version });
      toast.success(t("messages.approved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("messages.actionFailed"));
    }
  };
  return (
    <section className="pt-5">
      <div className="grid border-y border-white/[0.065] sm:grid-cols-3">
        <Metric
          label={t("metrics.confirmedPoints")}
          value={
            <PointAmount value={summary?.byStatus.posted.pointsAmount ?? "0"} locale={locale} />
          }
        />
        <Metric
          label={t("metrics.pendingPoints")}
          value={
            <PointAmount value={summary?.byStatus.pending.pointsAmount ?? "0"} locale={locale} />
          }
        />
        <Metric
          label={t("metrics.monthPoints")}
          value={<PointAmount value={summary?.postedThisMonthPoints ?? "0"} locale={locale} />}
        />
      </div>
      <LedgerHeader
        title={t("points.history")}
        description={t("points.historyDescription")}
        values={["all", "pending", "posted", "rejected", "reversed"]}
        value={filter}
        onChange={(value) => setFilter(value as EarningFilter)}
      />
      <ResultState
        query={query}
        emptyTitle={t("points.emptyTitle")}
        emptyDescription={t("points.emptyDescription")}
      >
        <div className="divide-y divide-white/[0.055] border-t border-white/[0.055]">
          {query.data.map((earning) => (
            <div
              key={earning.id}
              className="grid gap-3 px-2 py-3.5 transition-colors hover:bg-white/[0.02] md:grid-cols-[minmax(0,1fr)_110px_120px_130px] md:items-center"
            >
              <div className="flex min-w-0 items-center gap-3">
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
              <StatusBadge status={earning.status} />
              <time className="text-[10px] text-[#727883]">
                {formatDate(earning.createdAt, locale)}
              </time>
              <div className="flex items-center justify-between gap-2 md:justify-end">
                <PointAmount
                  currency={earning.currency}
                  value={earning.pointsAmount}
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
                      disabled={approve.isPending}
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
      <div className="grid border-y border-white/[0.065] sm:grid-cols-3">
        <Metric
          label={t("metrics.availablePoints")}
          value={<PointAmount value={query.summary?.availablePoints ?? "0"} locale={locale} />}
        />
        <Metric
          label={t("metrics.reservedPoints")}
          value={<PointAmount value={query.summary?.reservedPoints ?? "0"} locale={locale} />}
        />
        <Metric
          label={t("metrics.paidPoints")}
          value={<PointAmount value={query.summary?.paidPoints ?? "0"} locale={locale} />}
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
                    <PointAmount
                      currency={payout.currency}
                      value={payout.pointsAmount}
                      locale={locale}
                    />{" "}
                    · {formatDate(payout.createdAt, locale)}
                  </p>
                </div>
              </div>
              <PayoutStatusBadge status={payout.status} />
              <span className="font-mono text-[11px] font-semibold text-[#e8e9ec]">
                {formatUsd(payout.netAmountMinor, locale, payout.currency)}
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
  const create = useCreateCrewEarning(crewId);
  const [memberId, setMemberId] = useState("");
  const [sourceType, setSourceType] = useState<ManualSource>("milestone_bonus");
  const [title, setTitle] = useState("");
  const [points, setPoints] = useState("");
  const [description, setDescription] = useState("");
  const amountMinor = parseMoney(points, 2);
  const parsedPoints = amountMinor && BigInt(amountMinor) > 0n ? amountMinor : null;
  const close = (value: boolean) => {
    if (!value) {
      setMemberId("");
      setTitle("");
      setPoints("");
      setDescription("");
    }
    onOpenChange(value);
  };
  const submit = async () => {
    if (!memberId || !title.trim() || !parsedPoints) return;
    try {
      await create.mutateAsync({
        crewMemberId: memberId,
        sourceType,
        title: title.trim(),
        description: description.trim() || undefined,
        pointsAmount: parsedPoints,
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success(t("messages.created"));
      close(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("messages.createFailed"));
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
          <Field label={`${t("create.points")} (${CREW_CURRENCY})`}>
            <Input
              value={points}
              onChange={(event) => setPoints(event.target.value)}
              inputMode="decimal"
              placeholder="0"
              aria-invalid={Boolean(points) && !parsedPoints}
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
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("actions.cancel")}
          </Button>
          <Button
            loading={create.isPending}
            disabled={!memberId || !title.trim() || !parsedPoints}
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
  const currency = useContext(LedgerCurrencyContext);
  const create = useCreateCrewPayout(crewId);
  const [memberId, setMemberId] = useState("");
  const [points, setPoints] = useState("");
  const [withholding, setWithholding] = useState("0");
  const [note, setNote] = useState("");
  const amountMinor = parseMoney(points, currency === "POINTS" ? 0 : 2);
  const parsedPoints = amountMinor && BigInt(amountMinor) > 0n ? amountMinor : null;
  const grossMinor = parsedPoints;
  const withholdingMinor = parseMoney(withholding, 2);
  const netMinor =
    grossMinor != null && withholdingMinor != null
      ? BigInt(grossMinor) - BigInt(withholdingMinor)
      : null;
  const valid = Boolean(
    memberId && parsedPoints && withholdingMinor != null && netMinor && netMinor > 0n
  );
  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setMemberId("");
      setPoints("");
      setWithholding("0");
      setNote("");
    }
    onOpenChange(nextOpen);
  };
  const submit = async () => {
    if (!valid || !parsedPoints || withholdingMinor == null) return;
    try {
      await create.mutateAsync({
        crewMemberId: memberId,
        pointsAmount: parsedPoints,
        currency,
        withholdingAmountMinor: withholdingMinor,
        note: note.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success(t("payout.messages.created"));
      close(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("payout.messages.actionFailed"));
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
          <MemberSelect
            value={memberId}
            onChange={setMemberId}
            members={members}
            displays={displays}
            label={t("payout.create.member")}
          />
          <Field label={`${t("payout.create.points")} (${currency})`}>
            <Input
              value={points}
              onChange={(event) => setPoints(event.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("payout.create.gross")}>
              <Input value={grossMinor ? formatUsdInput(grossMinor) : ""} readOnly />
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
              {netMinor && netMinor > 0n ? formatUsd(netMinor.toString(), locale, currency) : "—"}
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
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("actions.cancel")}
          </Button>
          <Button loading={create.isPending} disabled={!valid} onClick={() => void submit()}>
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
    try {
      await mutation.mutateAsync({
        earningId: value.earning.id,
        expectedVersion: value.earning.version,
        reason: reason.trim(),
      });
      toast.success(t(`messages.${value.kind === "reverse" ? "reversed" : "rejected"}`));
      close(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("messages.actionFailed"));
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
          <Textarea
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("decision.reasonPlaceholder")}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("actions.cancel")}
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!reason.trim()}
            onClick={() => void submit()}
          >
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
    try {
      await mutation.mutateAsync({
        payoutId: value.payout.id,
        expectedVersion: value.payout.version,
        paymentMethod: method,
        paymentReference: reference.trim() || undefined,
        paymentProofUrl: proof.trim() || undefined,
        reason: reason.trim() || undefined,
      });
      toast.success(t(`payout.messages.${value.kind}`));
      close(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("payout.messages.actionFailed"));
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
                  points:
                    value.payout.currency === "POINTS"
                      ? formatPointsText(value.payout.pointsAmount, locale, t("pointsUnit"))
                      : formatCrewMoney(value.payout.pointsAmount, locale, value.payout.currency),
                  amount: formatUsd(value.payout.netAmountMinor, locale, value.payout.currency),
                })
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
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
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" color="muted" onClick={() => close(false)}>
            {t("actions.cancel")}
          </Button>
          <Button loading={mutation.isPending} disabled={!valid} onClick={() => void submit()}>
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
              <PointAmount currency={record.currency} value={record.pointsAmount} locale={locale} />
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
            value={formatUsd(record.netAmountMinor, locale, record.currency)}
            subtitle={
              <PointAmount currency={record.currency} value={record.pointsAmount} locale={locale} />
            }
            status={<PayoutStatusBadge status={record.status} />}
          />
          <DetailFacts
            facts={[
              [t("payout.detail.gross"), formatUsd(record.pointsAmount, locale, record.currency)],
              [
                t("payout.detail.withholding"),
                formatUsd(record.withholdingAmountMinor, locale, record.currency),
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
                  <PointAmount
                    value={allocation.pointsAmount}
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
    fetchNextPage: () => unknown;
  };
  emptyTitle: string;
  emptyDescription: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("crewIncome");
  if (query.isLoading)
    return (
      <div className="flex min-h-56 items-center justify-center gap-2 text-[11px] text-[#777d87]">
        <IconLoader2 className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  if (query.isError)
    return (
      <div className="flex min-h-56 flex-col items-center justify-center text-center">
        <p className="text-[11px] text-[#a5aab2]">
          {query.error instanceof Error ? query.error.message : t("loadFailed")}
        </p>
        <Button
          size="sm"
          variant="ghost"
          color="muted"
          className="mt-3"
          icon={<IconRefresh />}
          onClick={() => void query.refetch()}
        >
          {t("retry")}
        </Button>
      </div>
    );
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
      {children}
      {query.hasNextPage ? (
        <div className="flex justify-center py-4">
          <Button
            size="sm"
            variant="ghost"
            color="muted"
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
    <div className="border-b border-white/[0.055] px-2 py-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
      <p className="text-[9px] text-[#686e78]">{label}</p>
      <p className="mt-1 font-mono text-[16px] font-semibold text-[#e9eaed]">{value}</p>
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

function parseMoney(value: string, decimals: number) {
  const normalized = value.trim();
  const pattern = decimals === 0 ? /^(?:0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
  if (!pattern.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const scale = 10n ** BigInt(decimals);
  const minor = BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0") || "0");
  return minor <= MAX_SIGNED_BIGINT ? minor.toString() : null;
}
function PointAmount({
  currency: recordCurrency,
  value,
  locale,
  className,
}: {
  value: string;
  currency?: CrewLedgerCurrency;
  locale: string;
  className?: string;
}) {
  const t = useTranslations("crewIncome");
  const ledgerCurrency = useContext(LedgerCurrencyContext);
  const currency = recordCurrency ?? ledgerCurrency;
  const display = formatPointsText(value, locale, t("pointsUnit"));
  if (currency !== "POINTS")
    return <span className={className}>{formatCrewMoney(value, locale, currency)}</span>;
  const referenceValue = formatPointReferenceValue(value, locale);
  const referenceBenchmark = formatPointReferenceValue(String(CREW_POINTS_PER_USD), locale);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "cursor-help decoration-white/35 underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/35",
            className
          )}
        >
          {display}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 leading-5">
        {t("pointsValueTooltip", {
          points: display,
          amount: referenceValue,
          benchmark: referenceBenchmark,
        })}
      </TooltipContent>
    </Tooltip>
  );
}
function formatPointsText(value: string, locale: string, unit: string) {
  return `${BigInt(value).toLocaleString(locale)} ${unit}`;
}
function formatPointReferenceValue(value: string, locale: string) {
  return formatUsd(value, locale, "USD");
}
function formatUsd(value: string, locale: string, currency: CrewLedgerCurrency = CREW_CURRENCY) {
  return formatCrewMoney(value, locale, currency === "POINTS" ? "USD" : currency);
}
function formatUsdInput(value: string) {
  const amount = BigInt(value);
  const divisor = 100n;
  const major = amount / divisor;
  const fraction = (amount % divisor).toString().padStart(2, "0");
  return `${major.toString()}.${fraction}`;
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
