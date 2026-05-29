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
import { adminUiApiPath } from "@/lib/admin-api";
import type { AdminSession } from "@/lib/admin-session";

type AccountSettingsPanelProps = {
  session: AdminSession;
};

export function AccountSettingsPanel({ session }: AccountSettingsPanelProps) {
  const router = useRouter();
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
    setError(null);
    setNotice(null);
    setSavingProfile(true);
    try {
      await requestEnvelope("/api/admin/auth/me/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl.trim() || null,
        }),
      });
      setNotice("账户资料已更新。");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setSavingPassword(true);
    try {
      await requestEnvelope("/api/admin/auth/me/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setNotice("密码已更新，其他登录会话已撤销。");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingPassword(false);
    }
  }

  async function resetMfa() {
    const confirmed = window.confirm(
      "确认重新绑定 MFA？当前账号下次登录需要重新扫描二维码完成绑定。"
    );
    if (!confirmed) return;
    setError(null);
    setNotice(null);
    setResettingMfa(true);
    try {
      await requestEnvelope("/api/admin/auth/me/mfa/reset", { method: "POST" });
      setNotice("MFA 已重置。下次登录需要重新绑定，其他会话已撤销。");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResettingMfa(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">管理员账户设置</h2>
            <p className="mt-1 text-sm text-slate-500">
              维护当前登录账号的资料、安全凭据和 MFA 绑定。
            </p>
          </div>
          <div className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-medium text-slate-600">
            {session.site.label}
          </div>
        </div>
        {notice ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <form onSubmit={updateProfile} className="rounded-lg border border-slate-200 bg-white p-4">
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
              <label className="block space-y-2">
                <span className="text-[13px] font-medium text-slate-700">显示名称</span>
                <input
                  value={profile.displayName}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, displayName: event.target.value }))
                  }
                  required
                  maxLength={120}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900 focus:ring-3 focus:ring-slate-200"
                />
              </label>
              <label className="block space-y-2">
                <span className="text-[13px] font-medium text-slate-700">头像 URL</span>
                <input
                  value={profile.avatarUrl}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, avatarUrl: event.target.value }))
                  }
                  type="url"
                  maxLength={512}
                  placeholder="https://..."
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900 focus:ring-3 focus:ring-slate-200"
                />
              </label>
              <Button type="submit" disabled={savingProfile}>
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
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={resetMfa}
              disabled={resettingMfa}
            >
              <IconRefresh className="size-4" />
              {resettingMfa ? "正在重置 MFA" : "重新绑定 MFA"}
            </Button>
            <p className="text-[12px] leading-5 text-slate-500">
              重置后当前会话保留，其他会话会被撤销；下次登录必须重新扫描二维码。
            </p>
          </div>
        </section>
      </div>

      <form onSubmit={changePassword} className="rounded-lg border border-slate-200 bg-white p-4">
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
          <label className="block space-y-2">
            <span className="text-[13px] font-medium text-slate-700">当前密码</span>
            <input
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
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900 focus:ring-3 focus:ring-slate-200"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-[13px] font-medium text-slate-700">新密码</span>
            <input
              value={passwordForm.newPassword}
              onChange={(event) =>
                setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
              }
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={200}
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900 focus:ring-3 focus:ring-slate-200"
            />
          </label>
          <label className="block space-y-2">
            <span className="text-[13px] font-medium text-slate-700">确认新密码</span>
            <input
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
              className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900 focus:ring-3 focus:ring-slate-200"
            />
          </label>
        </div>
        <Button type="submit" className="mt-5" disabled={savingPassword}>
          <IconLock className="size-4" />
          {savingPassword ? "正在修改" : "修改密码"}
        </Button>
      </form>
    </div>
  );
}

async function requestEnvelope<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(adminUiApiPath(url), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    message?: string;
    data?: T;
  } | null;
  if (!response.ok || payload?.code !== 200) {
    throw new Error(payload?.msg ?? payload?.message ?? `请求失败：${response.status}`);
  }
  return payload.data as T;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}
