"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconDeviceFloppy,
  IconLock,
  IconPhoto,
  IconRefresh,
  IconShieldCheck,
  IconUserCircle,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/admin/page-header";
import { useAdminOperation } from "./use-admin-operation";
import { requestEnvelope } from "./users/shared";
import type { AdminSession } from "@/lib/admin-session";

type AccountSettingsPanelProps = {
  session: AdminSession;
};

export function AccountSettingsPanel({ session }: AccountSettingsPanelProps) {
  const router = useRouter();
  const { busy, begin } = useAdminOperation();
  const [profile, setProfile] = useState({
    displayName: session.user.displayName,
    avatarUrl: session.user.avatarUrl ?? "",
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [resettingMfa, setResettingMfa] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const avatarText = profile.displayName.trim().slice(0, 1).toUpperCase() || "A";

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operation = begin("write");
    if (!operation) return;
    setError(null);
    setNotice(null);
    setSavingProfile(true);
    try {
      await requestEnvelope("/api/admin/auth/me/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        signal: operation.signal,
        body: JSON.stringify({
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl.trim() || null,
        }),
      });
      if (!operation.current()) return;
      setNotice("账户资料已更新。");
      router.refresh();
    } catch (err) {
      if (operation.current()) setError(errorMessage(err));
    } finally {
      if (operation.current()) setSavingProfile(false);
      operation.finish();
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operation = begin("write");
    if (!operation) return;
    setError(null);
    setNotice(null);
    setSavingPassword(true);
    try {
      if (passwordForm.newPassword !== passwordForm.confirmPassword)
        throw new Error("两次输入的新密码不一致。");
      await requestEnvelope("/api/admin/auth/me/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: operation.signal,
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      if (!operation.current()) return;
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setNotice("密码已更新，其他登录会话已撤销。");
      router.refresh();
    } catch (err) {
      if (operation.current()) setError(errorMessage(err));
    } finally {
      if (operation.current()) setSavingPassword(false);
      operation.finish();
    }
  }

  async function resetMfa() {
    const operation = begin("write");
    if (!operation) return;
    setError(null);
    setNotice(null);
    setResettingMfa(true);
    try {
      await requestEnvelope("/api/admin/auth/me/mfa/reset", {
        method: "POST",
        signal: operation.signal,
      });
      if (!operation.current()) return;
      setNotice("MFA 已重置。下次登录需要重新绑定，其他会话已撤销。");
      router.refresh();
    } catch (err) {
      if (operation.current()) {
        setError(errorMessage(err));
        throw err;
      }
    } finally {
      if (operation.current()) setResettingMfa(false);
      operation.finish();
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="管理员账户设置"
        description="维护当前登录账号的资料、安全凭据和 MFA 绑定。"
        actions={
          <div className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-medium text-slate-600">
            {session.site.label}
          </div>
        }
      />
      {notice ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <form
          inert={busy}
          onSubmit={updateProfile}
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <IconUserCircle className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-950">基础资料</h3>
              <p className="mt-1 text-sm text-slate-500">名称会显示在审计日志和后台导航中。</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[144px_1fr]">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex size-20 items-center justify-center overflow-hidden rounded-full bg-slate-950 text-xl font-semibold text-white">
                {profile.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.avatarUrl}
                    alt="管理员头像预览"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  avatarText
                )}
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <IconPhoto className="size-3" />
                头像预览
              </span>
            </div>

            <div className="space-y-4">
              <Label className="block space-y-2">
                <span className="text-[13px] font-medium text-slate-700">显示名称</span>
                <Input
                  value={profile.displayName}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, displayName: event.target.value }))
                  }
                  required
                  maxLength={120}
                  className="h-10"
                />
              </Label>
              <Label className="block space-y-2">
                <span className="text-[13px] font-medium text-slate-700">头像 URL</span>
                <Input
                  value={profile.avatarUrl}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, avatarUrl: event.target.value }))
                  }
                  type="url"
                  maxLength={512}
                  placeholder="https://..."
                  className="h-10"
                />
              </Label>
              <Button type="submit" disabled={busy}>
                <IconDeviceFloppy className="size-4" />
                {savingProfile ? "正在保存" : "保存资料"}
              </Button>
            </div>
          </div>
        </form>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <IconShieldCheck className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-950">登录安全</h3>
              <p className="mt-1 text-sm text-slate-500">
                MFA 状态：{session.user.mfaEnabledAt ? "已绑定" : "待绑定"}
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <ConfirmDialog
              title="确认重新绑定 MFA？"
              description="当前账号下次登录需要重新扫描二维码完成绑定；其他登录会话会被撤销。"
              confirmLabel="确认重置"
              destructive
              onConfirm={resetMfa}
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={busy}
                >
                  <IconRefresh className="size-4" />
                  {resettingMfa ? "正在重置 MFA" : "重新绑定 MFA"}
                </Button>
              }
            />
            <p className="text-[12px] leading-5 text-slate-500">
              重置后当前会话保留，其他会话会被撤销；下次登录必须重新扫描二维码。
            </p>
          </div>
        </section>
      </div>

      <form
        inert={busy}
        onSubmit={changePassword}
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <IconLock className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-950">修改密码</h3>
            <p className="mt-1 text-sm text-slate-500">
              更新密码需要输入当前密码，并满足后台密码策略。
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <Label className="block space-y-2">
            <span className="text-[13px] font-medium text-slate-700">当前密码</span>
            <Input
              value={passwordForm.currentPassword}
              onChange={(event) =>
                setPasswordForm((current) => ({
                  ...current,
                  currentPassword: event.target.value,
                }))
              }
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              maxLength={200}
              className="h-10"
            />
          </Label>
          <Label className="block space-y-2">
            <span className="text-[13px] font-medium text-slate-700">新密码</span>
            <Input
              value={passwordForm.newPassword}
              onChange={(event) =>
                setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
              }
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={200}
              className="h-10"
            />
          </Label>
          <Label className="block space-y-2">
            <span className="text-[13px] font-medium text-slate-700">确认新密码</span>
            <Input
              value={passwordForm.confirmPassword}
              onChange={(event) =>
                setPasswordForm((current) => ({
                  ...current,
                  confirmPassword: event.target.value,
                }))
              }
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={200}
              className="h-10"
            />
          </Label>
        </div>
        <Button type="submit" className="mt-5" disabled={busy}>
          <IconLock className="size-4" />
          {savingPassword ? "正在修改" : "修改密码"}
        </Button>
      </form>
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
