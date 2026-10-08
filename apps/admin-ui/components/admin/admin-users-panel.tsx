"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useAdminOperation } from "./use-admin-operation";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconDatabase,
  IconKey,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconUserPlus,
  IconUsersGroup,
} from "@tabler/icons-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { displayRoleName, isRetiredRoleKey } from "@/components/admin/users/permission-tree";
import { adminUiApiPath } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

// Sentinel for the shadcn Select "全部" option, since SelectItem value cannot be
// an empty string. Mapped back to "" in the Select wrapper's onValueChange.
const ALL_VALUE = "__all__";

type AdminUserStatus = "invited" | "active" | "suspended" | "disabled";
type AdminRoleKey = string;
type AssignableAdminRoleKey = string;

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string;
  status: AdminUserStatus;
  roleKeys: string[];
  roleKey: AdminRoleKey;
  requireMfa: boolean;
  mfaEnabledAt: string | null;
  lockedUntil: string | null;
  failedLoginCount: number;
  activeSessionCount: number;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
};

type AdminSessionRow = {
  id: string;
  status: "active" | "revoked" | "expired";
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type AdminUsersListData = {
  items: AdminUserRow[];
  page: number;
  pageSize: number;
  total: number;
};

export type AdminRoleOption = { value: string; label: string };

type AdminUsersPanelProps = {
  currentUserId: string;
  siteLabel: string;
  siteDomain: string;
  databaseLabel: string;
  initialData: AdminUsersListData | null;
  initialError?: string | null;
  assignableRoles?: AdminRoleOption[];
};

const statusOptions: Array<{ value: AdminUserStatus; label: string }> = [
  { value: "active", label: "启用" },
  { value: "suspended", label: "暂停" },
  { value: "disabled", label: "禁用" },
  { value: "invited", label: "待启用" },
];

const fallbackAssignableRoles: AdminRoleOption[] = [
  { value: "admin", label: "普通管理员" },
  { value: "operations", label: "运营" },
];
const protectedRoleLabels: Record<string, string> = {
  super_admin: "超级管理员",
};

const emptyData: AdminUsersListData = {
  items: [],
  page: 1,
  pageSize: 20,
  total: 0,
};

export function AdminUsersPanel({
  currentUserId,
  siteLabel,
  siteDomain,
  databaseLabel,
  initialData,
  initialError,
  assignableRoles,
}: AdminUsersPanelProps) {
  const [data, setData] = useState<AdminUsersListData>(initialData ?? emptyData);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AdminUserStatus | "">("");
  const { busy: loading, begin } = useAdminOperation();
  const sessionRead = useRef<ReturnType<typeof begin>>(null);
  const requestedQuery = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUserRow | null>(null);
  const [sessionTarget, setSessionTarget] = useState<AdminUserRow | null>(null);
  const [sessions, setSessions] = useState<AdminSessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [createForm, setCreateForm] = useState({
    email: "",
    displayName: "",
    password: "",
    roleKey: "operations" as AssignableAdminRoleKey,
    requireMfa: true,
    status: "active" as AdminUserStatus,
  });

  const metrics = useMemo(() => {
    const active = data.items.filter((item) => item.status === "active").length;
    const sessions = data.items.reduce((sum, item) => sum + item.activeSessionCount, 0);
    return { active, sessions };
  }, [data.items]);
  const currentUser = useMemo(
    () => data.items.find((item) => item.id === currentUserId) ?? null,
    [currentUserId, data.items]
  );
  const assignableRoleOptions = (
    assignableRoles?.length ? assignableRoles : fallbackAssignableRoles
  )
    .filter((option) => !isRetiredRoleKey(option.value))
    .map((option) => ({
      value: option.value,
      label: displayRoleName({ key: option.value, name: option.label }),
    }));

  const loadUsers = useCallback(
    (signal: AbortSignal) => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status) params.set("status", status);
      return requestEnvelope<AdminUsersListData>(`/api/admin/users?${params}`, { signal });
    },
    [query, status]
  );
  const queryKey = JSON.stringify([query, status]);
  const refreshUsers = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const operation = begin("read");
      if (!operation) return;
      requestedQuery.current = queryKey;
      if (!options.silent) setNotice(null);
      setError(null);
      try {
        const result = await loadUsers(operation.signal);
        if (operation.current()) setData(result);
      } catch (err) {
        if (operation.current()) setError(toErrorMessage(err));
      } finally {
        operation.finish();
      }
    },
    [begin, loadUsers, queryKey]
  );
  useEffect(() => {
    if (loading || sessionTarget || requestedQuery.current === queryKey) return;
    const timer = window.setTimeout(() => {
      void refreshUsers({ silent: true });
    }, 240);
    return () => window.clearTimeout(timer);
  }, [loading, sessionTarget, queryKey, refreshUsers]);
  const loadSessions = (userId: string, signal: AbortSignal) =>
    requestEnvelope<{ items: AdminSessionRow[] }>(`/api/admin/users/${userId}/sessions`, {
      signal,
    });
  function closeSessions() {
    if (pendingKey) return;
    sessionRead.current?.cancel();
    sessionRead.current?.finish();
    sessionRead.current = null;
    setSessionTarget(null);
    setSessions([]);
    setSessionsLoading(false);
  }

  async function createAdminUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operation = begin();
    if (!operation) return;
    setNotice(null);
    setError(null);
    setPendingKey("create");
    try {
      const created = await requestEnvelope<AdminUserRow>("/api/admin/users", {
        method: "POST",
        signal: operation.signal,
        body: JSON.stringify(createForm),
      });
      if (!operation.current()) return;
      setNotice(`已创建后台账号：${created.email}`);
      setCreateForm({
        email: "",
        displayName: "",
        password: "",
        roleKey: "operations",
        requireMfa: true,
        status: "active",
      });
      if (!operation.current()) return;
      const users = await loadUsers(operation.signal);
      if (operation.current()) setData(users);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      if (operation.current()) setPendingKey(null);
      operation.finish();
    }
  }

  async function updateUser(
    user: AdminUserRow,
    input: Partial<Pick<AdminUserRow, "status" | "displayName" | "roleKey" | "requireMfa">>
  ) {
    const operation = begin();
    if (!operation) return;
    setNotice(null);
    setError(null);
    const actionKey = `${user.id}:${Object.keys(input).join(",")}`;
    setPendingKey(actionKey);
    try {
      const updated = await requestEnvelope<AdminUserRow>(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        signal: operation.signal,
        body: JSON.stringify(input),
      });
      if (!operation.current()) return;
      setData((current) => ({
        ...current,
        items: current.items.map((item) => (item.id === updated.id ? updated : item)),
      }));
      if (!operation.current()) return;
      setNotice(`已更新 ${updated.displayName} 的账号设置。`);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      if (operation.current()) setPendingKey(null);
      operation.finish();
    }
  }

  async function revokeSessions(user: AdminUserRow) {
    const operation = begin();
    if (!operation) return;
    setNotice(null);
    setError(null);
    const actionKey = `${user.id}:revoke`;
    setPendingKey(actionKey);
    try {
      const result = await requestEnvelope<{ revokedCount: number }>(
        `/api/admin/users/${user.id}/revoke-sessions`,
        { method: "POST", signal: operation.signal }
      );
      if (!operation.current()) return;
      setNotice(`已撤销 ${result.revokedCount} 个活跃会话。`);
      if (!operation.current()) return;
      const users = await loadUsers(operation.signal);
      if (operation.current()) setData(users);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      if (operation.current()) setPendingKey(null);
      operation.finish();
    }
  }

  async function resetMfa(user: AdminUserRow) {
    const operation = begin();
    if (!operation) return;
    setNotice(null);
    setError(null);
    const actionKey = `${user.id}:reset-mfa`;
    setPendingKey(actionKey);
    try {
      const updated = await requestEnvelope<AdminUserRow>(`/api/admin/users/${user.id}/reset-mfa`, {
        method: "POST",
        signal: operation.signal,
      });
      if (!operation.current()) return;
      setData((current) => ({
        ...current,
        items: current.items.map((item) => (item.id === updated.id ? updated : item)),
      }));
      if (!operation.current()) return;
      setNotice(`已重置 ${updated.displayName} 的 MFA，账号下次登录需要重新绑定。`);
    } catch (err) {
      if (operation.current()) {
        setError(toErrorMessage(err));
        throw err;
      }
    } finally {
      if (operation.current()) setPendingKey(null);
      operation.finish();
    }
  }

  async function openSessions(user: AdminUserRow) {
    const operation = begin("read");
    if (!operation) return;
    sessionRead.current = operation;
    setSessionTarget(user);
    setSessions([]);
    setError(null);
    setSessionsLoading(true);
    try {
      const result = await loadSessions(user.id, operation.signal);
      if (operation.current()) setSessions(result.items);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      if (operation.current()) setSessionsLoading(false);
      operation.finish();
    }
  }

  async function revokeSingleSession(session: AdminSessionRow) {
    if (!sessionTarget) return;
    const operation = begin();
    if (!operation) return;
    setPendingKey(`${session.id}:revoke-session`);
    setError(null);
    try {
      const result = await requestEnvelope<{ revokedCount: number }>(
        `/api/admin/users/${sessionTarget.id}/sessions/${session.id}/revoke`,
        { method: "POST", signal: operation.signal }
      );
      if (!operation.current()) return;
      setNotice(`已撤销 ${result.revokedCount} 个会话。`);
      const sessionData = await loadSessions(sessionTarget.id, operation.signal);
      if (!operation.current()) return;
      setSessions(sessionData.items);
      if (!operation.current()) return;
      const users = await loadUsers(operation.signal);
      if (operation.current()) setData(users);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      if (operation.current()) setPendingKey(null);
      operation.finish();
    }
  }

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.length < 12) {
      setError("新密码至少需要 12 位，并包含大小写字母、数字和符号。");
      return;
    }
    if (resetPassword !== resetPasswordConfirm) {
      setError("两次输入的新密码不一致。");
      return;
    }
    const operation = begin();
    if (!operation) return;
    setNotice(null);
    setError(null);
    const actionKey = `${resetTarget.id}:reset-password`;
    setPendingKey(actionKey);
    try {
      await requestEnvelope<AdminUserRow>(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        signal: operation.signal,
        body: JSON.stringify({ password: resetPassword }),
      });
      if (!operation.current()) return;
      setNotice(`已重置 ${resetTarget.displayName} 的登录密码，并撤销旧会话。`);
      setResetTarget(null);
      setResetPassword("");
      setResetPasswordConfirm("");
      if (!operation.current()) return;
      const users = await loadUsers(operation.signal);
      if (operation.current()) setData(users);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      if (operation.current()) setPendingKey(null);
      operation.finish();
    }
  }

  const userColumns: ColumnDef<AdminUserRow, unknown>[] = [
    {
      accessorKey: "displayName",
      header: "管理员",
      cell: ({ row }) => {
        const user = row.original;
        const isSelf = user.id === currentUserId;
        return (
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-semibold text-slate-700">
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-slate-950">{user.displayName}</p>
                {isSelf ? (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                    当前账号
                  </span>
                ) : null}
              </div>
              <p className="truncate text-[12px] text-slate-500">{user.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => {
        const user = row.original;
        const isSelf = user.id === currentUserId;
        return (
          <>
            <Select
              value={user.status}
              onChange={(value) => void updateUser(user, { status: value as AdminUserStatus })}
              disabled={loading || isSelf || pendingKey === `${user.id}:status`}
              options={statusOptions}
              className="h-8 min-w-[104px]"
            />
            <StatusPill status={user.status} />
          </>
        );
      },
    },
    {
      accessorKey: "roleKey",
      header: "角色",
      cell: ({ row }) => {
        const user = row.original;
        const isSelf = user.id === currentUserId;
        const roleSelectOptions =
          user.roleKey === "super_admin"
            ? [{ value: user.roleKey, label: protectedRoleLabels[user.roleKey] ?? user.roleKey }]
            : assignableRoleOptions.some((option) => option.value === user.roleKey)
              ? assignableRoleOptions
              : [
                  ...assignableRoleOptions,
                  { value: user.roleKey, label: protectedRoleLabels[user.roleKey] ?? user.roleKey },
                ];
        return (
          <Select
            value={user.roleKey}
            onChange={(value) => void updateUser(user, { roleKey: value })}
            disabled={
              loading ||
              isSelf ||
              user.roleKey === "super_admin" ||
              pendingKey === `${user.id}:roleKey`
            }
            options={roleSelectOptions}
            className="h-8 min-w-[112px]"
          />
        );
      },
    },
    {
      id: "mfa",
      header: "MFA",
      enableSorting: false,
      cell: ({ row }) => {
        const user = row.original;
        const isSelf = user.id === currentUserId;
        return (
          <>
            <label className="flex items-center gap-2 text-[12px] text-slate-600">
              <input
                type="checkbox"
                checked={user.requireMfa}
                disabled={loading || isSelf || pendingKey === `${user.id}:requireMfa`}
                onChange={(event) => void updateUser(user, { requireMfa: event.target.checked })}
                className="size-4 rounded border-slate-300"
              />
              {user.mfaEnabledAt ? "已绑定" : user.requireMfa ? "待绑定" : "未要求"}
            </label>
            {user.lockedUntil ? (
              <p className="mt-1 text-[11px] text-amber-700">登录锁定中</p>
            ) : null}
          </>
        );
      },
    },
    {
      accessorKey: "activeSessionCount",
      header: "会话",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-left text-sm font-medium text-slate-950 hover:bg-slate-100"
            disabled={Boolean(pendingKey)}
            onClick={() => void openSessions(user)}
          >
            {user.activeSessionCount}
            <span className="ml-1 text-[12px] text-slate-500">活跃</span>
          </button>
        );
      },
    },
    {
      accessorKey: "lastLoginAt",
      header: "最近登录",
      cell: ({ row }) => {
        const user = row.original;
        return (
          <>
            <DateText value={user.lastLoginAt} />
            <p className="mt-0.5 text-[11px] text-slate-400">更新 {formatDate(user.updatedAt)}</p>
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
        const user = row.original;
        const isSelf = user.id === currentUserId;
        return (
          <div className="flex justify-end gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setResetPassword("");
                setResetPasswordConfirm("");
                setResetTarget(user);
              }}
              disabled={loading || pendingKey === `${user.id}:reset-password`}
            >
              <IconKey className="size-3.5" />
              {isSelf ? "改密码" : "重置密码"}
            </Button>
            <ConfirmDialog
              title="确认重置 MFA？"
              description={
                isSelf
                  ? "当前会话会保留，其他会话会被撤销；下次登录需要重新绑定 MFA。"
                  : `将清空 ${user.displayName} 的 MFA 绑定，该账号下次登录需要重新绑定。`
              }
              confirmLabel="确认重置"
              destructive
              onConfirm={() => resetMfa(user)}
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading || pendingKey === `${user.id}:reset-mfa`}
                >
                  MFA
                </Button>
              }
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void revokeSessions(user)}
              disabled={
                loading || user.activeSessionCount === 0 || pendingKey === `${user.id}:revoke`
              }
            >
              撤销
            </Button>
          </div>
        );
      },
    },
  ];

  const sessionColumns: ColumnDef<AdminSessionRow, unknown>[] = [
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }) => (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
          {sessionStatusLabel(row.original.status)}
        </span>
      ),
    },
    {
      accessorKey: "ipAddress",
      header: "IP",
      cell: ({ row }) => {
        const session = row.original;
        return (
          <>
            <p className="text-slate-900">{session.ipAddress ?? "-"}</p>
            <p className="max-w-[280px] truncate text-[11px] text-slate-400">
              {session.userAgent ?? "unknown"}
            </p>
          </>
        );
      },
    },
    {
      accessorKey: "lastSeenAt",
      header: "最近活跃",
      cell: ({ row }) => (
        <span className="text-slate-600">{formatDate(row.original.lastSeenAt)}</span>
      ),
    },
    {
      accessorKey: "expiresAt",
      header: "过期时间",
      cell: ({ row }) => (
        <span className="text-slate-600">{formatDate(row.original.expiresAt)}</span>
      ),
    },
    {
      id: "actions",
      header: "操作",
      enableSorting: false,
      meta: { pin: "right" },
      cell: ({ row }) => {
        const session = row.original;
        return (
          <div className="text-right">
            <Button
              variant="outline"
              size="sm"
              disabled={
                loading ||
                session.status !== "active" ||
                pendingKey === `${session.id}:revoke-session`
              }
              onClick={() => void revokeSingleSession(session)}
            >
              撤销
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<IconUsersGroup className="size-4" />}
        eyebrow="后台访问控制"
        title="账号权限"
        description={
          <>
            当前页面只管理 {siteLabel} 这一套数据库里的后台账号。国际站和中国站账号不在同一张表里，
            需要分别登录对应站点进行维护。
          </>
        }
        actions={
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 sm:min-w-[220px]">
              <div className="flex items-center gap-2">
                <IconDatabase className="size-4 text-slate-500" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                  当前数据源
                </p>
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-950">{databaseLabel}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">{siteDomain}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
              <MetricCard label="账号总数" value={data.total} />
              <MetricCard label="启用账号" value={metrics.active} />
              <MetricCard label="活跃会话" value={metrics.sessions} />
            </div>
          </div>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="border-b border-slate-200 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">管理员列表</h3>
                <p className="mt-1 text-[12px] text-slate-500">
                  按邮箱、名称和状态筛选。列表不会跨站点读取另一套数据库。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => void refreshUsers()}
                disabled={loading}
              >
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                刷新
              </Button>
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(220px,1fr)_140px]">
              <label className="relative block">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10"
                  placeholder="搜索邮箱或姓名"
                />
              </label>
              <Select
                value={status}
                onChange={(value) => setStatus(value as AdminUserStatus | "")}
                options={[{ value: "", label: "全部状态" }, ...statusOptions]}
              />
            </div>
          </div>

          <Feedback error={error} notice={notice} />

          <DataTable
            columns={userColumns}
            data={data.items}
            loading={loading}
            minWidth={920}
            pageSize={20}
            emptyLabel="没有匹配的后台账号"
            className="rounded-none border-0"
          />
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-slate-950 text-white">
                <IconShieldCheck className="size-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-950">我的安全</h3>
                <p className="text-[12px] text-slate-500">
                  密码和 MFA 只作用于当前登录的后台账号。
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Button
                className="h-9 w-full"
                type="button"
                variant="outline"
                onClick={() => {
                  if (currentUser) {
                    setResetPassword("");
                    setResetPasswordConfirm("");
                    setResetTarget(currentUser);
                  }
                }}
                disabled={loading || !currentUser}
              >
                <IconKey className="size-4" />
                修改我的密码
              </Button>
              <ConfirmDialog
                title="确认重新绑定 MFA？"
                description="当前会话会保留，其他会话会被撤销；下次登录需要重新扫描二维码完成绑定。"
                confirmLabel="确认重置"
                destructive
                onConfirm={() => {
                  if (currentUser) return resetMfa(currentUser);
                }}
                trigger={
                  <Button
                    className="h-9 w-full"
                    type="button"
                    variant="outline"
                    disabled={
                      loading || !currentUser || pendingKey === `${currentUser.id}:reset-mfa`
                    }
                  >
                    <IconShieldCheck className="size-4" />
                    重新绑定 MFA
                  </Button>
                }
              />
            </div>
            {currentUser ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
                <p className="font-medium text-slate-800">{currentUser.email}</p>
                <p>
                  MFA：
                  {currentUser.mfaEnabledAt
                    ? `已绑定，${formatDate(currentUser.mfaEnabledAt)}`
                    : currentUser.requireMfa
                      ? "待绑定"
                      : "未强制"}
                </p>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                <IconUserPlus className="size-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-950">添加管理员</h3>
                <p className="text-[12px] text-slate-500">创建到当前站点数据库。</p>
              </div>
            </div>
            <form inert={Boolean(pendingKey)} className="mt-4 space-y-3" onSubmit={createAdminUser}>
              <FieldLabel label="邮箱">
                <Input
                  required
                  type="email"
                  value={createForm.email}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, email: event.target.value }))
                  }
                  className={inputClassName}
                  placeholder="name@company.com"
                />
              </FieldLabel>
              <FieldLabel label="显示名称">
                <Input
                  required
                  value={createForm.displayName}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, displayName: event.target.value }))
                  }
                  className={inputClassName}
                  placeholder="运营负责人"
                />
              </FieldLabel>
              <FieldLabel label="初始密码">
                <Input
                  required
                  minLength={12}
                  type="password"
                  value={createForm.password}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, password: event.target.value }))
                  }
                  className={inputClassName}
                  placeholder="至少 12 位，含大小写数字符号"
                />
              </FieldLabel>
              <div className="grid gap-2">
                <FieldLabel label="角色">
                  <Select
                    value={createForm.roleKey}
                    onChange={(value) =>
                      setCreateForm((current) => ({
                        ...current,
                        roleKey: value as AssignableAdminRoleKey,
                      }))
                    }
                    options={assignableRoleOptions}
                  />
                </FieldLabel>
                <FieldLabel label="账号状态">
                  <Select
                    value={createForm.status}
                    onChange={(value) =>
                      setCreateForm((current) => ({
                        ...current,
                        status: value as AdminUserStatus,
                      }))
                    }
                    options={statusOptions}
                  />
                </FieldLabel>
              </div>
              <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
                <input
                  type="checkbox"
                  checked={createForm.requireMfa}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      requireMfa: event.target.checked,
                    }))
                  }
                  className="mt-0.5 size-4 rounded border-slate-300"
                />
                <span>要求首次登录绑定 MFA。企业后台账号默认开启。</span>
              </label>
              <Button
                className="h-9 w-full"
                type="submit"
                disabled={loading || pendingKey === "create"}
              >
                <IconUserPlus className="size-4" />
                {pendingKey === "create" ? "创建中" : "创建管理员"}
              </Button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-slate-950 p-4 text-white">
            <div className="flex items-center gap-2">
              <IconShieldCheck className="size-4 text-emerald-300" />
              <h3 className="text-sm font-semibold">生产规则</h3>
            </div>
            <ul className="mt-3 space-y-2 text-[12px] leading-5 text-slate-300">
              <li>权限只允许超级管理员、普通管理员、运营三种固定角色。</li>
              <li>超级管理员只能通过受控部署脚本开通，后台页面不能创建或授权。</li>
              <li>新账号默认要求 MFA，首次登录完成绑定后才会创建会话。</li>
              <li>创建、更新、重置密码、撤销会话都会进入后台审计。</li>
              <li>后台账号不复用普通用户登录态，避免业务侧登录污染管理侧权限。</li>
              <li>不能降低当前登录账号的角色、状态或 MFA 要求，避免把自己锁在系统外。</li>
              <li>跨站点管理需要切换登录目标站点，不在此页面混合两套数据库。</li>
            </ul>
          </section>
        </aside>
      </div>

      <Dialog
        open={resetTarget !== null}
        onOpenChange={(value) => {
          if (!value && !pendingKey) {
            setResetTarget(null);
            setResetPassword("");
            setResetPasswordConfirm("");
          }
        }}
      >
        {resetTarget ? (
          <DialogContent
            showCloseButton={false}
            className="flex max-h-[calc(100vh-2rem)] max-w-md flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 ring-0 shadow-2xl"
          >
            <DialogHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b border-slate-200 px-5 py-4">
              <div>
                <DialogTitle className="text-base font-semibold text-slate-950">
                  重置登录密码
                </DialogTitle>
                <DialogDescription className="mt-1 text-sm text-slate-600">
                  {resetTarget.id === currentUserId
                    ? "当前会话会保留，其他会话会被撤销。"
                    : `${resetTarget.displayName} 的旧会话会被撤销，需要使用新密码重新登录。`}
                </DialogDescription>
              </div>
              <DialogClose className="rounded-md px-2 py-1 text-[12px] text-slate-500 hover:bg-slate-100">
                关闭
              </DialogClose>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <form
                inert={Boolean(pendingKey)}
                id="password-reset-form"
                onSubmit={submitPasswordReset}
                className="space-y-3"
              >
                <FieldLabel label="新密码">
                  <Input
                    type="password"
                    minLength={12}
                    value={resetPassword}
                    onChange={(event) => setResetPassword(event.target.value)}
                    className={inputClassName}
                    placeholder="至少 12 位，含大小写数字符号"
                  />
                </FieldLabel>
                <FieldLabel label="确认新密码">
                  <Input
                    type="password"
                    minLength={12}
                    value={resetPasswordConfirm}
                    onChange={(event) => setResetPasswordConfirm(event.target.value)}
                    className={inputClassName}
                    placeholder="再次输入新密码"
                  />
                </FieldLabel>
              </form>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(pendingKey)}
                onClick={() => {
                  setResetTarget(null);
                  setResetPassword("");
                  setResetPasswordConfirm("");
                }}
              >
                取消
              </Button>
              <Button
                type="submit"
                form="password-reset-form"
                disabled={loading || pendingKey === `${resetTarget.id}:reset-password`}
              >
                确认重置
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog
        open={sessionTarget !== null}
        onOpenChange={(value) => {
          if (!value) closeSessions();
        }}
      >
        {sessionTarget ? (
          <DialogContent
            showCloseButton={false}
            className="flex max-h-[calc(100vh-2rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 ring-0 shadow-2xl"
          >
            <DialogHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b border-slate-200 px-5 py-4">
              <div>
                <DialogTitle className="text-base font-semibold text-slate-950">
                  会话治理
                </DialogTitle>
                <DialogDescription className="mt-1 text-sm text-slate-600">
                  {sessionTarget.displayName} 的最近 50 个后台会话。
                </DialogDescription>
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="overflow-auto rounded-lg border border-slate-200">
                <DataTable
                  columns={sessionColumns}
                  data={sessions}
                  loading={sessionsLoading}
                  minWidth={720}
                  emptyLabel="暂无会话"
                  className="rounded-none border-0"
                />
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  关闭
                </Button>
              </DialogClose>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{value}</p>
    </div>
  );
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (!error && !notice) return null;
  return (
    <div className="border-b border-slate-200 px-4 py-3">
      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <IconCircleCheck className="mt-0.5 size-4 shrink-0" />
          <span>{notice}</span>
        </div>
      ) : null}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ShadSelect
      value={value === "" ? ALL_VALUE : value}
      onValueChange={(next) => onChange(next === ALL_VALUE ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger
        className={cn(
          "h-9 w-full rounded-lg border-slate-200 bg-white px-2.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
          className
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={`${option.value || "any"}-${option.label}`}
            value={option.value === "" ? ALL_VALUE : option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </ShadSelect>
  );
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function StatusPill({ status }: { status: AdminUserStatus }) {
  const meta = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    suspended: "bg-amber-50 text-amber-700 border-amber-200",
    disabled: "bg-slate-100 text-slate-500 border-slate-200",
    invited: "bg-blue-50 text-blue-700 border-blue-200",
  }[status];
  const label = statusOptions.find((item) => item.value === status)?.label ?? status;
  return (
    <span className={cn("mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[11px]", meta)}>
      {label}
    </span>
  );
}

function sessionStatusLabel(status: AdminSessionRow["status"]) {
  if (status === "active") return "活跃";
  if (status === "revoked") return "已撤销";
  return "已过期";
}

function DateText({ value }: { value: string | null }) {
  if (!value) return <span className="text-[12px] text-slate-400">尚未登录</span>;
  return <span className="text-sm text-slate-700">{formatDate(value)}</span>;
}

const inputClassName =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10";

async function requestEnvelope<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(adminUiApiPath(url), {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    message?: string;
    issues?: Array<{ path?: string; message: string }>;
    data?: T;
  } | null;
  init.signal?.throwIfAborted();
  if (!response.ok || payload?.code !== 200) {
    const issueText = payload?.issues?.map((issue) => issue.message).join("；");
    throw new Error(
      payload?.msg ?? issueText ?? payload?.message ?? `请求失败：${response.status}`
    );
  }
  return payload.data as T;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
