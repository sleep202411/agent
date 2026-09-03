"use client";

/**
 * /crew-invite/[token] — the page a crew invite link opens.
 *
 * The route is public so the token is never stranded in a /login redirect
 * chain: a recipient may not have an account yet. The invites API itself is
 * session-gated, so both preview and accept answer a 401 by prompting for
 * sign-in in place (the auth dialog's "stay" mode) and re-running — the link in
 * the address bar never has to survive a round trip.
 *
 * Every closed state — revoked, expired, limit reached, deleted crew — is a
 * flat "ask for a fresh link", never a retry affordance: none of them get
 * better by clicking again.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  IconAlertCircle,
  IconCheck,
  IconLoader2,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useTranslations, useLocale } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import { Button } from "@/components/ui/button";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { CrewApiError, crewApi } from "@/app/(site)/crews/_hooks/api";

interface CrewInvitePreview {
  scope: "crew" | "crew_community";
  crewId: string;
  targetName: string;
  logo: string | null;
  tagline: string | null;
  memberCount: number;
  status: "active" | "revoked" | "expired" | "exhausted";
  expiresAt: string | null;
}

type CrewInviteAccepted =
  | {
      scope: "crew";
      crewId: string;
      memberId: string;
      targetName: string;
      workspaceHref: string;
    }
  | {
      scope: "crew_community";
      crewId: string;
      conversationId: string;
      targetName: string;
      channelHref: string;
    };

type Envelope<T> = { code?: number; data?: T };

/** InvitesController hand-wraps its payload; the crew client does not unwrap. */
function unwrap<T>(body: Envelope<T> | T): T {
  return body && typeof body === "object" && "data" in body
    ? ((body as Envelope<T>).data as T)
    : (body as T);
}

type View =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "closed"; reason: "revoked" | "expired" | "exhausted" }
  | { kind: "removed" }
  | { kind: "signIn" }
  | { kind: "ready"; preview: CrewInvitePreview }
  | {
      kind: "joined";
      scope: "crew" | "crew_community";
      crewName: string;
      destinationHref: string;
    };

export default function CrewInvitePage() {
  const t = useTranslations("crewInvite");
  const tc = useTranslations("crewCommunityInvite");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";

  const [view, setView] = useState<View>(() => (token ? { kind: "loading" } : { kind: "invalid" }));
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  // Preview is session-gated server-side, so a signed-out recipient sees the
  // sign-in prompt first and this re-runs the lookup afterwards.
  const [attempt, setAttempt] = useState(0);
  const { open: openAuthDialog } = useAuthDialog();

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    void (async () => {
      try {
        const body = await crewApi.get<Envelope<CrewInvitePreview> | CrewInvitePreview>(
          "/invites/preview",
          { query: { token } }
        );
        if (cancelled) return;
        const preview = unwrap(body);
        if (preview.scope !== "crew" && preview.scope !== "crew_community") {
          setView({ kind: "invalid" });
          return;
        }
        setView(
          preview.status === "active"
            ? { kind: "ready", preview }
            : { kind: "closed", reason: preview.status }
        );
      } catch (err) {
        if (cancelled) return;
        if (err instanceof CrewApiError && err.status === 401) {
          setView({ kind: "signIn" });
          return;
        }
        setView({ kind: "invalid" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const promptSignIn = useCallback(() => {
    openAuthDialog({
      mode: "stay",
      onSuccess: () => {
        setView({ kind: "loading" });
        setAttempt((n) => n + 1);
      },
    });
  }, [openAuthDialog]);

  const join = useCallback(async () => {
    if (view.kind !== "ready" || joining) return;
    setJoining(true);
    setError("");
    try {
      const body = await crewApi.post<Envelope<CrewInviteAccepted> | CrewInviteAccepted>(
        "/invites/accept",
        { body: { token } }
      );
      const accepted = unwrap(body);
      setView({
        kind: "joined",
        scope: accepted.scope,
        crewName: accepted.targetName,
        destinationHref:
          accepted.scope === "crew_community" ? accepted.channelHref : accepted.workspaceHref,
      });
    } catch (err) {
      if (err instanceof CrewApiError && err.status === 401) {
        // Sign in without leaving: the token stays in the address bar.
        promptSignIn();
        return;
      }
      if (err instanceof CrewApiError && err.status === 403) {
        setView({ kind: "removed" });
        return;
      }
      if (err instanceof CrewApiError && err.status === 409) {
        // Already a member through some other door — that is a success here.
        setView({
          kind: "joined",
          scope: view.preview.scope,
          crewName: view.preview.targetName,
          destinationHref:
            view.preview.scope === "crew_community"
              ? `/crews/${view.preview.crewId}/workspace?tab=chat&channel=community`
              : `/crews/${view.preview.crewId}/workspace`,
        });
        return;
      }
      if (err instanceof CrewApiError && err.status === 410) {
        setView({ kind: "closed", reason: "expired" });
        return;
      }
      setError(err instanceof CrewApiError ? err.message : t("failed"));
    } finally {
      setJoining(false);
    }
  }, [joining, promptSignIn, t, token, view]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] p-5">
      <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur-xl">
        {view.kind === "loading" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <IconLoader2 className="size-9 animate-spin text-[#E52227]" />
            <span className="text-sm text-white/60">{t("loading")}</span>
          </div>
        )}

        {view.kind === "invalid" && <Closed title={t("invalidTitle")} body={t("invalidBody")} />}

        {view.kind === "closed" && (
          <Closed
            title={
              view.reason === "revoked"
                ? t("revokedTitle")
                : view.reason === "exhausted"
                  ? t("exhaustedTitle")
                  : t("expiredTitle")
            }
            body={t("closedBody")}
          />
        )}

        {view.kind === "removed" && <Closed title={t("removedTitle")} body={t("removedBody")} />}

        {view.kind === "signIn" && (
          <div className="flex flex-col items-center gap-5 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-white/[0.06] text-white/50">
              <IconUsers className="size-7" />
            </span>
            <p className="m-0 text-sm leading-relaxed text-white/60">{t("signInPrompt")}</p>
            <Button onClick={promptSignIn} className="h-11 w-full">
              {t("signIn")}
            </Button>
          </div>
        )}

        {view.kind === "ready" && (
          <div className="flex flex-col items-center gap-5 text-center">
            {view.preview.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.preview.logo} alt="" className="size-16 rounded-2xl object-cover" />
            ) : (
              <span className="flex size-16 items-center justify-center rounded-2xl bg-white/[0.06] text-white/60">
                {view.preview.scope === "crew_community" ? (
                  <IconUsersGroup className="size-7" />
                ) : (
                  <IconUsers className="size-7" />
                )}
              </span>
            )}
            <div className="flex flex-col gap-1.5">
              <h1 className="m-0 text-xl font-semibold text-white">
                {view.preview.scope === "crew_community"
                  ? tc("joinTitle", { crew: view.preview.targetName })
                  : t("joinTitle", { crew: view.preview.targetName })}
              </h1>
              {view.preview.tagline ? (
                <p className="m-0 text-sm leading-relaxed text-white/55">{view.preview.tagline}</p>
              ) : null}
              <p className="m-0 text-xs text-white/40">
                {view.preview.scope === "crew_community"
                  ? tc("crewMemberCount", { count: view.preview.memberCount })
                  : t("memberCount", { count: view.preview.memberCount })}
              </p>
            </div>
            {error ? <p className="m-0 text-sm text-[#ff6b6b]">{error}</p> : null}
            <Button onClick={() => void join()} disabled={joining} className="h-11 w-full">
              {joining ? <IconLoader2 className="mr-2 size-4 animate-spin" /> : null}
              {joining
                ? view.preview.scope === "crew_community"
                  ? tc("joining")
                  : t("joining")
                : view.preview.scope === "crew_community"
                  ? tc("join")
                  : t("join")}
            </Button>
          </div>
        )}

        {view.kind === "joined" && (
          <div className="flex flex-col items-center gap-5 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <IconCheck className="size-7" />
            </span>
            <h1 className="m-0 text-xl font-semibold text-white">
              {view.scope === "crew_community"
                ? tc("joined", { crew: view.crewName })
                : t("joined", { crew: view.crewName })}
            </h1>
            <Button
              onClick={() => router.push(localizePath(view.destinationHref, locale))}
              className="h-11 w-full"
            >
              {view.scope === "crew_community" ? tc("openChannel") : t("openWorkspace")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Closed({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-white/[0.06] text-white/50">
        <IconAlertCircle className="size-7" />
      </span>
      <h1 className="m-0 text-xl font-semibold text-white">{title}</h1>
      <p className="m-0 text-sm leading-relaxed text-white/55">{body}</p>
    </div>
  );
}
