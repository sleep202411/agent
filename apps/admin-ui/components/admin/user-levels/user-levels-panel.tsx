"use client";

import { useMemo, useRef, useState } from "react";
import { readAllPages } from "./read-all-pages";
import { useAdminOperation } from "../use-admin-operation";
import { decodeUserId, encodeUserId } from "@repo/shared/user-id-codec";
import { IconBadge, IconEdit, IconPlus, IconSearch, IconTrash, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  AdminDialog,
  ErrorBanner,
  FormLabel,
  PageHeader,
  TextInput,
  formatDate,
  requestEnvelope,
  toErrorMessage,
} from "@/components/admin/billing/shared";
import { adminUiApiPath } from "@/lib/admin-api";
import type {
  AdminUserLevelDefinition,
  AdminUserLevelListResult,
  AdminUserLevelRelation,
} from "@/lib/admin-user-levels";

type AdminApiPayload<T> = {
  code?: number;
  msg?: string;
  message?: string;
  data?: T;
};

async function mutateUserLevels<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(adminUiApiPath(url), { cache: "no-store", ...init });
  const payload = (await response.json().catch(() => null)) as AdminApiPayload<T> | null;
  init?.signal?.throwIfAborted();
  if (!response.ok || payload?.code !== 200) {
    throw new Error(payload?.msg ?? payload?.message ?? `请求失败：${response.status}`);
  }
  return payload.data as T;
}

/** legacy-points searchMembers row — userId is encoded public id. */
type MemberHit = {
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
};

/** Resolved user for Java user-levels — raw numeric id. */
type ResolvedUser = {
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
};

type Draft = {
  levelId: string;
  remark: string;
};

const EMPTY_DRAFT: Draft = { levelId: "", remark: "" };

function toResolved(hit: MemberHit): ResolvedUser {
  return {
    userId: decodeUserId(hit.userId),
    phone: hit.phone,
    email: hit.email,
    nickName: hit.nickName,
  };
}

function publicUserId(rawOrEncoded: string | number): string {
  return encodeUserId(rawOrEncoded);
}

function userLine(user: {
  nickName: string | null;
  phone: string | null;
  email: string | null;
  userId: string;
}) {
  const contact = [user.phone, user.email].filter(Boolean).join(" · ");
  return [user.nickName || "（昵称未知）", contact || `ID ${publicUserId(user.userId)}`]
    .filter(Boolean)
    .join(" · ");
}

export async function searchMembers(query: string, signal: AbortSignal): Promise<MemberHit[]> {
  const params = new URLSearchParams({ query });
  return readAllPages<MemberHit>(
    `/api/admin/legacy-points/users?${params}`,
    signal,
    (hit) => hit.userId
  );
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase();
}

/**
 * Resolve member-directory hits into the user set we should filter levels by.
 * Nickname searches often return several LIKE matches — keep them all so we
 * can union relations, instead of failing with "匹配到多个用户".
 */
function resolveSearchHits(query: string, hits: MemberHit[]): MemberHit[] {
  if (hits.length === 0) return [];
  if (hits.length === 1) return hits;

  const q = query.trim();
  const qNorm = normalizeText(q);
  const decoded = decodeUserId(q);

  const exactIdOrContact = hits.filter(
    (hit) =>
      hit.phone === q ||
      hit.email === q ||
      hit.userId === q ||
      decodeUserId(hit.userId) === q ||
      (decoded !== q && decodeUserId(hit.userId) === decoded)
  );
  if (exactIdOrContact.length > 0) return exactIdOrContact;

  const exactNick = hits.filter((hit) => normalizeText(hit.nickName) === qNorm);
  if (exactNick.length > 0) return exactNick;

  // Fuzzy nickname / partial match — use every hit.
  return hits;
}

export async function fetchRelationsForUserIds(
  userIds: string[],
  levelId: string,
  signal: AbortSignal
): Promise<AdminUserLevelRelation[]> {
  const unique = [...new Set(userIds.map((id) => decodeUserId(id)).filter(Boolean))];
  const byId = new Map<number, AdminUserLevelRelation>();
  // Walk users sequentially rather than launching an unbounded request fan-out.
  for (const userId of unique) {
    signal.throwIfAborted();
    const params = new URLSearchParams({ userId });
    if (levelId !== "all") params.set("levelId", levelId);
    const rows = await readAllPages<AdminUserLevelRelation>(
      `/api/admin/user-levels?${params}`,
      signal,
      (row) => row.id
    );
    for (const row of rows) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => {
    const at = a.updateTime ?? a.createTime ?? "";
    const bt = b.updateTime ?? b.createTime ?? "";
    return bt.localeCompare(at) || b.id - a.id;
  });
}

export function UserLevelsPanel({
  siteLabel,
  databaseLabel,
  initialList,
  initialLevels,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialList: AdminUserLevelListResult | null;
  initialLevels: AdminUserLevelDefinition[];
  initialError: string | null;
}) {
  const pageSize = initialList?.pageSize ?? 20;

  const [items, setItems] = useState<AdminUserLevelRelation[]>(initialList?.items ?? []);
  const [total, setTotal] = useState(initialList?.total ?? 0);
  const [page, setPage] = useState(initialList?.page ?? 1);
  const [levels] = useState<AdminUserLevelDefinition[]>(initialLevels);
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const { busy: loading, begin } = useAdminOperation();
  const pending = useRef<ReturnType<typeof begin>>(null);
  const pendingPurpose = useRef<"read" | "lookup" | "write">("read");
  const dialogActive = useRef(false);
  const [purpose, setPurpose] = useState<"read" | "lookup" | "write">("read");
  const lookingUp = loading && purpose === "lookup";
  const saving = loading && purpose === "write";
  const [error, setError] = useState<string | null>(initialError);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingUserLabel, setEditingUserLabel] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupHits, setLookupHits] = useState<MemberHit[]>([]);
  const [resolvedUser, setResolvedUser] = useState<ResolvedUser | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<AdminUserLevelRelation | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const levelOptions = useMemo(() => [...levels].sort((a, b) => a.id - b.id), [levels]);

  type Operation = NonNullable<ReturnType<typeof begin>>;
  type ListOptions = { page?: number; query?: string; levelId?: string };
  function start(kind: "read" | "lookup" | "write") {
    const operation = begin(kind === "read" ? "read" : "write");
    if (!operation) return null;
    pending.current = operation;
    pendingPurpose.current = kind;
    setPurpose(kind);
    return operation;
  }
  function finish(operation: Operation) {
    if (pending.current === operation) pending.current = null;
    operation.cancel();
    operation.finish();
  }
  function closeDialog() {
    dialogActive.current = false;
    pending.current?.cancel();
    pending.current?.finish();
    pending.current = null;
    setDialogOpen(false);
  }
  async function readList(operation: Operation, opts: ListOptions = {}) {
    const targetPage = opts.page ?? page;
    const query = (opts.query ?? activeQuery).trim();
    const levelId = opts.levelId ?? levelFilter;

    if (query) {
      const hits = await searchMembers(query, operation.signal);
      if (!operation.current()) return;
      const matched = resolveSearchHits(query, hits);
      if (matched.length === 0) {
        setItems([]);
        setTotal(0);
        setPage(1);
        setError("未找到匹配的用户。");
        return;
      }

      if (matched.length === 1) {
        const params = new URLSearchParams();
        params.set("page", String(targetPage));
        params.set("pageSize", String(pageSize));
        if (levelId !== "all") params.set("levelId", levelId);
        params.set("userId", decodeUserId(matched[0].userId));
        const data = await requestEnvelope<AdminUserLevelListResult>(
          `/api/admin/user-levels?${params.toString()}`,
          operation.signal
        );
        if (!operation.current()) return;
        setItems(data.items);
        setTotal(data.total);
        setPage(data.page);
        return;
      }

      // Nickname / fuzzy: several users matched → union their level rows.
      const merged = await fetchRelationsForUserIds(
        matched.map((hit) => hit.userId),
        levelId,
        operation.signal
      );
      if (!operation.current()) return;
      const totalMerged = merged.length;
      const safePage = Math.min(
        Math.max(1, targetPage),
        Math.max(1, Math.ceil(totalMerged / pageSize) || 1)
      );
      const start = (safePage - 1) * pageSize;
      setItems(merged.slice(start, start + pageSize));
      setTotal(totalMerged);
      setPage(safePage);
      return;
    }

    const params = new URLSearchParams();
    params.set("page", String(targetPage));
    params.set("pageSize", String(pageSize));
    if (levelId !== "all") params.set("levelId", levelId);
    const data = await requestEnvelope<AdminUserLevelListResult>(
      `/api/admin/user-levels?${params.toString()}`,
      operation.signal
    );
    if (!operation.current()) return;
    setItems(data.items);
    setTotal(data.total);
    setPage(data.page);
  }
  async function loadList(opts: ListOptions = {}) {
    const operation = start("read");
    if (!operation) return;
    setError(null);
    try {
      await readList(operation, opts);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      finish(operation);
    }
  }

  function runSearch() {
    if (loading || pending.current) return;
    const next = queryInput.trim();
    setActiveQuery(next);
    void loadList({ page: 1, query: next });
  }

  function openCreate() {
    if (loading || pending.current) return;
    setMode("create");
    setEditingId(null);
    setEditingUserLabel("");
    setDraft({
      ...EMPTY_DRAFT,
      levelId: levelOptions[0] ? String(levelOptions[0].id) : "",
    });
    setLookupQuery("");
    setLookupHits([]);
    setResolvedUser(null);
    setFormError(null);
    dialogActive.current = true;
    setDialogOpen(true);
  }

  function openEdit(row: AdminUserLevelRelation) {
    if (loading || pending.current) return;
    setMode("edit");
    setEditingId(row.id);
    setEditingUserLabel(
      [row.userName, `ID ${publicUserId(row.userId)}`].filter(Boolean).join(" · ")
    );
    setDraft({
      levelId: String(row.levelId),
      remark: row.remark ?? "",
    });
    setLookupQuery("");
    setLookupHits([]);
    setResolvedUser(null);
    setFormError(null);
    dialogActive.current = true;
    setDialogOpen(true);
  }

  async function runDialogLookup() {
    const q = lookupQuery.trim();
    if (!q || !dialogActive.current || mode !== "create") return;
    const operation = start("lookup");
    if (!operation) return;
    setFormError(null);
    try {
      const hits = await searchMembers(q, operation.signal);
      if (!operation.current()) return;
      const matched = resolveSearchHits(q, hits);
      setResolvedUser(matched.length === 1 ? toResolved(matched[0]) : null);
      setLookupHits(matched.length === 1 ? [] : matched);
      if (!matched.length) setFormError("No matching users.");
    } catch (err) {
      if (operation.current()) setFormError(toErrorMessage(err));
    } finally {
      finish(operation);
    }
  }
  async function handleSave() {
    if (!dialogActive.current) return;
    const operation = start("write");
    if (!operation) return;
    setFormError(null);
    setError(null);
    let accepted = false;
    try {
      const levelId = Number(draft.levelId);
      if (!Number.isSafeInteger(levelId) || levelId <= 0) throw new Error("Select a valid level.");
      const body: { levelId: number; remark?: string; userId?: number; id?: number } = {
        levelId,
        remark: draft.remark.trim() || undefined,
      };
      if (mode === "create") {
        const userId = Number(resolvedUser?.userId);
        if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Select a valid user.");
        body.userId = userId;
      } else {
        if (editingId === null) throw new Error("Select a level relation.");
        body.id = editingId;
      }
      await mutateUserLevels("/api/admin/user-levels", {
        method: "POST",
        signal: operation.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!operation.current()) return;
      accepted = true;
      dialogActive.current = false;
      setDialogOpen(false);
      await readList(operation, { page: mode === "create" ? 1 : page });
    } catch (err) {
      if (operation.current()) {
        if (accepted) setError(toErrorMessage(err));
        else setFormError(toErrorMessage(err));
      }
    } finally {
      finish(operation);
    }
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    const operation = start("write");
    if (!operation) return;
    setError(null);
    let accepted = false;
    try {
      await mutateUserLevels(`/api/admin/user-levels?id=${deleteTarget.id}`, {
        method: "DELETE",
        signal: operation.signal,
      });
      if (!operation.current()) return;
      accepted = true;
      setDeleteTarget(null);
      await readList(operation, { page: items.length === 1 && page > 1 ? page - 1 : page });
    } catch (err) {
      if (operation.current()) {
        setError(toErrorMessage(err));
        if (!accepted) throw err;
      }
    } finally {
      finish(operation);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        icon={<IconBadge className="size-4" />}
        title="认证等级"
        description="按手机号 / 邮箱 / 昵称 / ID 查找用户，管理其 FD 等认证等级关联。"
      />

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
          <div className="min-w-[220px] max-w-md flex-1">
            <TextInput
              disabled={loading}
              value={queryInput}
              placeholder="手机号 / 邮箱 / 昵称 / ID"
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
            />
          </div>
          <select
            disabled={loading}
            value={levelFilter}
            onChange={(event) => {
              const next = event.target.value;
              setLevelFilter(next);
              void loadList({ page: 1, levelId: next });
            }}
            className="h-9 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 outline-none focus:border-slate-400"
          >
            <option value="all">全部等级</option>
            {levelOptions.map((level) => (
              <option key={level.id} value={String(level.id)}>
                {level.name}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" disabled={loading} onClick={runSearch}>
            <IconSearch className="size-4" />
            {loading ? "查询中" : "搜索"}
          </Button>
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            onClick={openCreate}
            disabled={loading || levelOptions.length === 0}
          >
            <IconPlus className="size-4" />
            授予等级
          </Button>
        </div>

        {error ? (
          <div className="p-4">
            <ErrorBanner message={error} />
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[12px] text-slate-500">
                <th className="px-4 py-2 font-medium">用户</th>
                <th className="px-4 py-2 font-medium">等级</th>
                <th className="px-4 py-2 font-medium">备注</th>
                <th className="px-4 py-2 font-medium">更新时间</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-slate-400">
                    {loading ? "加载中…" : "暂无关联记录"}
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2.5 text-slate-900">
                      {row.userName || "—"}
                      <span className="ml-1 text-[11px] text-slate-400">
                        #{publicUserId(row.userId)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      {row.levelName ?? `等级 #${row.levelId}`}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.remark || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500">
                      {formatDate(row.updateTime ?? row.createTime ?? "")}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={loading}
                          onClick={() => openEdit(row)}
                        >
                          <IconEdit className="size-3.5" />
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="destructive"
                          disabled={loading}
                          onClick={() => {
                            if (!loading && !pending.current) setDeleteTarget(row);
                          }}
                        >
                          <IconTrash className="size-3.5" />
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 0 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-[12px] text-slate-500">
            <span>
              共 {total} 条 · 第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => void loadList({ page: page - 1 })}
              >
                上一页
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={page >= totalPages || loading}
                onClick={() => void loadList({ page: page + 1 })}
              >
                下一页
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <AdminDialog
        open={dialogOpen}
        onClose={closeDialog}
        title={mode === "create" ? "授予等级" : "编辑等级关联"}
        description={
          mode === "create"
            ? "按手机号 / 邮箱 / 昵称 / ID 查找用户，确认本人后再选择等级。"
            : "修改该用户的认证等级或备注。"
        }
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeDialog}
              disabled={saving}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={loading || (mode === "create" && !resolvedUser)}
              onClick={() => void handleSave()}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? <ErrorBanner message={formError} /> : null}

          {mode === "create" ? (
            <FormLabel label="查找用户" help="手机号 / 邮箱 / 昵称 / ID">
              <div className="flex gap-2">
                <TextInput
                  value={lookupQuery}
                  placeholder="手机号 / 邮箱 / 昵称 / ID"
                  onChange={(event) => {
                    if (pendingPurpose.current === "lookup") {
                      pending.current?.cancel();
                      pending.current?.finish();
                      pending.current = null;
                    }
                    setLookupQuery(event.target.value);
                    setResolvedUser(null);
                    setLookupHits([]);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runDialogLookup();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={lookingUp || !lookupQuery.trim()}
                  onClick={() => void runDialogLookup()}
                >
                  <IconSearch className="size-4" />
                  {lookingUp ? "查找中" : "查找"}
                </Button>
              </div>
              {resolvedUser ? (
                <div className="mt-2 flex items-start justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-emerald-900">
                      {resolvedUser.nickName || "（昵称未知）"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-emerald-800">{userLine(resolvedUser)}</p>
                  </div>
                  <button
                    type="button"
                    className="rounded p-0.5 text-emerald-700 hover:bg-emerald-100"
                    onClick={() => setResolvedUser(null)}
                    title="清除"
                  >
                    <IconX className="size-3.5" />
                  </button>
                </div>
              ) : null}
              {lookupHits.length > 0 ? (
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-1">
                  {lookupHits.map((hit) => (
                    <button
                      key={hit.userId}
                      type="button"
                      disabled={lookingUp}
                      onClick={() => {
                        setResolvedUser(toResolved(hit));
                        setLookupHits([]);
                      }}
                      className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left transition hover:bg-slate-50"
                    >
                      <span className="text-sm font-medium text-slate-900">
                        {hit.nickName || "（昵称未知）"}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {[hit.phone, hit.email, `#${hit.userId}`].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </FormLabel>
          ) : (
            <FormLabel label="用户">
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800">
                {editingUserLabel}
              </p>
            </FormLabel>
          )}

          <FormLabel label="等级">
            <select
              value={draft.levelId}
              onChange={(event) => setDraft((d) => ({ ...d, levelId: event.target.value }))}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 outline-none focus:border-slate-400"
            >
              {levelOptions.map((level) => (
                <option key={level.id} value={String(level.id)}>
                  {level.name}
                </option>
              ))}
            </select>
            {draft.levelId ? (
              <p className="mt-1 text-[11px] text-slate-500">
                {levelOptions.find((level) => String(level.id) === draft.levelId)?.description ||
                  "无描述"}
              </p>
            ) : null}
          </FormLabel>

          <FormLabel label="备注">
            <textarea
              value={draft.remark}
              onChange={(event) => setDraft((d) => ({ ...d, remark: event.target.value }))}
              rows={3}
              placeholder="可选"
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-slate-400"
            />
          </FormLabel>
        </div>
      </AdminDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            pending.current?.cancel();
            pending.current?.finish();
            pending.current = null;
            setDeleteTarget(null);
          }
        }}
        title="删除等级关联"
        description={
          deleteTarget
            ? `确定删除用户 ${deleteTarget.userName ?? publicUserId(deleteTarget.userId)} 的「${deleteTarget.levelName ?? deleteTarget.levelId}」等级？此操作不可撤销。`
            : undefined
        }
        confirmLabel="删除"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}
