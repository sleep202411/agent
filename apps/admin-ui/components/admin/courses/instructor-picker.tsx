"use client";

import { useState, type ReactNode } from "react";
import { IconSearch, IconTrash, IconUserPlus, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { AdminDialog, FormLabel, TextInput } from "@/components/admin/billing/shared";
import { useAdminUserLookup } from "../use-admin-user-lookup";
import type { CourseInstructor } from "@/components/admin/courses/types";
import type { UserLookupResult } from "@/components/admin/growth/referrals-types";
import { cn } from "@/lib/utils";

function userLine(u: { userId: string; email: string | null; phone?: string | null }): string {
  return [u.userId, u.email, u.phone].filter(Boolean).join(" · ");
}

export function InstructorPicker({
  instructors,
  onChange,
  headerActions,
}: {
  instructors: CourseInstructor[];
  onChange: (next: CourseInstructor[]) => void;
  headerActions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pendingUser, setPendingUser] = useState<UserLookupResult | null>(null);
  const [pendingShare, setPendingShare] = useState("");
  const { query, setQuery, results, searching, lookupError, runLookup, cancel } =
    useAdminUserLookup(open);

  function close() {
    cancel();
    setOpen(false);
    setPendingUser(null);
    setPendingShare("");
  }

  function addInstructor() {
    if (!open || searching || !pendingUser) return;
    if (instructors.some((item) => item.userId === pendingUser.userId)) {
      if (pendingShare.trim()) {
        onChange(
          instructors.map((item) =>
            item.userId === pendingUser.userId
              ? { ...item, sharePercent: pendingShare.trim() }
              : item
          )
        );
      }
      close();
      setQuery("");
      return;
    }
    onChange([
      ...instructors,
      {
        userId: pendingUser.userId,
        nickName: pendingUser.nickName || "",
        avatar: "",
        description: "",
        sharePercent: pendingShare.trim(),
      },
    ]);
    close();
    setQuery("");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">讲师</p>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {headerActions}
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <IconUserPlus className="size-4" />
            添加讲师
          </Button>
        </div>
      </div>

      {instructors.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-400">
          尚未绑定讲师。后台只维护绑定关系，资料按用户 ID 查询。
        </p>
      ) : (
        <ul className="space-y-2">
          {instructors.map((instructor) => (
            <li
              key={instructor.userId}
              className="flex items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1 self-center">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {instructor.nickName || "（昵称未知）"}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-500">{instructor.userId}</p>
              </div>
              <div className="w-36 shrink-0">
                <FormLabel label="分润比例（%）">
                  <TextInput
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={instructor.sharePercent ?? ""}
                    onChange={(event) =>
                      onChange(
                        instructors.map((item) =>
                          item.userId === instructor.userId
                            ? { ...item, sharePercent: event.target.value }
                            : item
                        )
                      )
                    }
                  />
                </FormLabel>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() =>
                  onChange(instructors.filter((item) => item.userId !== instructor.userId))
                }
              >
                <IconTrash className="size-4" />
                移除
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AdminDialog
        open={open}
        onClose={close}
        title="添加讲师"
        description="搜索用户后选择，并可同时填写分润比例；界面展示混淆后的 Public ID，保存时会解码成真实 userId。"
      >
        <div className="space-y-3">
          <FormLabel label="查找用户" help="邮箱 / 手机号 / 昵称 / 用户 ID">
            <div className="flex gap-2">
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="邮箱 / 手机 / 昵称 / ID"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runLookup();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void runLookup()}
                disabled={searching || !query.trim()}
              >
                <IconSearch className="size-4" />
                查找
              </Button>
            </div>
          </FormLabel>
          {lookupError ? <p className="text-[12px] text-red-600">{lookupError}</p> : null}
          {results.length > 0 ? (
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-1">
              {results.map((user) => (
                <button
                  key={user.userId}
                  type="button"
                  disabled={searching}
                  onClick={() => setPendingUser(user)}
                  className={cn(
                    "flex w-full flex-col items-start rounded px-2 py-1.5 text-left transition hover:bg-slate-50",
                    pendingUser?.userId === user.userId && "bg-slate-100"
                  )}
                >
                  <span className="text-sm font-medium text-slate-900">
                    {user.nickName || "（昵称未知）"}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{userLine(user)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {pendingUser ? (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="truncate text-sm font-medium text-slate-900">
                {pendingUser.nickName || "（昵称未知）"}
              </p>
              <FormLabel label="分润比例（%）">
                <TextInput
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={pendingShare}
                  onChange={(event) => setPendingShare(event.target.value)}
                  placeholder="可选"
                />
              </FormLabel>
            </div>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <Button type="button" variant="outline" onClick={close}>
              <IconX className="size-4" />
              关闭
            </Button>
            <Button type="button" disabled={!pendingUser || searching} onClick={addInstructor}>
              <IconUserPlus className="size-4" />
              添加
            </Button>
          </div>
        </div>
      </AdminDialog>
    </div>
  );
}
