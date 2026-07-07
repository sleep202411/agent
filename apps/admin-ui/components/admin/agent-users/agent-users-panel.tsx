"use client";

import { type FormEvent, useCallback, useMemo, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { IconEdit, IconPlus, IconRefresh, IconRobot, IconSearch } from "@tabler/icons-react";
import { PageHeader } from "@/components/admin/page-header";
import {
  ErrorBanner,
  Metric,
  Select,
  StatusPill,
  mutateEnvelope,
  requestEnvelope,
  toErrorMessage,
} from "@/components/admin/billing/shared";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  AdminAgentMemory,
  AdminAgentUser,
  AdminAgentUserListData,
  AdminAgentUsersInitialData,
  AgentPolicy,
  AgentRunStatus,
  AgentSchedule,
  AgentUserIdentityStatus,
  AgentUserStatus,
} from "@/lib/admin-agent-users";

type DrawerState = { mode: "create" } | { mode: "edit"; agent: AdminAgentUser };

type StatusFilter = "" | AgentUserStatus;
type IdentityFilter = "" | AgentUserIdentityStatus;

const EMPTY_LIST: AdminAgentUserListData = {
  items: [],
  page: 1,
  pageSize: 50,
  total: 0,
  stats: {
    activeCount: 0,
    pausedCount: 0,
    disabledCount: 0,
    shadowCount: 0,
    boundCount: 0,
  },
};

const DRAWER_STYLE = {
  width: "min(980px, calc(100vw - 64px))",
  maxWidth: "min(980px, calc(100vw - 64px))",
};

const ACTIVE_DAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];

export function AgentUsersPanel({
  siteLabel,
  databaseLabel,
  initialData,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminAgentUsersInitialData;
}) {
  const [list, setList] = useState<AdminAgentUserListData>(initialData.list ?? EMPTY_LIST);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [identityFilter, setIdentityFilter] = useState<IdentityFilter>("");
  const [loading, setLoading] = useState(false);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialData.error);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const openEdit = useCallback(async (agent: AdminAgentUser) => {
    setDrawer({ mode: "edit", agent });
    setLoadingDetailId(agent.id);
    setError(null);
    try {
      const detail = await requestEnvelope<AdminAgentUser>(`/api/admin/agent-users/${agent.id}`);
      setDrawer((current) =>
        current?.mode === "edit" && current.agent.id === agent.id
          ? { mode: "edit", agent: detail }
          : current
      );
    } catch (detailError) {
      setError(toErrorMessage(detailError));
    } finally {
      setLoadingDetailId(null);
    }
  }, []);

  const columns = useMemo<ColumnDef<AdminAgentUser, unknown>[]>(
    () => [
      {
        accessorKey: "displayName",
        header: "Agent",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
                <IconRobot className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-950">{row.original.displayName}</p>
                <p className="truncate font-mono text-[11px] text-slate-500">
                  @{row.original.handle}
                </p>
              </div>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => <AgentStatusPill status={row.original.status} />,
      },
      {
        accessorKey: "identityStatus",
        header: "身份",
        cell: ({ row }) => (
          <div className="space-y-1">
            <IdentityStatusPill status={row.original.identityStatus} />
            {row.original.platformUserId ? (
              <p className="font-mono text-[11px] text-slate-500">{row.original.platformUserId}</p>
            ) : null}
          </div>
        ),
      },
      {
        id: "locale",
        header: "区域",
        cell: ({ row }) => (
          <div className="text-[12px] leading-5">
            <p className="font-medium text-slate-700">{row.original.locale}</p>
            <p className="text-slate-500">
              {[row.original.region, row.original.timezone].filter(Boolean).join(" · ")}
            </p>
          </div>
        ),
      },
      {
        id: "persona",
        header: "性格 / 兴趣",
        cell: ({ row }) => (
          <div className="max-w-[260px] text-[12px] leading-5 text-slate-600">
            <p className="line-clamp-2 text-slate-700">{personaSummary(row.original.persona)}</p>
            <p className="truncate text-slate-500">{interestsSummary(row.original.persona)}</p>
          </div>
        ),
      },
      {
        id: "schedule",
        header: "作息",
        cell: ({ row }) => (
          <div className="text-[12px] leading-5 text-slate-600">
            <p className="font-medium text-slate-700">{scheduleWindow(row.original.schedule)}</p>
            <p className="text-slate-500">{scheduleBudget(row.original.schedule)}</p>
          </div>
        ),
      },
      {
        id: "policy",
        header: "行为策略",
        cell: ({ row }) => (
          <div className="max-w-[220px] text-[12px] leading-5 text-slate-600">
            <p className="truncate">{capabilitiesSummary(row.original.policy)}</p>
            <p className="text-slate-500">{limitsSummary(row.original.policy)}</p>
          </div>
        ),
      },
      {
        id: "runs",
        header: "运行",
        cell: ({ row }) => (
          <div className="text-[12px] leading-5">
            <p className="font-medium text-slate-700">
              {row.original.runCount} runs · {row.original.actionCount} actions
            </p>
            <p className="text-slate-500">
              {row.original.latestRun ? (
                <RunStatusPill status={row.original.latestRun.status} />
              ) : (
                "尚未运行"
              )}
            </p>
          </div>
        ),
      },
      {
        id: "memories",
        header: "记忆",
        cell: ({ row }) => (
          <div className="text-[12px] leading-5">
            <p className="font-medium text-slate-700">{row.original.memoryCount} 条</p>
            <p className="text-slate-500">长期偏好 / 关系 / 摘要</p>
          </div>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "更新",
        cell: ({ row }) => (
          <div className="text-[12px] leading-5 text-slate-600">
            <p>{formatDate(row.original.updatedAt)}</p>
            <p className="text-slate-500">last run {formatDate(row.original.lastRunAt)}</p>
          </div>
        ),
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
            disabled={loadingDetailId === row.original.id}
            onClick={() => void openEdit(row.original)}
          >
            <IconEdit className="size-3.5" />
            {loadingDetailId === row.original.id ? "加载" : "编辑"}
          </Button>
        ),
      },
    ],
    [loadingDetailId, openEdit]
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (q.trim()) params.set("q", q.trim());
      if (statusFilter) params.set("status", statusFilter);
      if (identityFilter) params.set("identityStatus", identityFilter);
      const data = await requestEnvelope<AdminAgentUserListData>(
        `/api/admin/agent-users?${params.toString()}`
      );
      setList(data);
    } catch (refreshError) {
      setError(toErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }

  async function submitAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!drawer) return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const payload = buildAgentPayload(form, drawer.mode);
      const url =
        drawer.mode === "edit"
          ? `/api/admin/agent-users/${drawer.agent.id}`
          : "/api/admin/agent-users";
      await mutateEnvelope<AdminAgentUser>(url, payload, drawer.mode === "edit" ? "PATCH" : "POST");
      setDrawer(null);
      await refresh();
    } catch (submitError) {
      setError(toErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="Agent用户"
        description="管理 AI Agent 的影子身份、性格、作息、行为策略和运行审计。"
        icon={<IconRobot className="size-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={refresh} disabled={loading}>
              <IconRefresh className={cn("size-4", loading && "animate-spin")} />
              刷新
            </Button>
            <Button type="button" onClick={() => setDrawer({ mode: "create" })}>
              <IconPlus className="size-4" />
              新建Agent
            </Button>
          </div>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-3 md:grid-cols-5">
        <Metric label="Active" value={list.stats.activeCount} />
        <Metric label="Paused" value={list.stats.pausedCount} />
        <Metric label="Disabled" value={list.stats.disabledCount} tone="risk" />
        <Metric label="Shadow" value={list.stats.shadowCount} />
        <Metric label="Bound" value={list.stats.boundCount} />
      </div>

      <form
        className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 lg:flex-row lg:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          void refresh();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <IconSearch className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="pl-8"
            placeholder="搜索 handle、名称、邮箱、platformUserId"
          />
        </div>
        <div className="w-full lg:w-[160px]">
          <Select value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)}>
            <option value="">全部状态</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="disabled">Disabled</option>
          </Select>
        </div>
        <div className="w-full lg:w-[160px]">
          <Select
            value={identityFilter}
            onChange={(value) => setIdentityFilter(value as IdentityFilter)}
          >
            <option value="">全部身份</option>
            <option value="shadow">Shadow</option>
            <option value="bound">Bound</option>
          </Select>
        </div>
        <Button type="submit" disabled={loading}>
          <IconSearch className="size-4" />
          查询
        </Button>
      </form>

      <DataTable
        columns={columns}
        data={list.items}
        loading={loading}
        emptyLabel="暂无 Agent 用户"
        minWidth={1420}
      />

      <Sheet
        open={drawer !== null}
        onOpenChange={(open) => {
          if (!open) setDrawer(null);
        }}
      >
        <SheetContent
          className="w-full !max-w-none gap-0 overflow-hidden bg-white p-0 sm:!max-w-none"
          style={DRAWER_STYLE}
        >
          {drawer ? (
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={submitAgent}>
              <SheetHeader className="border-b border-slate-200 px-5 py-4">
                <SheetTitle>{drawer.mode === "edit" ? "编辑 Agent" : "新建 Agent"}</SheetTitle>
                <SheetDescription>
                  {drawer.mode === "edit"
                    ? drawer.agent.handle
                    : "创建 Nest 自有的 shadow Agent 身份。"}
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                <AgentUserFormFields drawer={drawer} />
              </div>
              <SheetFooter className="flex-row justify-end border-t border-slate-200 bg-slate-50 px-5 py-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDrawer(null)}
                  disabled={saving}
                >
                  取消
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "保存中…" : "保存"}
                </Button>
              </SheetFooter>
            </form>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AgentUserFormFields({ drawer }: { drawer: DrawerState }) {
  const agent = drawer.mode === "edit" ? drawer.agent : null;
  const persona = agent?.persona ?? {};
  const schedule = agent?.schedule ?? {};
  const policy = agent?.policy ?? {};
  const capabilities = policy.capabilities ?? {};
  const limits = policy.limits ?? {};
  const safety = policy.safety ?? {};
  const activeDays = Array.isArray(schedule.activeDays) ? schedule.activeDays : [1, 2, 3, 4, 5];

  return (
    <div className="space-y-6">
      <FormSection title="身份">
        <div className="grid gap-3 md:grid-cols-2">
          {drawer.mode === "create" ? (
            <Field label="Handle">
              <Input name="handle" required placeholder="agent_mira_01" />
            </Field>
          ) : null}
          <Field label="显示名称">
            <Input name="displayName" required defaultValue={agent?.displayName ?? ""} />
          </Field>
          <Field label="状态">
            <Select name="status" defaultValue={agent?.status ?? "active"}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="disabled">Disabled</option>
            </Select>
          </Field>
          <Field label="身份状态">
            <Select name="identityStatus" defaultValue={agent?.identityStatus ?? "shadow"}>
              <option value="shadow">Shadow</option>
              <option value="bound">Bound</option>
            </Select>
          </Field>
          <Field label="Platform User ID">
            <Input name="platformUserId" defaultValue={agent?.platformUserId ?? ""} />
          </Field>
          <Field label="模拟邮箱">
            <Input name="simulatedEmail" type="email" defaultValue={agent?.simulatedEmail ?? ""} />
          </Field>
          <Field label="头像 URL">
            <Input name="avatarUrl" type="url" defaultValue={agent?.avatarUrl ?? ""} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="区域">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Locale">
            <Input name="locale" required defaultValue={agent?.locale ?? "zh-CN"} />
          </Field>
          <Field label="Region">
            <Input name="region" defaultValue={agent?.region ?? "CN"} />
          </Field>
          <Field label="Timezone">
            <Input name="timezone" required defaultValue={agent?.timezone ?? "Asia/Shanghai"} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="性格">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="性格描述">
            <Textarea
              name="personality"
              rows={3}
              defaultValue={stringValue(persona.personality)}
              placeholder="Curious, patient, prefers character-driven animation IP."
            />
          </Field>
          <Field label="兴趣标签">
            <Textarea
              name="interests"
              rows={3}
              defaultValue={arrayValue(persona.interests).join(", ")}
              placeholder="fantasy, animation, short drama"
            />
          </Field>
          <Field label="表达风格">
            <Select
              name="communicationStyle"
              defaultValue={stringValue(persona.communicationStyle, "concise")}
            >
              <option value="concise">Concise</option>
              <option value="warm">Warm</option>
              <option value="analytical">Analytical</option>
              <option value="playful">Playful</option>
            </Select>
          </Field>
          <Field label="决策偏好">
            <Select
              name="decisionBias"
              defaultValue={stringValue(persona.decisionBias, "balanced")}
            >
              <option value="balanced">Balanced</option>
              <option value="explore_novelty">Explore novelty</option>
              <option value="follow_popular">Follow popular</option>
              <option value="niche_taste">Niche taste</option>
            </Select>
          </Field>
        </div>
      </FormSection>

      <FormSection title="作息">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="模式">
            <Select name="scheduleMode" defaultValue={stringValue(schedule.mode, "scheduled")}>
              <option value="scheduled">Scheduled</option>
              <option value="manual">Manual</option>
            </Select>
          </Field>
          <Field label="开始">
            <Input
              name="activeStart"
              type="time"
              required
              defaultValue={stringValue(schedule.activeWindow?.start, "09:00")}
            />
          </Field>
          <Field label="结束">
            <Input
              name="activeEnd"
              type="time"
              required
              defaultValue={stringValue(schedule.activeWindow?.end, "23:00")}
            />
          </Field>
          <Field label="日动作预算">
            <Input
              name="dailyActionBudget"
              type="number"
              min={1}
              max={500}
              defaultValue={numberValue(schedule.dailyActionBudget, 30)}
            />
          </Field>
          <Field label="小时动作预算">
            <Input
              name="hourlyActionBudget"
              type="number"
              min={1}
              max={100}
              defaultValue={numberValue(schedule.hourlyActionBudget, 6)}
            />
          </Field>
          <Field label="随机抖动分钟">
            <Input
              name="jitterMinutes"
              type="number"
              min={0}
              max={240}
              defaultValue={numberValue(schedule.jitterMinutes, 45)}
            />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {ACTIVE_DAYS.map((day) => (
            <label
              key={day.value}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] text-slate-700"
            >
              <input
                type="checkbox"
                name="activeDays"
                value={day.value}
                defaultChecked={activeDays.includes(day.value)}
                className="size-3.5 accent-slate-950"
              />
              {day.label}
            </label>
          ))}
        </div>
      </FormSection>

      <FormSection title="行为策略">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="mb-2 text-[12px] font-medium text-slate-600">能力开关</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <CheckboxField
                name="canViewIp"
                label="浏览 IP"
                checked={capabilities.viewIp ?? true}
              />
              <CheckboxField
                name="canLikeIp"
                label="点赞 IP"
                checked={capabilities.likeIp ?? true}
              />
              <CheckboxField
                name="canCollectIp"
                label="收藏 IP"
                checked={capabilities.collectIp ?? false}
              />
              <CheckboxField
                name="canComment"
                label="评论"
                checked={capabilities.comment ?? false}
              />
              <CheckboxField
                name="canCreateContent"
                label="创作内容"
                checked={capabilities.createContent ?? false}
              />
              <CheckboxField
                name="requireHumanApprovalForCreation"
                label="创作需审核"
                checked={safety.requireHumanApprovalForCreation ?? true}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="每日浏览上限">
              <Input
                name="viewsPerDay"
                type="number"
                min={0}
                max={1000}
                defaultValue={numberValue(limits.viewsPerDay, 20)}
              />
            </Field>
            <Field label="每日点赞上限">
              <Input
                name="likesPerDay"
                type="number"
                min={0}
                max={1000}
                defaultValue={numberValue(limits.likesPerDay, 8)}
              />
            </Field>
            <Field label="每日评论上限">
              <Input
                name="commentsPerDay"
                type="number"
                min={0}
                max={200}
                defaultValue={numberValue(limits.commentsPerDay, 0)}
              />
            </Field>
            <Field label="每日创作上限">
              <Input
                name="creationsPerDay"
                type="number"
                min={0}
                max={50}
                defaultValue={numberValue(limits.creationsPerDay, 0)}
              />
            </Field>
          </div>
        </div>
      </FormSection>

      {agent ? <MemoryPreview agent={agent} /> : null}

      <FormSection title="备注">
        <Textarea name="notes" rows={3} defaultValue={agent?.notes ?? ""} />
      </FormSection>
    </div>
  );
}

function buildAgentPayload(form: FormData, mode: "create" | "edit"): Record<string, unknown> {
  const activeDays = form
    .getAll("activeDays")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
  const persona = {
    personality: text(form, "personality"),
    interests: text(form, "interests")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    communicationStyle: text(form, "communicationStyle", "concise"),
    decisionBias: text(form, "decisionBias", "balanced"),
  };
  const schedule: AgentSchedule = {
    mode: text(form, "scheduleMode", "scheduled") as "scheduled" | "manual",
    activeDays,
    activeWindow: {
      start: text(form, "activeStart", "09:00"),
      end: text(form, "activeEnd", "23:00"),
    },
    jitterMinutes: numberFromForm(form, "jitterMinutes", 45),
    dailyActionBudget: numberFromForm(form, "dailyActionBudget", 30),
    hourlyActionBudget: numberFromForm(form, "hourlyActionBudget", 6),
  };
  const policy: AgentPolicy = {
    capabilities: {
      viewIp: checked(form, "canViewIp"),
      likeIp: checked(form, "canLikeIp"),
      collectIp: checked(form, "canCollectIp"),
      comment: checked(form, "canComment"),
      createContent: checked(form, "canCreateContent"),
    },
    limits: {
      viewsPerDay: numberFromForm(form, "viewsPerDay", 20),
      likesPerDay: numberFromForm(form, "likesPerDay", 8),
      commentsPerDay: numberFromForm(form, "commentsPerDay", 0),
      creationsPerDay: numberFromForm(form, "creationsPerDay", 0),
    },
    safety: {
      requireHumanApprovalForCreation: checked(form, "requireHumanApprovalForCreation"),
    },
  };
  const payload: Record<string, unknown> = {
    displayName: text(form, "displayName"),
    avatarUrl: nullableText(form, "avatarUrl"),
    status: text(form, "status", "active"),
    identityStatus: text(form, "identityStatus", "shadow"),
    platformUserId: nullableText(form, "platformUserId"),
    simulatedEmail: nullableText(form, "simulatedEmail"),
    locale: text(form, "locale", "zh-CN"),
    region: nullableText(form, "region"),
    timezone: text(form, "timezone", "Asia/Shanghai"),
    persona,
    schedule,
    policy,
    notes: nullableText(form, "notes"),
  };
  if (mode === "create") payload.handle = text(form, "handle");
  return payload;
}

function AgentStatusPill({ status }: { status: AgentUserStatus }) {
  const tone = status === "active" ? "success" : status === "disabled" ? "risk" : "muted";
  return <StatusPill tone={tone}>{status}</StatusPill>;
}

function IdentityStatusPill({ status }: { status: AgentUserIdentityStatus }) {
  return <StatusPill tone={status === "bound" ? "success" : "muted"}>{status}</StatusPill>;
}

function RunStatusPill({ status }: { status: AgentRunStatus }) {
  const tone = status === "succeeded" ? "success" : status === "failed" ? "risk" : "muted";
  return <StatusPill tone={tone}>{status}</StatusPill>;
}

function MemoryStatusPill({ status }: { status: AdminAgentMemory["status"] }) {
  return <StatusPill tone={status === "active" ? "success" : "muted"}>{status}</StatusPill>;
}

function MemoryPreview({ agent }: { agent: AdminAgentUser }) {
  const memories = agent.recentMemories ?? [];
  return (
    <FormSection title={`长期记忆 (${agent.memoryCount})`}>
      {memories.length ? (
        <div className="grid gap-2">
          {memories.map((memory) => (
            <div key={memory.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200">
                  {memoryTypeLabel(memory.type)}
                </span>
                <MemoryStatusPill status={memory.status} />
                <span className="text-[11px] text-slate-500">
                  confidence {memory.confidence} · weight {memory.weight}
                </span>
              </div>
              <p className="line-clamp-2 text-[13px] leading-5 text-slate-800">{memory.summary}</p>
              <p className="mt-1 truncate text-[11px] text-slate-500">
                {[memory.scopeType, memory.scopeId, memory.memoryKey].filter(Boolean).join(" · ") ||
                  "global"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-[13px] text-slate-500">
          暂无长期记忆
        </div>
      )}
    </FormSection>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-3 text-sm font-semibold text-slate-950">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function CheckboxField({
  name,
  label,
  checked,
}: {
  name: string;
  label: string;
  checked: boolean;
}) {
  return (
    <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        className="size-3.5 accent-slate-950"
      />
      {label}
    </label>
  );
}

function personaSummary(persona: AdminAgentUser["persona"]) {
  return stringValue(persona.personality, "未设置性格描述");
}

function interestsSummary(persona: AdminAgentUser["persona"]) {
  const interests = arrayValue(persona.interests);
  return interests.length ? interests.join(", ") : "未设置兴趣标签";
}

function scheduleWindow(schedule: AgentSchedule) {
  const start = stringValue(schedule.activeWindow?.start, "09:00");
  const end = stringValue(schedule.activeWindow?.end, "23:00");
  return `${start}-${end} · ${stringValue(schedule.mode, "scheduled")}`;
}

function scheduleBudget(schedule: AgentSchedule) {
  return `${numberValue(schedule.dailyActionBudget, 30)}/day · ${numberValue(
    schedule.hourlyActionBudget,
    6
  )}/hour`;
}

function capabilitiesSummary(policy: AgentPolicy) {
  const capabilities = policy.capabilities ?? {};
  const labels = [
    capabilities.viewIp ? "浏览" : null,
    capabilities.likeIp ? "点赞" : null,
    capabilities.collectIp ? "收藏" : null,
    capabilities.comment ? "评论" : null,
    capabilities.createContent ? "创作" : null,
  ].filter(Boolean);
  return labels.length ? labels.join(" / ") : "无可执行能力";
}

function limitsSummary(policy: AgentPolicy) {
  const limits = policy.limits ?? {};
  return `view ${numberValue(limits.viewsPerDay, 20)} · like ${numberValue(limits.likesPerDay, 8)}`;
}

function memoryTypeLabel(type: AdminAgentMemory["type"]) {
  return (
    {
      preference: "偏好",
      content_affinity: "内容倾向",
      negative_signal: "负反馈",
      relationship: "关系",
      summary: "摘要",
      fact: "事实",
    } satisfies Record<AdminAgentMemory["type"], string>
  )[type];
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function text(form: FormData, key: string, fallback = "") {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableText(form: FormData, key: string) {
  const value = text(form, key);
  return value || null;
}

function checked(form: FormData, key: string) {
  return form.get(key) === "on";
}

function numberFromForm(form: FormData, key: string, fallback: number) {
  const value = Number(text(form, key));
  return Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function arrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}
