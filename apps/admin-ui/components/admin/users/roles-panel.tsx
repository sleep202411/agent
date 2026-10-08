"use client";

import { useState } from "react";
import { IconPlus, IconShieldLock, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAdminOperation } from "../use-admin-operation";
import { PermissionDirectory } from "./permission-directory";
import { displayRoleDescription, displayRoleName, isSystemRoleKey } from "./permission-tree";
import { ErrorBanner, PageHeader, requestEnvelope, toErrorMessage } from "./shared";
import type { AdminPermissionInfo, AdminRoleInfo, AdminRolesData } from "./types";

function isLockedRole(role: AdminRoleInfo) {
  return role.system === true || isSystemRoleKey(role.key);
}

const ROLE_KEY_PATTERN = "[a-z][a-z0-9_]{1,62}";
const ROLE_KEY_HINT = "须为小写字母。";

type RoleEditor = { mode: "create" } | { mode: "view" | "edit"; role: AdminRoleInfo };

export function RolesPanel({
  siteLabel,
  databaseLabel,
  initialData,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialData: AdminRolesData | null;
  initialError: string | null;
}) {
  const { begin, busy } = useAdminOperation();
  const [data, setData] = useState<AdminRolesData | null>(initialData);
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<RoleEditor | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const roles = data?.roles ?? [];
  const permissions = data?.permissions ?? [];

  async function apply(action: () => Promise<AdminRolesData>) {
    const operation = begin();
    if (!operation) return;
    setError(null);
    setNotice(null);
    try {
      const next = await action();
      if (!operation.current()) return;
      setData(next);
    } catch (cause) {
      if (operation.current()) setError(toErrorMessage(cause));
    } finally {
      operation.finish();
    }
  }

  async function saveRole(
    role: AdminRoleInfo,
    next: { name?: string; description?: string; permissions: string[] }
  ) {
    await apply(async () => {
      const body: {
        name?: string;
        description?: string;
        permissions: string[];
      } = { permissions: next.permissions };
      if (next.name !== undefined) body.name = next.name;
      if (next.description !== undefined) body.description = next.description;
      const result = await requestEnvelope<AdminRolesData>(
        `/api/admin/users/roles/${encodeURIComponent(role.key)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      setNotice(`已更新「${next.name?.trim() || displayRoleName(role)}」。`);
      setEditor(null);
      return result;
    });
  }

  async function removeRole(role: AdminRoleInfo) {
    await apply(async () => {
      const result = await requestEnvelope<AdminRolesData>(
        `/api/admin/users/roles/${encodeURIComponent(role.key)}`,
        { method: "DELETE" }
      );
      setNotice(`已删除角色「${displayRoleName(role)}」。`);
      setDeleteKey(null);
      return result;
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        icon={<IconShieldLock className="size-4" />}
        title="角色权限"
        description="每个角色可按后台目录勾选模块。系统角色不能删除，保存后在「账号」页分配。"
        actions={
          <Button disabled={busy} onClick={() => setEditor({ mode: "create" })}>
            <IconPlus className="size-4" />
            新建角色
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}

      {roles.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500">
                  角色
                </th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500">
                  类型
                </th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500">
                  账号
                </th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-500">
                  权限
                </th>
                <th className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-right text-[11px] font-medium text-slate-500">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const locked = isLockedRole(role);
                const name = displayRoleName(role);
                return (
                  <tr key={role.key} className="hover:bg-slate-50/60">
                    <td className="border-b border-slate-100 px-3 py-2.5">
                      <p className="text-sm font-medium text-slate-900">{name}</p>
                      <p className="mt-0.5 max-w-[420px] truncate text-[12px] text-slate-500">
                        {displayRoleDescription(role)}
                      </p>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2.5 text-[13px] text-slate-600">
                      {locked ? "系统" : "员工"}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2.5 text-[13px] text-slate-700">
                      {role.accountCount}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2.5 text-[13px] text-slate-700">
                      {role.permissions.length} / {permissions.length}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`查看${name}`}
                          disabled={busy}
                          onClick={() => setEditor({ mode: "view", role })}
                        >
                          查看
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          aria-label={`编辑${name}`}
                          disabled={busy}
                          onClick={() => setEditor({ mode: "edit", role })}
                        >
                          编辑
                        </Button>
                        <div className="inline-flex w-[4.75rem] shrink-0 justify-start">
                          {locked ? null : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700"
                              aria-label={`删除${name}`}
                              disabled={busy || role.accountCount > 0}
                              title={role.accountCount > 0 ? "仍有账号使用该角色" : "删除角色"}
                              onClick={() => setDeleteKey(role.key)}
                            >
                              <IconTrash className="size-3.5" />
                              删除
                            </Button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : !error ? (
        <p className="py-10 text-center text-sm text-slate-500">暂无角色数据。</p>
      ) : null}

      <RoleEditorDialog
        editor={editor}
        busy={busy}
        permissions={permissions}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        onCreate={async (payload) => {
          await apply(async () => {
            const result = await requestEnvelope<AdminRolesData>("/api/admin/users/roles", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            setNotice(`已创建角色「${payload.name}」。`);
            setEditor(null);
            return result;
          });
        }}
        onSave={saveRole}
      />

      <ConfirmDialog
        open={Boolean(deleteKey)}
        onOpenChange={(open) => {
          if (!open) setDeleteKey(null);
        }}
        title="删除角色"
        description="删除后不可恢复。请确认没有账号仍在使用该角色。"
        confirmLabel="删除"
        destructive
        onConfirm={async () => {
          const role = roles.find((item) => item.key === deleteKey);
          if (role) await removeRole(role);
        }}
      />
    </div>
  );
}

function RoleEditorDialog({
  editor,
  busy,
  permissions,
  onOpenChange,
  onCreate,
  onSave,
}: {
  editor: RoleEditor | null;
  busy: boolean;
  permissions: AdminPermissionInfo[];
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    key: string;
    name: string;
    description?: string;
    permissions: string[];
  }) => Promise<void>;
  onSave: (
    role: AdminRoleInfo,
    next: { name?: string; description?: string; permissions: string[] }
  ) => Promise<void>;
}) {
  return (
    <Dialog open={Boolean(editor)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        {editor ? (
          <RoleEditorForm
            key={editor.mode === "create" ? "create" : `${editor.mode}:${editor.role.key}`}
            editor={editor}
            busy={busy}
            permissions={permissions}
            onOpenChange={onOpenChange}
            onCreate={onCreate}
            onSave={onSave}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RoleEditorForm({
  editor,
  busy,
  permissions,
  onOpenChange,
  onCreate,
  onSave,
}: {
  editor: RoleEditor;
  busy: boolean;
  permissions: AdminPermissionInfo[];
  onOpenChange: (open: boolean) => void;
  onCreate: (input: {
    key: string;
    name: string;
    description?: string;
    permissions: string[];
  }) => Promise<void>;
  onSave: (
    role: AdminRoleInfo,
    next: { name?: string; description?: string; permissions: string[] }
  ) => Promise<void>;
}) {
  const mode = editor.mode;
  const role = editor.mode === "create" ? null : editor.role;
  const locked = role ? isLockedRole(role) : false;
  const canEditProfile = mode === "create" || (mode === "edit" && !locked);
  const titleName = role ? displayRoleName(role) : "";
  const [key, setKey] = useState(role?.key ?? "");
  const [name, setName] = useState(role ? displayRoleName(role) : "");
  const [description, setDescription] = useState(role ? displayRoleDescription(role) : "");
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {mode === "create"
            ? "新建员工角色"
            : mode === "view"
              ? `查看「${titleName}」`
              : `编辑「${titleName}」`}
        </DialogTitle>
        <DialogDescription>
          {mode === "create"
            ? "按当前后台目录勾选模块。保存后即可在账号页分配。"
            : mode === "view"
              ? "系统角色权限固定，仅供查看。"
              : locked
                ? "勾选该角色可以访问的后台目录。系统角色名称与说明由目录维护。"
                : "可修改名称、说明，并勾选可访问的后台目录。标识创建后不可更改。"}
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "view") {
            onOpenChange(false);
            return;
          }
          if (mode === "create") {
            void onCreate({
              key: key.trim(),
              name: name.trim(),
              description: description.trim() || undefined,
              permissions: selected,
            });
            return;
          }
          if (role) {
            void onSave(
              role,
              canEditProfile
                ? {
                    name: name.trim(),
                    description: description.trim(),
                    permissions: selected,
                  }
                : { permissions: selected }
            );
          }
        }}
      >
        {mode === "create" || mode === "edit" ? (
          <>
            <div className="grid grid-cols-2 items-start gap-x-3 gap-y-1 text-sm">
              <label htmlFor="role-name">名称</label>
              <label htmlFor="role-key">标识</label>
              <Input
                id="role-name"
                required={canEditProfile}
                name="roleName"
                value={name}
                disabled={!canEditProfile}
                onChange={(event) => setName(event.target.value)}
              />
              <Input
                id="role-key"
                required={mode === "create"}
                name="roleKey"
                value={mode === "create" ? key : (role?.key ?? "")}
                pattern={mode === "create" ? ROLE_KEY_PATTERN : undefined}
                maxLength={63}
                title={mode === "create" ? ROLE_KEY_HINT : "标识创建后不可更改"}
                aria-describedby={mode === "create" ? "role-key-hint" : undefined}
                disabled={mode !== "create"}
                onInvalid={(event) => {
                  if (mode === "create") event.currentTarget.setCustomValidity(ROLE_KEY_HINT);
                }}
                onChange={(event) => {
                  event.currentTarget.setCustomValidity("");
                  setKey(event.target.value.toLowerCase());
                }}
              />
              {mode === "create" ? (
                <p id="role-key-hint" className="col-start-2 text-[11px] leading-4 text-slate-400">
                  {ROLE_KEY_HINT}
                </p>
              ) : (
                <p className="col-start-2 text-[11px] leading-4 text-slate-400">创建后不可更改</p>
              )}
            </div>
            <label className="grid gap-1 text-sm">
              说明
              <Input
                name="roleDescription"
                value={description}
                disabled={!canEditProfile}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          </>
        ) : null}
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-slate-700">权限目录</span>
            <span className="text-[11px] text-slate-400">已选 {selected.length} 项</span>
          </div>
          <PermissionDirectory
            permissions={permissions}
            selected={selected}
            onChange={setSelected}
            readOnly={mode === "view"}
          />
        </div>
        <div className="flex justify-end gap-2">
          {mode === "view" ? (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={busy || selected.length === 0}>
                {mode === "create" ? "创建角色" : "保存"}
              </Button>
            </>
          )}
        </div>
      </form>
    </>
  );
}
