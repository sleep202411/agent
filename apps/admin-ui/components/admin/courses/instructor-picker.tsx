"use client";

import { useState } from "react";
import { IconSearch, IconTrash, IconUserPlus, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  AdminDialog,
  FormLabel,
  TextInput,
  requestEnvelope,
  toErrorMessage,
} from "@/components/admin/billing/shared";
import type { CourseInstructor } from "@/components/admin/courses/types";
import type { UserLookupResult } from "@/components/admin/growth/referrals-types";

function userLine(u: { userId: string; email: string | null; phone?: string | null }): string {
  return [u.userId, u.email, u.phone].filter(Boolean).join(" · ");
}

export function InstructorPicker({
  instructors,
  onChange,
}: {
  instructors: CourseInstructor[];
  onChange: (next: CourseInstructor[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserLookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  async function runLookup() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setLookupError(null);
    setResults([]);
    try {
      const data = await requestEnvelope<UserLookupResult[]>(
        `/api/admin/referrals/user-lookup?q=${encodeURIComponent(q)}`
      );
      setResults(data);
      if (data.length === 0) setLookupError("未找到匹配用户。");
    } catch (err) {
      setLookupError(toErrorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  function addInstructor(user: UserLookupResult) {
    if (instructors.some((item) => item.userId === user.userId)) {
      setOpen(false);
      return;
    }
    onChange([
      ...instructors,
      {
        userId: user.userId,
        nickName: user.nickName || "",
        avatar: "",
        description: "",
      },
    ]);
    setOpen(false);
    setQuery("");
    setResults([]);
    setLookupError(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-900">讲师</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <IconUserPlus className="size-4" />
          添加讲师
        </Button>
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
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {instructor.nickName || "（昵称未知）"}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-500">{instructor.userId}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
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
        onClose={() => setOpen(false)}
        title="添加讲师"
        description="搜索用户后选择；界面展示混淆后的 Public ID，保存时会解码成真实 userId。"
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
                  onClick={() => addInstructor(user)}
                  className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left transition hover:bg-slate-50"
                >
                  <span className="text-sm font-medium text-slate-900">
                    {user.nickName || "（昵称未知）"}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{userLine(user)}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex justify-end border-t border-slate-200 pt-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              <IconX className="size-4" />
              关闭
            </Button>
          </div>
        </div>
      </AdminDialog>
    </div>
  );
}
