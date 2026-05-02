"use client";

/**
 * Episode accordion for `/crews-v2/[id]/workspace` (Episodes tab).
 * Direct port of fizzdragon-prd `components/workspace/EpisodeAccordion.tsx`,
 * with lucide → tabler icons, all UI strings via the feature-private
 * `useT()` hook, and member-status / ep-status values kept as English
 * literals in mock data and mapped to i18n keys at render time.
 */

import { useState } from "react";
import {
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconAlertCircle,
  IconSend,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useT } from "../_hooks/use-t";
import {
  WORKSPACE_EPISODES,
  type MemberStatus,
  type WorkspaceEpisode,
  type WorkspaceMember,
} from "../_data/mock";
import type { CrewsV2Key } from "../_data/i18n";

const EP_STATUS_COLOR: Record<WorkspaceEpisode["status"], string> = {
  Completed: "text-green-400 bg-green-400/10 border-green-400/30",
  "In Progress": "text-blue-400 bg-blue-400/10 border-blue-400/30",
  "Not Started": "text-muted-foreground bg-secondary border-border",
};

const EP_STATUS_KEY: Record<WorkspaceEpisode["status"], CrewsV2Key> = {
  Completed: "wsEpStatusCompleted",
  "In Progress": "wsEpStatusInProgress",
  "Not Started": "wsEpStatusNotStarted",
};

const MEMBER_STATUS_META: Record<MemberStatus, { labelKey: CrewsV2Key; color: string }> = {
  approved: {
    labelKey: "wsMemberApproved",
    color: "text-green-400 bg-green-400/10 border-green-400/30",
  },
  submitted: {
    labelKey: "wsMemberSubmitted",
    color: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  },
  in_progress: {
    labelKey: "wsMemberInProgress",
    color: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  },
  rejected: {
    labelKey: "wsMemberRejected",
    color: "text-red-400 bg-red-400/10 border-red-400/30",
  },
};

type ActionStyle = "primary" | "warn" | "ghost" | "red";

const MEMBER_ACTIONS: Record<
  MemberStatus,
  { labelKey: CrewsV2Key; style: ActionStyle; action: "view" | "approve" | "reject" | "submit" }[]
> = {
  approved: [{ labelKey: "wsActionView", style: "ghost", action: "view" }],
  submitted: [
    { labelKey: "wsActionView", style: "ghost", action: "view" },
    { labelKey: "wsActionApprove", style: "primary", action: "approve" },
    { labelKey: "wsActionReject", style: "red", action: "reject" },
  ],
  in_progress: [
    { labelKey: "wsActionView", style: "ghost", action: "view" },
    { labelKey: "wsActionSubmitForReview", style: "warn", action: "submit" },
  ],
  rejected: [
    { labelKey: "wsActionView", style: "ghost", action: "view" },
    { labelKey: "wsActionSubmitForReview", style: "warn", action: "submit" },
  ],
};

const ACTION_STYLES: Record<ActionStyle, string> = {
  primary: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20",
  warn: "bg-amber-400/10 text-amber-400 border-amber-400/20 hover:bg-amber-400/20",
  ghost: "bg-secondary text-muted-foreground border-border hover:text-foreground",
  red: "bg-red-400/10 text-red-400 border-red-400/20 hover:bg-red-400/20",
};

function Btn({
  style,
  children,
  disabled,
  onClick,
}: {
  style: ActionStyle;
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
        disabled ? "cursor-not-allowed opacity-30" : ACTION_STYLES[style]
      )}
    >
      {children}
    </button>
  );
}

function RejectModal({
  member,
  onClose,
  onConfirm,
}: {
  member: { name: string; role: string };
  onClose: () => void;
  onConfirm: (reason: string, suggestion: string) => void;
}) {
  const t = useT();
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
            {t("wsRejectModalTitle", { name: member.name, role: member.role })}
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
              {t("wsRejectReasonLabel")} <span className="text-red-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("wsRejectReasonPlaceholder")}
              rows={3}
              className="w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("wsRejectSuggestionLabel")}
            </label>
            <textarea
              value={suggestion}
              onChange={(e) => setSuggestion(e.target.value)}
              placeholder={t("wsRejectSuggestionPlaceholder")}
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
            {t("wsCancelBtn")}
          </button>
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={() => {
              onConfirm(reason, suggestion);
              onClose();
            }}
            className="flex-1 rounded-xl border border-red-400/30 bg-red-400/10 py-2.5 text-sm font-bold text-red-400 transition-colors hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("wsConfirmRejectBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}

const FLOW_COLORS = {
  done: {
    dot: "bg-green-400 border-green-400",
    text: "text-green-400",
    labelKey: "wsFlowDone" as const,
  },
  active: {
    dot: "bg-blue-400 border-blue-400",
    text: "text-blue-400",
    labelKey: "wsFlowActive" as const,
  },
  waiting: {
    dot: "bg-secondary border-border",
    text: "text-muted-foreground",
    labelKey: "wsFlowWaiting" as const,
  },
};

function FlowStep({
  num,
  titleKey,
  status,
  desc,
  isLast,
}: {
  num: number;
  titleKey: CrewsV2Key;
  status: keyof typeof FLOW_COLORS;
  desc: string;
  isLast?: boolean;
}) {
  const t = useT();
  const c = FLOW_COLORS[status];
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

function EpisodeDetail({ ep }: { ep: WorkspaceEpisode }) {
  const t = useT();
  const canSubmit = ep.passed === ep.members && ep.pending === 0;
  const [memberStatuses, setMemberStatuses] = useState<Record<string, MemberStatus>>(
    Object.fromEntries(ep.membersList.map((m) => [m.name, m.status]))
  );
  const [rejectTarget, setRejectTarget] = useState<WorkspaceMember | null>(null);

  const handleAction = (
    member: WorkspaceMember,
    action: "view" | "approve" | "reject" | "submit"
  ) => {
    if (action === "approve") setMemberStatuses((prev) => ({ ...prev, [member.name]: "approved" }));
    else if (action === "reject") setRejectTarget(member);
    else if (action === "submit")
      setMemberStatuses((prev) => ({ ...prev, [member.name]: "submitted" }));
  };

  const submittedCount = ep.passed + (ep.members - ep.passed - ep.pending);

  // Confirmation flow descriptions
  const flow1Status = ep.passed === ep.members ? "done" : ep.members > 0 ? "active" : "waiting";
  const flow1Desc =
    ep.members > 0
      ? t("wsFlow1Desc", { members: ep.members, submitted: submittedCount, pending: ep.pending })
      : t("wsFlow1DescEmpty");

  const flow2Status =
    ep.clientStatus !== "Not Submitted" ? "done" : ep.passed > 0 ? "active" : "waiting";
  const flow2Desc =
    ep.passed > 0
      ? t("wsFlow2DescBase", { passed: ep.passed, pending: ep.pending }) +
        (ep.pending > 0 ? t("wsFlow2DescBlock") : "")
      : t("wsFlow2DescEmpty");

  const flow3Status: keyof typeof FLOW_COLORS =
    ep.clientStatus === "Client Confirmed" ? "done" : "waiting";
  const flow3Desc =
    ep.clientStatus === "Client Confirmed" ? t("wsFlow3DescDone") : t("wsFlow3DescWait");

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      {/* A. Status Overview */}
      <div className="rounded-xl bg-secondary/30 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("wsEpStatusOverviewTitle")}
          </h4>
          <div className="flex items-center gap-2">
            <Btn style="ghost">{t("wsConfigureMembers")}</Btn>
            <Btn style="ghost">{t("wsViewDeliveryLog")}</Btn>
            <Btn style={canSubmit ? "primary" : "ghost"} disabled={!canSubmit}>
              <span className="flex items-center gap-1">
                <IconSend className="size-3" /> {t("wsSubmitToClient")}
              </span>
            </Btn>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            {
              labelKey: "wsStatMembers" as const,
              value: String(ep.members),
              color: "text-foreground",
            },
            {
              labelKey: "wsStatApproved" as const,
              value: String(ep.passed),
              color: "text-green-400",
            },
            {
              labelKey: "wsStatPending" as const,
              value: String(ep.pending),
              color: ep.pending > 0 ? "text-amber-400" : "text-muted-foreground",
            },
            {
              labelKey: "wsStatEpStatus" as const,
              value: t(EP_STATUS_KEY[ep.status]),
              color:
                ep.status === "In Progress"
                  ? "text-blue-400"
                  : ep.status === "Completed"
                    ? "text-green-400"
                    : "text-muted-foreground",
            },
            {
              labelKey: "wsStatClientStatus" as const,
              value:
                ep.clientStatus === "Client Confirmed"
                  ? t("wsEpClientConfirmed")
                  : t("wsEpClientNotSubmitted"),
              color:
                ep.clientStatus === "Client Confirmed" ? "text-green-400" : "text-muted-foreground",
            },
            {
              labelKey: "wsStatLastUpdatedShort" as const,
              value: ep.lastUpdated,
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

      {/* B. Confirmation Flow */}
      <div className="rounded-xl bg-secondary/30 p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("wsConfirmFlowTitle")}
        </h4>
        <div className="space-y-0">
          <FlowStep num={1} titleKey="wsFlow1Title" status={flow1Status} desc={flow1Desc} />
          <FlowStep num={2} titleKey="wsFlow2Title" status={flow2Status} desc={flow2Desc} />
          <FlowStep num={3} titleKey="wsFlow3Title" status={flow3Status} desc={flow3Desc} isLast />
        </div>
      </div>

      {/* C. Member Status */}
      {ep.membersList.length > 0 && (
        <div className="rounded-xl bg-secondary/30 p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("wsMemberStatusTitle")}
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
                    {m.updated && (
                      <span className="text-xs text-muted-foreground">{m.updated}</span>
                    )}
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
                        <Btn
                          key={a.labelKey}
                          style={a.style}
                          onClick={() => handleAction(m, a.action)}
                        >
                          {t(a.labelKey)}
                        </Btn>
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
          member={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={() => {
            setMemberStatuses((prev) => ({ ...prev, [rejectTarget.name]: "rejected" }));
            setRejectTarget(null);
          }}
        />
      )}

      {/* D. Client Confirmation Status */}
      <div className="rounded-xl bg-secondary/30 p-4">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("wsClientConfirmStatusTitle")}
        </h4>
        {ep.clientStatus === "Client Confirmed" ? (
          <div className="flex items-center gap-2 text-sm text-green-400">
            <IconCircleCheck className="size-4" /> {t("wsClientConfirmedFull")}
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <IconAlertCircle className="size-4 shrink-0 text-amber-400" />
              {ep.pending > 0 ? t("wsCannotSubmitMsg", { n: ep.pending }) : t("wsAllApprovedReady")}
            </div>
            <div className="mt-3 flex gap-2">
              <Btn style="ghost" disabled>
                {t("wsViewFeedback")}
              </Btn>
              <Btn style={canSubmit ? "primary" : "ghost"} disabled={!canSubmit}>
                <span className="flex items-center gap-1">
                  <IconSend className="size-3" /> {t("wsSubmitToClient")}
                </span>
              </Btn>
            </div>
          </>
        )}
      </div>

      {/* E. Episode Activity */}
      {ep.activity.length > 0 && (
        <div className="rounded-xl bg-secondary/30 p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("wsEpisodeActivityTitle")}
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

export function EpisodeAccordion() {
  const t = useT();
  const [openEp, setOpenEp] = useState(3);
  const [globalRejectEp, setGlobalRejectEp] = useState<WorkspaceEpisode | null>(null);

  const toggle = (ep: number) => setOpenEp((prev) => (prev === ep ? 0 : ep));

  return (
    <div className="space-y-3">
      {WORKSPACE_EPISODES.map((ep) => {
        const isOpen = openEp === ep.ep;
        const statusColor = EP_STATUS_COLOR[ep.status];
        const canAct = ep.status === "In Progress";
        return (
          <div
            key={ep.ep}
            className={cn(
              "overflow-hidden rounded-xl border bg-card transition-all",
              ep.isCurrent ? "border-primary/40" : "border-border"
            )}
          >
            <div
              onClick={() => toggle(ep.ep)}
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
                        {t("wsCurrentBadge")}
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-semibold",
                        statusColor
                      )}
                    >
                      {t(EP_STATUS_KEY[ep.status])}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {ep.members > 0
                      ? `${ep.members} members · ${
                          ep.clientStatus === "Client Confirmed"
                            ? t("wsEpClientConfirmed")
                            : ep.pending > 0
                              ? `${ep.pending} ${t("wsStatPending").toLowerCase()}`
                              : t("wsEpClientNotSubmitted")
                        } · ${ep.lastUpdated}`
                      : t("wsFlow1DescEmpty")}
                  </span>
                </div>
              </div>
              <div className="ml-4 flex shrink-0 items-center gap-2">
                {canAct && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setGlobalRejectEp(ep);
                      }}
                      className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-400/20"
                    >
                      {t("wsRejectEpisodeBtn")}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      <IconSend className="size-3" /> {t("wsActionSubmitForReview")}
                    </button>
                  </>
                )}
                <span className="ml-1 text-xs text-muted-foreground">
                  {isOpen ? t("wsCollapseBtn") : t("wsExpandBtn")}
                </span>
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
      {globalRejectEp && (
        <RejectModal
          member={{ name: globalRejectEp.label, role: t("wsFullEpisodeRejection") }}
          onClose={() => setGlobalRejectEp(null)}
          onConfirm={() => setGlobalRejectEp(null)}
        />
      )}
    </div>
  );
}
