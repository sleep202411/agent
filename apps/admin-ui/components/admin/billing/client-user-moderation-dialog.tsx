"use client";

// C 端用户处置弹窗 — 编辑资料 / 屏蔽。动作经 admin-ui 路由处理器 → Java 官方
// 管理端接口(X-Admin-Api-Token 只在服务端)。屏蔽会 account_status=5 + 强制下线。

import { useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { Button } from "@/components/ui/button";
import { AdminDialog, TextInput, mutateEnvelope, toErrorMessage } from "./shared";

export interface ClientUserTarget {
  userId: string;
  nickName: string | null;
}

type ModerationProps = {
  mode: "edit" | "block" | null;
  user: ClientUserTarget | null;
  onClose: () => void;
  onDone: () => void;
};
export function ClientUserModerationDialog(props: ModerationProps) {
  if (!props.mode || !props.user) return null;
  return (
    <ClientUserModerationDialogContent
      key={JSON.stringify([props.mode, props.user.userId])}
      {...props}
    />
  );
}
function ClientUserModerationDialogContent({ mode, user, onClose, onDone }: ModerationProps) {
  const open = mode !== null && user !== null;
  const [nickName, setNickName] = useState(user?.nickName ?? "");
  const [contact, setContact] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const { busy, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(null);

  if (!open || !user) return null;

  const submitEdit = async () => {
    const patch: Record<string, string> = {};
    if (nickName.trim()) patch.nickName = nickName.trim();
    if (contact.trim()) patch.contact = contact.trim();
    if (description.trim()) patch.description = description.trim();
    if (Object.keys(patch).length === 0) {
      setError("没有要更新的字段");
      return;
    }
    const operation = begin();
    if (!operation) return;
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/client-users/${encodeURIComponent(user.userId)}/info`,
        patch,
        "POST",
        operation.signal
      );
      if (!operation.current()) return;
      onDone();
      onClose();
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  };

  const submitBlock = async () => {
    if (!reason.trim()) {
      setError("请填写屏蔽原因");
      return;
    }
    const operation = begin();
    if (!operation) return;
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/client-users/${encodeURIComponent(user.userId)}/block`,
        {
          reason: reason.trim(),
        },
        "POST",
        operation.signal
      );
      if (!operation.current()) return;
      onDone();
      onClose();
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  };

  const isBlock = mode === "block";
  const label = user.nickName ? `${user.nickName} #${user.userId}` : `用户 #${user.userId}`;

  return (
    <AdminDialog
      open={open}
      title={isBlock ? "屏蔽用户" : "编辑用户资料"}
      description={
        isBlock
          ? `确认屏蔽「${label}」?屏蔽后该用户被强制下线且无法登录,直到解除。`
          : `编辑「${label}」的资料。仅更新填写的字段。`
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <div className="flex items-center justify-between gap-2">
          {error ? <span className="text-[12px] text-red-600">{error}</span> : <span />}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              variant={isBlock ? "destructive" : "default"}
              disabled={busy}
              onClick={() => void (isBlock ? submitBlock() : submitEdit())}
            >
              {busy ? "处理中…" : isBlock ? "确认屏蔽" : "保存"}
            </Button>
          </div>
        </div>
      }
    >
      {isBlock ? (
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-slate-600">屏蔽原因(必填,1–512 字)</label>
          <TextInput
            disabled={busy}
            aria-label="屏蔽原因"
            value={reason}
            placeholder="例:违反社区规范,多次发布违规内容"
            maxLength={512}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-[11px] text-slate-400">该原因会作为登录拦截提示原文展示给用户。</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="昵称">
            <TextInput
              disabled={busy}
              aria-label="昵称"
              value={nickName}
              placeholder="留空则不修改"
              maxLength={64}
              onChange={(event) => setNickName(event.target.value)}
            />
          </Field>
          <Field label="联系方式">
            <TextInput
              disabled={busy}
              aria-label="联系方式"
              value={contact}
              placeholder="留空则不修改"
              onChange={(event) => setContact(event.target.value)}
            />
          </Field>
          <Field label="简介">
            <TextInput
              disabled={busy}
              aria-label="简介"
              value={description}
              placeholder="留空则不修改"
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
      )}
    </AdminDialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-medium text-slate-600">{label}</label>
      {children}
    </div>
  );
}
