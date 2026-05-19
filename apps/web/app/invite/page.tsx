"use client";

/**
 * /invite — project invitation landing page.
 *
 * Port of legacy Vue `pages/invite/invite.vue`. Entry URL shape:
 *   /invite?code=<inviteCode>[&projectId=<id>][&worldId=<id>]
 *
 * Flow:
 *   1. Fetch invite info by code → show confirm card with project name.
 *      (If backend marks user as already joined, short-circuit to the
 *      "already a member" card with an "Enter Project" CTA.)
 *   2. User clicks Accept → submit join request, then poll project/detail
 *      to detect admin approval. Polling backoff matches legacy:
 *      30s once, 50s × 3, 90s × 6, cap 10 iterations (≈12 min total).
 *      A manual "Refresh" button mirrors the polling check.
 *   3. Detected as approved → redirect to the crew workspace.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { IconAlertCircle, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { projectWorkspaceRoute } from "@/src/lib/studio-routes";
import { backendApi, ApiRequestError } from "@/src/lib/api";
import { Button } from "@/components/ui/button";

// ─── Types ──────────────────────────────────────────────────────────

interface InviteInfo {
  projectId?: string;
  projectName?: string;
  worldId?: string;
  joined?: boolean;
}

type UiState = "loading" | "error" | "alreadyJoined" | "confirm" | "applied";

// ─── Polling cadence (same as legacy) ───────────────────────────────
// 30s once, 50s × 3, 90s × 6, stop after 10 polls.
const MAX_POLL_COUNT = 10;
function getPollInterval(pollCount: number): number {
  if (pollCount < 1) return 30_000;
  if (pollCount < 4) return 50_000;
  return 90_000;
}

// ─── Page ──────────────────────────────────────────────────────────

export default function InvitePage() {
  const t = useTranslations("invite");
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale() as Locale;

  const inviteCode = searchParams?.get("code") ?? "";
  const queryProjectId = searchParams?.get("projectId") ?? "";
  const queryWorldId = searchParams?.get("worldId") ?? "";

  // Send unauthenticated visitors to /login with a redirect-back to the
  // exact invite URL (same code / projectId / worldId) so the deep link
  // survives the round-trip. Public-path policy means proxy.ts won't
  // gate /invite for us, and AuthInterceptor doesn't redirect on 401
  // for public paths either — so this page owns the redirect.
  const redirectToLogin = useCallback(() => {
    if (typeof window === "undefined") return;
    const here = `${window.location.pathname}${window.location.search}`;
    const loginPath = localizePath("/login", locale);
    router.replace(`${loginPath}?redirect=${encodeURIComponent(here)}`);
  }, [router, locale]);

  const isUnauthorized = (err: unknown): boolean =>
    err instanceof ApiRequestError && err.status === 401;

  const [uiState, setUiState] = useState<UiState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState(queryProjectId);
  const [worldId, setWorldId] = useState(queryWorldId);
  const [applying, setApplying] = useState(false);
  const [checking, setChecking] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollCountRef = useRef(0);

  // Stop polling; called on unmount + on any successful navigation.
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Navigate to the crew workspace. If worldId is still unknown, try one
  // more detail fetch to resolve it before redirecting — the legacy page
  // does the same bail-out.
  const goToWorkspace = useCallback(
    async (pid: string, wid: string) => {
      stopPolling();
      if (!pid) {
        router.push("/");
        return;
      }
      let finalWorldId = wid;
      if (!finalWorldId) {
        try {
          const detail = await backendApi.post<{ worldId?: string }>(
            `/api/user/project/detail/${encodeURIComponent(pid)}`
          );
          finalWorldId = String(detail?.worldId ?? "");
        } catch {
          // Soft fail — still navigate, workspace can resolve its own worldId.
        }
      }
      // Destination mirrors legacy `/project/workspace?projectId=X&worldId=Y`
      // which renders the storyboard editor in the studio workspace
      // (not `/crews/[id]/workspace`, which is the team dashboard).
      // The workspace reads worldId from the query string to bootstrap
      // Redux, so we must preserve it.
      router.push(
        localizePath(
          projectWorkspaceRoute(pid, {
            worldId: finalWorldId,
          }),
          locale
        )
      );
    },
    [locale, router, stopPolling]
  );

  // Detail fetch succeeds → user is an approved member.
  const checkProjectJoined = useCallback(async (pid: string): Promise<string | null> => {
    if (!pid) return null;
    try {
      const detail = await backendApi.post<{ worldId?: string }>(
        `/api/user/project/detail/${encodeURIComponent(pid)}`
      );
      return String(detail?.worldId ?? "");
    } catch {
      return null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollCountRef.current >= MAX_POLL_COUNT) return;

    const interval = getPollInterval(pollCountRef.current);
    pollTimerRef.current = setTimeout(async () => {
      pollCountRef.current += 1;
      const pid = projectId;
      if (!pid) return;
      const resolvedWorldId = await checkProjectJoined(pid);
      if (resolvedWorldId !== null) {
        void goToWorkspace(pid, resolvedWorldId || worldId);
      } else if (pollCountRef.current < MAX_POLL_COUNT) {
        startPolling();
      }
    }, interval);
  }, [checkProjectJoined, goToWorkspace, projectId, worldId]);

  // ─── Initial fetch ─────────────────────────────────────────────
  useEffect(() => {
    if (!inviteCode) {
      setUiState("error");
      setErrorMessage(t("invalidCode"));
      return;
    }

    let active = true;
    (async () => {
      try {
        const info = await backendApi.post<InviteInfo>(
          `/api/user/projectMember/getByInviteCode/${encodeURIComponent(inviteCode)}`
        );
        if (!active) return;
        if (!info) {
          setUiState("error");
          setErrorMessage(t("invalidCode"));
          return;
        }
        setProjectName(String(info.projectName ?? ""));
        setProjectId((prev) => prev || String(info.projectId ?? ""));
        setWorldId((prev) => prev || String(info.worldId ?? ""));
        setUiState(info.joined ? "alreadyJoined" : "confirm");
      } catch (err) {
        if (!active) return;
        if (isUnauthorized(err)) {
          redirectToLogin();
          return;
        }
        setUiState("error");
        setErrorMessage(t("error"));
      }
    })();
    return () => {
      active = false;
    };
  }, [inviteCode, t, redirectToLogin]);

  // ─── Actions ────────────────────────────────────────────────────
  const handleApply = async () => {
    if (applying || !inviteCode) return;
    setApplying(true);
    try {
      await backendApi.post(
        `/api/user/projectMember/applyInvite/${encodeURIComponent(inviteCode)}`
      );
      setUiState("applied");
      pollCountRef.current = 0;
      startPolling();
    } catch (err) {
      if (isUnauthorized(err)) {
        redirectToLogin();
        return;
      }
      toast.error(t("applyFailed"));
    } finally {
      setApplying(false);
    }
  };

  const handleManualCheck = async () => {
    if (checking || !projectId) return;
    setChecking(true);
    try {
      const resolvedWorldId = await checkProjectJoined(projectId);
      if (resolvedWorldId !== null) {
        void goToWorkspace(projectId, resolvedWorldId || worldId);
      } else {
        toast(t("notApproved"));
      }
    } finally {
      setChecking(false);
    }
  };

  const handleGoHome = () => {
    stopPolling();
    router.push("/");
  };

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0f] p-5">
      {/* Background glows — decorative, matches legacy visual */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-24 -top-24 size-[400px] rounded-full bg-[radial-gradient(circle,rgba(229,34,39,0.3)_0%,transparent_70%)] blur-[80px]" />
        <div className="absolute -bottom-12 -left-12 size-[300px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.25)_0%,transparent_70%)] blur-[80px]" />
        <div className="absolute left-1/2 top-1/2 size-[200px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(229,34,39,0.2)_0%,transparent_70%)] blur-[80px]" />
      </div>

      <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-8">
        <img
          src="https://static.fizzspace.cn/static/pc/logo.png"
          alt="FizzDragon"
          className="h-10 object-contain"
        />

        {uiState === "loading" && (
          <GlassCard className="gap-4 py-16">
            <IconLoader2 className="size-10 animate-spin text-[#E52227]" />
            <span className="text-sm text-white/60">{t("loading")}</span>
          </GlassCard>
        )}

        {uiState === "error" && (
          <GlassCard>
            <IconCircle tone="error">
              <IconAlertCircle className="size-7" />
            </IconCircle>
            <h2 className="m-0 text-xl font-semibold text-white">{t("errorTitle")}</h2>
            <p className="m-0 text-sm leading-relaxed text-white/60">{errorMessage}</p>
            <Button onClick={handleGoHome} className="h-11 w-full">
              {t("backHome")}
            </Button>
          </GlassCard>
        )}

        {uiState === "alreadyJoined" && (
          <GlassCard>
            <IconCircle tone="success">
              <IconCheck className="size-7" />
            </IconCircle>
            <h2 className="m-0 text-xl font-semibold text-white">{t("alreadyJoinedTitle")}</h2>
            <p className="m-0 text-sm leading-relaxed text-white/60">
              {t("alreadyJoinedDesc", { projectName })}
            </p>
            <Button onClick={() => void goToWorkspace(projectId, worldId)} className="h-11 w-full">
              {t("enterProject")}
            </Button>
          </GlassCard>
        )}

        {uiState === "confirm" && (
          <GlassCard>
            <h2 className="m-0 text-xl font-semibold text-white">{t("title")}</h2>
            <div className="flex w-full flex-col gap-1 rounded-xl bg-white/[0.03] p-4">
              <span className="text-xs text-white/50">{t("projectName")}</span>
              <span className="text-lg font-semibold text-white">{projectName}</span>
            </div>
            <p className="m-0 text-sm leading-relaxed text-white/60">{t("desc")}</p>
            <div className="mt-2 flex w-full gap-3">
              <Button
                variant="outline"
                color="muted"
                onClick={handleGoHome}
                className="h-11 flex-1"
              >
                {t("decline")}
              </Button>
              <Button onClick={handleApply} disabled={applying} className="h-11 flex-1">
                {applying ? <IconLoader2 className="size-4 animate-spin" /> : null}
                {t("accept")}
              </Button>
            </div>
          </GlassCard>
        )}

        {uiState === "applied" && (
          <GlassCard>
            <IconCircle tone="success">
              <IconCheck className="size-7" />
            </IconCircle>
            <h2 className="m-0 text-xl font-semibold text-white">{t("applySuccessTitle")}</h2>
            <p className="m-0 text-sm leading-relaxed text-white/60">{t("applySuccessDesc")}</p>
            <div className="mt-2 flex w-full gap-3">
              <Button
                variant="outline"
                color="muted"
                onClick={handleGoHome}
                className="h-11 flex-1"
              >
                {t("backHome")}
              </Button>
              <Button onClick={handleManualCheck} disabled={checking} className="h-11 flex-1">
                {checking ? <IconLoader2 className="size-4 animate-spin" /> : null}
                {checking ? t("checking") : t("refresh")}
              </Button>
            </div>
          </GlassCard>
        )}
      </div>
    </div>
  );
}

// ─── Presentational helpers (local to this page) ───────────────────

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative flex w-full flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center backdrop-blur-xl before:absolute before:inset-x-[20%] before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)] ${className}`}
    >
      {children}
    </div>
  );
}

function IconCircle({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  const toneClass =
    tone === "error"
      ? "bg-[#E52227]/15 border-[#E52227]/30 text-[#E52227]"
      : "bg-green-500/15 border-green-500/30 text-green-500";
  return (
    <div className={`flex size-16 items-center justify-center rounded-full border-2 ${toneClass}`}>
      {children}
    </div>
  );
}
