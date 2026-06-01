"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  IconCopy,
  IconDatabase,
  IconLock,
  IconMail,
  IconQrcode,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { adminUiApiPath } from "@/lib/admin-api";
import type { AdminSiteOption } from "@/lib/admin-sites";

export function LoginForm({ site }: { site: AdminSiteOption }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  // Keyed by the otpauth URI it was generated for, so the displayed QR can be
  // derived during render without resetting state in the effect body.
  const [mfaQr, setMfaQr] = useState<{ uri: string; dataUrl: string } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<{
    setupRequired: boolean;
    challengeToken: string;
    expiresAt: string;
    secret?: string;
    otpauthUri?: string;
  } | null>(null);

  const otpauthUri = mfaChallenge?.setupRequired ? mfaChallenge.otpauthUri : undefined;
  // Derived during render: only show the QR once it matches the current URI,
  // so switching challenges falls back to the loading state with no eager reset.
  const mfaQrDataUrl = otpauthUri && mfaQr?.uri === otpauthUri ? mfaQr.dataUrl : "";

  // Generate the MFA QR code asynchronously for the current otpauth URI.
  // setState lives only inside the async callback, never in the effect body.
  useEffect(() => {
    if (!otpauthUri) return;
    let cancelled = false;
    QRCode.toDataURL(otpauthUri, {
      width: 192,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#020617",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (!cancelled) setMfaQr({ uri: otpauthUri, dataUrl: url });
      })
      .catch(() => {
        if (!cancelled) setMfaQr(null);
      });

    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  async function copyMfaSecret() {
    if (!mfaChallenge?.secret) return;
    await navigator.clipboard.writeText(mfaChallenge.secret);
    setSecretCopied(true);
    window.setTimeout(() => setSecretCopied(false), 1800);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const formData = new FormData(event.currentTarget);
    const response = await fetch(adminUiApiPath("/api/admin/auth/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });
    const payload = await response.json().catch(() => null);
    setPending(false);
    if (!response.ok || payload?.code !== 200) {
      setError(payload?.msg ?? payload?.message ?? "登录失败，请检查账号和密码。");
      return;
    }
    if (payload?.data?.mfa?.required) {
      setMfaChallenge(payload.data.mfa);
      setMfaCode("");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function onVerifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallenge) return;
    setError(null);
    setPending(true);
    const response = await fetch(adminUiApiPath("/api/admin/auth/mfa/verify"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeToken: mfaChallenge.challengeToken,
        code: mfaCode,
      }),
    });
    const payload = await response.json().catch(() => null);
    setPending(false);
    if (!response.ok || payload?.code !== 200) {
      setError(payload?.msg ?? payload?.message ?? "MFA 验证失败，请重新输入验证码。");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  if (mfaChallenge) {
    return (
      <form onSubmit={onVerifyMfa} className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
          <div className="flex items-start gap-2">
            <IconDatabase className="mt-0.5 size-4 shrink-0 text-slate-500" />
            <span>
              正在登录 {site.shortLabel}，验证码将在{" "}
              {new Date(mfaChallenge.expiresAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              前有效。
            </span>
          </div>
        </div>
        {mfaChallenge.setupRequired ? (
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] leading-5 text-amber-900">
            <div className="flex items-start gap-2">
              <IconQrcode className="mt-0.5 size-4 shrink-0 text-amber-700" />
              <div>
                <p className="font-semibold">首次登录需要绑定 MFA。</p>
                <p className="mt-1">
                  使用 Google Authenticator、1Password 或 Microsoft Authenticator 扫描二维码。
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[164px_1fr]">
              <div className="flex h-[164px] w-[164px] items-center justify-center rounded-lg border border-amber-200 bg-white p-2">
                {mfaQrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data: URL QR, next/image cannot optimize it
                  <img
                    src={mfaQrDataUrl}
                    alt="MFA 绑定二维码"
                    className="h-36 w-36"
                    draggable={false}
                  />
                ) : (
                  <span className="text-center text-[11px] text-amber-700">正在生成二维码</span>
                )}
              </div>
              <div className="min-w-0 space-y-2">
                <p className="text-[11px] font-medium text-amber-800">不能扫码时，手动输入密钥。</p>
                <div className="flex items-center gap-2 rounded-md bg-white/80 px-2 py-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-[12px]">
                    {mfaChallenge.secret}
                  </code>
                  <button
                    type="button"
                    onClick={copyMfaSecret}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-amber-200 bg-white px-2 text-[11px] font-medium text-amber-900 transition hover:border-amber-300 hover:bg-amber-100"
                  >
                    <IconCopy className="size-3.5" />
                    {secretCopied ? "已复制" : "复制"}
                  </button>
                </div>
                <p className="text-[11px] text-amber-800">
                  绑定后输入应用中显示的 6 位验证码完成登录。
                </p>
              </div>
            </div>
          </div>
        ) : null}
        <div className="space-y-2">
          <label className="text-[13px] font-medium text-slate-700" htmlFor="mfa-code">
            MFA 验证码
          </label>
          <input
            id="mfa-code"
            value={mfaCode}
            onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            pattern="[0-9]{6}"
            required
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-center font-mono text-lg tracking-[0.3em] outline-none transition focus:border-slate-900 focus:ring-3 focus:ring-slate-200"
            placeholder="000000"
          />
        </div>
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}
        <Button className="h-10 w-full" type="submit" disabled={pending || mfaCode.length !== 6}>
          <IconShieldCheck className="size-4" />
          {pending ? "正在验证" : "完成 MFA 登录"}
        </Button>
        <button
          type="button"
          className="w-full text-center text-[12px] font-medium text-slate-500 hover:text-slate-950"
          onClick={() => {
            setMfaChallenge(null);
            setError(null);
          }}
        >
          返回账号密码登录
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="text-[13px] font-medium text-slate-700">当前站点</label>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            {site.databaseLabel}
          </span>
        </div>
        {/* TODO: 当中国站后台部署后，在此处加入跳转到另一站点 admin 域名的链接（目前中国站未部署，暂不展示） */}
        <div className="min-h-[76px] rounded-lg border border-slate-950 bg-slate-950 px-3 py-2 text-left text-white">
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{site.shortLabel}</span>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white">
              {site.badge}
            </span>
          </span>
          <span className="mt-1 block truncate text-[12px] text-slate-300">{site.domain}</span>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
          <IconDatabase className="mt-0.5 size-4 shrink-0 text-slate-500" />
          <span>本控制台仅访问 {site.shortLabel} 的后台数据库。</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[13px] font-medium text-slate-700" htmlFor="email">
          后台邮箱
        </label>
        <div className="relative">
          <IconMail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-slate-900 focus:ring-3 focus:ring-slate-200"
            placeholder="isaac@fizzdragon.com"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-[13px] font-medium text-slate-700" htmlFor="password">
          登录密码
        </label>
        <div className="relative">
          <IconLock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-slate-900 focus:ring-3 focus:ring-slate-200"
            placeholder="至少 8 位"
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}

      <Button className="h-10 w-full" type="submit" disabled={pending}>
        <IconShieldCheck className="size-4" />
        {pending ? "正在登录" : "进入管理后台"}
      </Button>
    </form>
  );
}
