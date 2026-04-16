import { useState } from "react";
import {
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconSend,
  IconAlertCircle,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  EP_STATUS_COLOR,
  MEMBER_STATUS_META,
  MEMBER_ACTIONS,
  MOCK_EPISODES,
  type EpisodeData,
  type EpMember,
} from "./workspace-mock";

// ─── Styled button ───────────────────────────────────

const BTN_STYLES: Record<string, string> = {
  primary: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20",
  warn: "bg-amber-400/10 text-amber-400 border-amber-400/20 hover:bg-amber-400/20",
  ghost: "bg-secondary text-muted-foreground border-border hover:text-foreground",
  red: "bg-red-400/10 text-red-400 border-red-400/20 hover:bg-red-400/20",
};

function ActionBtn({
  style,
  disabled,
  children,
  onClick,
}: {
  style: string;
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
        disabled ? "cursor-not-allowed opacity-30" : BTN_STYLES[style]
      )}
    >
      {children}
    </button>
  );
}

// ─── Reject modal ────────────────────────────────────

function RejectModal({
  name,
  role,
  onClose,
  onConfirm,
}: {
  name: string;
  role: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("workspace");
  const [reason, setReason] = useState("");
  const [suggestion, setSuggestion] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-foreground">
            {t("reject")} · {name} / {role}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <IconX className="size-4" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("rejectReason")} <span className="text-red-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("rejectReasonPlaceholder")}
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("rejectSuggestion")}
            </label>
            <textarea
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              placeholder={t("rejectSuggestionPlaceholder")}
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-border bg-secondary py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/70"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="flex-1 rounded-xl border border-red-400/30 bg-red-400/10 py-2.5 text-sm font-bold text-red-400 transition-colors hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("confirmReject")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Flow step ───────────────────────────────────────

function FlowStep({
  num,
  titleKey,
  status,
  desc,
  isLast,
}: {
  num: string;
  titleKey: string;
  status: "done" | "active" | "waiting";
  desc: string;
  isLast?: boolean;
}) {
  const t = useTranslations("workspace");
  const colors = {
    done: { dot: "border-green-400 bg-green-400", text: "text-green-400", labelKey: "flowDone" },
    active: { dot: "border-blue-400 bg-blue-400", text: "text-blue-400", labelKey: "flowActive" },
    waiting: {
      dot: "border-border bg-secondary",
      text: "text-muted-foreground",
      labelKey: "flowWaiting",
    },
  };
  const c = colors[status];

  return (
    <div className="flex flex-1 items-start gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold",
            c.dot,
            status === "done"
              ? "text-green-400"
              : status === "active"
                ? "text-blue-400"
                : "text-muted-foreground"
          )}
        >
          {status === "done" ? <IconCircleCheck className="size-3.5" /> : num}
        </div>
        {!isLast && <div className="mt-1 min-h-[20px] w-px flex-1 bg-border" />}
      </div>
      <div className="flex-1 pb-4">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{t(titleKey)}</span>
          <span className={cn("text-xs font-semibold", c.text)}>{t(c.labelKey)}</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

// ─── Episode detail (expanded) ───────────────────────

function EpisodeDetail({ ep }: { ep: EpisodeData }) {
  const t = useTranslations("workspace");
  const canSubmit = ep.passed === ep.members && ep.pending === 0 && ep.members > 0;
  const [memberStatuses, setMemberStatuses] = useState<Record<string, string>>(
    Object.fromEntries(ep.membersList.map((m) => [m.name, m.status]))
  );
  const [rejectTarget, setRejectTarget] = useState<EpMember | null>(null);

  const handleAction = (member: EpMember, action: string) => {
    if (action === "approve") setMemberStatuses((prev) => ({ ...prev, [member.name]: "approved" }));
    else if (action === "reject") setRejectTarget(member);
    else if (action === "submit")
      setMemberStatuses((prev) => ({ ...prev, [member.name]: "submitted" }));
  };

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      {/* Status overview */}
      <div className="rounded-xl bg-secondary/30 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("epStatusOverview")}
          </h4>
          <div className="flex items-center gap-2">
            <ActionBtn style="ghost">{t("configMembers")}</ActionBtn>
            <ActionBtn style="ghost">{t("viewDeliveryLog")}</ActionBtn>
            <ActionBtn style={canSubmit ? "primary" : "ghost"} disabled={!canSubmit}>
              <span className="flex items-center gap-1">
                <IconSend className="size-3" /> {t("submitToClient")}
              </span>
            </ActionBtn>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            { labelKey: "colMembers", value: ep.members, color: "text-foreground" },
            { labelKey: "colApproved", value: ep.passed, color: "text-green-400" },
            {
              labelKey: "colPending",
              value: ep.pending,
              color: ep.pending > 0 ? "text-amber-400" : "text-muted-foreground",
            },
            {
              labelKey: "colEpStatus",
              value: t(ep.statusLabelKey),
              color:
                ep.status === "in_progress"
                  ? "text-blue-400"
                  : ep.status === "completed"
                    ? "text-green-400"
                    : "text-muted-foreground",
            },
            {
              labelKey: "colClientStatus",
              value: t(ep.clientStatusKey),
              color:
                ep.clientStatusKey === "clientConfirmed"
                  ? "text-green-400"
                  : "text-muted-foreground",
            },
            {
              labelKey: "colLastUpdated",
              value: ep.isCurrent ? "2小时前" : (ep.membersList[0]?.updated ?? "-"),
              color: "text-foreground",
            },
          ].map((s) => (
            <div key={s.labelKey}>
              <div className="mb-0.5 text-xs text-muted-foreground">{t(s.labelKey)}</div>
              <div className={cn("text-sm font-bold", s.color)}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Confirmation flow */}
      <div className="rounded-xl bg-secondary/30 p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("confirmationFlow")}
        </h4>
        <div className="space-y-0">
          <FlowStep
            num="1"
            titleKey="flowMemberDelivery"
            status={ep.passed === ep.members ? "done" : ep.members > 0 ? "active" : "waiting"}
            desc={
              ep.members > 0
                ? `${ep.members} ${t("people")}，${ep.passed} ${t("flowSubmitted")}，${ep.pending} ${t("flowPendingCount")}`
                : t("flowNoMembers")
            }
          />
          <FlowStep
            num="2"
            titleKey="flowProducerReview"
            status={
              ep.clientStatusKey !== "notSubmitted" ? "done" : ep.passed > 0 ? "active" : "waiting"
            }
            desc={
              ep.passed > 0
                ? `${ep.passed} ${t("flowApprovedCount")}，${ep.pending} ${t("flowPendingReview")}`
                : t("flowWaitingSubmissions")
            }
          />
          <FlowStep
            num="3"
            titleKey="flowClientConfirm"
            isLast
            status={ep.clientStatusKey === "clientConfirmed" ? "done" : "waiting"}
            desc={
              ep.clientStatusKey === "clientConfirmed"
                ? t("flowClientDone")
                : t("flowClientWaiting")
            }
          />
        </div>
      </div>

      {/* Member status */}
      {ep.membersList.length > 0 && (
        <div className="rounded-xl bg-secondary/30 p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("memberStatus")}
          </h4>
          <div className="space-y-2">
            {ep.membersList.map((m) => {
              const currentStatus = memberStatuses[m.name] || m.status;
              const meta = MEMBER_STATUS_META[currentStatus];
              const actions = MEMBER_ACTIONS[currentStatus] || [];
              return (
                <div
                  key={m.name}
                  className="flex items-center justify-between border-b border-border/50 py-2 last:border-0"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs font-bold text-foreground">
                      {m.name[0]}
                    </div>
                    <div>
                      <span className="text-sm font-medium text-foreground">{m.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">/ {m.role}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2.5">
                    <span className="text-xs text-muted-foreground">{m.updated}</span>
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-semibold",
                        meta.color
                      )}
                    >
                      {t(meta.labelKey)}
                    </span>
                    <div className="flex gap-1">
                      {actions.map((a) => (
                        <ActionBtn
                          key={a.labelKey}
                          style={a.style}
                          onClick={() => handleAction(m, a.action)}
                        >
                          {t(a.labelKey)}
                        </ActionBtn>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rejectTarget && (
        <RejectModal
          name={rejectTarget.name}
          role={rejectTarget.role}
          onClose={() => setRejectTarget(null)}
          onConfirm={() => {
            setMemberStatuses((prev) => ({ ...prev, [rejectTarget.name]: "rejected" }));
            setRejectTarget(null);
          }}
        />
      )}

      {/* Client confirmation */}
      <div className="rounded-xl bg-secondary/30 p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("clientConfirmStatus")}
        </h4>
        {ep.clientStatusKey === "clientConfirmed" ? (
          <div className="flex items-center gap-2 text-sm text-green-400">
            <IconCircleCheck className="size-4" /> {t("flowClientDone")}
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <IconAlertCircle className="size-4 shrink-0 text-amber-400" />
              {ep.pending > 0
                ? t("clientPendingMembers", { count: ep.pending })
                : t("clientReadySubmit")}
            </div>
            <div className="mt-3 flex gap-2">
              <ActionBtn style="ghost" disabled>
                {t("viewFeedback")}
              </ActionBtn>
              <ActionBtn style={canSubmit ? "primary" : "ghost"} disabled={!canSubmit}>
                <span className="flex items-center gap-1">
                  <IconSend className="size-3" /> {t("submitToClient")}
                </span>
              </ActionBtn>
            </div>
          </>
        )}
      </div>

      {/* Episode activity */}
      {ep.activity.length > 0 && (
        <div className="rounded-xl bg-secondary/30 p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("epActivity")}
          </h4>
          <div className="space-y-0">
            {ep.activity.map((a, i) => (
              <div
                key={i}
                className="flex items-start gap-2.5 border-b border-border/50 py-2 last:border-0"
              >
                <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/50" />
                <div className="flex flex-1 items-center justify-between gap-4">
                  <span className="text-sm text-foreground/80">{a.text}</span>
                  {a.time && (
                    <span className="shrink-0 text-xs text-muted-foreground">{a.time}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main accordion ──────────────────────────────────

export function EpisodeAccordion() {
  const t = useTranslations("workspace");
  const [openEp, setOpenEp] = useState(3);
  const [rejectEp, setRejectEp] = useState<EpisodeData | null>(null);

  return (
    <div className="space-y-3">
      {MOCK_EPISODES.map((ep) => {
        const isOpen = openEp === ep.ep;
        const statusColor = EP_STATUS_COLOR[ep.status] || "";
        const canAct = ep.status === "in_progress";

        return (
          <div
            key={ep.ep}
            className={cn(
              "overflow-hidden rounded-xl border bg-card transition-all",
              ep.isCurrent ? "border-primary/40" : "border-border"
            )}
          >
            <div
              onClick={() => setOpenEp(isOpen ? 0 : ep.ep)}
              className="flex w-full cursor-pointer items-center justify-between px-5 py-4 text-left transition-colors hover:bg-secondary/20"
            >
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg border text-xs font-black",
                    statusColor
                  )}
                >
                  {ep.ep}
                </div>
                <div>
                  <div className="mb-0.5 flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{ep.label}</span>
                    {ep.isCurrent && (
                      <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                        {t("current")}
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-semibold",
                        statusColor
                      )}
                    >
                      {t(ep.statusLabelKey)}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">{ep.summary}</span>
                </div>
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-2">
                {canAct && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRejectEp(ep);
                      }}
                      className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-400/20"
                    >
                      {t("rejectEpisode")}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      <IconSend className="size-3" /> {t("submitForReview")}
                    </button>
                  </>
                )}
                {isOpen ? (
                  <IconChevronUp className="size-4 text-muted-foreground" />
                ) : (
                  <IconChevronDown className="size-4 text-muted-foreground" />
                )}
              </div>
            </div>
            {isOpen && (
              <div className="px-5 pb-5">
                <EpisodeDetail ep={ep} />
              </div>
            )}
          </div>
        );
      })}
      {rejectEp && (
        <RejectModal
          name={rejectEp.label}
          role={t("fullEpisodeReject")}
          onClose={() => setRejectEp(null)}
          onConfirm={() => setRejectEp(null)}
        />
      )}
    </div>
  );
}
