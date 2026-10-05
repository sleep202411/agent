"use client";

import { use, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconLink, IconLoader2, IconUsers } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace, WORKSPACES_QUERY_KEY } from "@/app/_components/workspace-context";
import {
  acceptInvite,
  previewInvite,
  type AcceptedInvite,
  type InvitePreview,
} from "@/lib/collab/sharing-api";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Invite-link landing — sign in (if needed) → preview the team/project → accept
 * → route into the workspace. Lives outside the (studio) group, so it owns its
 * own minimal centered shell. The server is the source of truth for whether the
 * link is usable; this only renders the resolved state.
 */
export default function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { user } = useAuth();
  return <InviteAcceptView key={JSON.stringify([token, user?.id])} token={token} />;
}
function InviteAcceptView({ token }: { token: string }) {
  const t = useTranslations("invite");
  const tc = useTranslations("common");
  const tw = useTranslations("workspace");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setActiveWorkspaceId } = useWorkspace();
  const { user, loading: authLoading, signIn } = useAuth();

  const previewQ = useQuery<InvitePreview, ApiRequestError>({
    queryKey: ["invite-preview", token, user?.id ?? null],
    enabled: !authLoading && Boolean(user),
    queryFn: ({ signal }) => previewInvite(token, signal),
    retry: false,
  });

  const [joining, setJoining] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const navigating = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, []);
  function accept() {
    if (!mounted.current || !user || active.current || navigating.current) return;
    const operation = new AbortController();
    active.current = operation;
    setAccepting(true);
    const current = () => mounted.current && active.current === operation;
    void (async () => {
      try {
        const result = await acceptInvite(token, operation.signal);
        if (!current()) return;
        toast.success(
          result.scope === "workspace"
            ? t("joinedTeam")
            : result.scope === "story-project"
              ? t("joinedStory")
              : t("joinedProject")
        );
        enterTarget(result);
      } catch (error) {
        if (current()) toast.error(error instanceof Error ? error.message : t("acceptFailed"));
      } finally {
        if (current()) {
          active.current = null;
          setAccepting(false);
        }
      }
    })();
  }

  function enterTarget(result: AcceptedInvite) {
    if (!mounted.current || navigating.current) return;
    navigating.current = true;
    setJoining(true);
    void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ["home-recent-projects"] });
    setActiveWorkspaceId(result.workspaceId);
    if (result.scope === "workspace") {
      router.replace(`/canvas?ws=${encodeURIComponent(result.workspaceId)}`);
    } else if (result.scope === "story-project") {
      router.replace(
        `/story-studio/projects/${result.storyProjectId}/canvas?ws=${encodeURIComponent(result.workspaceId)}`
      );
    } else {
      router.replace(`/project/${result.projectId}?ws=${encodeURIComponent(result.workspaceId)}`);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-sm font-semibold tracking-tight text-muted-foreground">
          <IconLink className="size-4" />
          {tc("fizzStudio")}
        </div>

        <div className="rounded-2xl bg-card p-6">{renderBody()}</div>
      </div>
    </main>
  );

  function renderBody() {
    if (authLoading || previewQ.isLoading) {
      return (
        <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
          <IconLoader2 className="size-6 animate-spin" />
          <p className="text-sm">{t("loading")}</p>
        </div>
      );
    }

    if (!user) {
      return (
        <Shell
          icon={<IconUsers className="size-6" />}
          title={t("signInTitle")}
          body={t("signInBody")}
        >
          <Button className="w-full" onClick={signIn}>
            {t("signIn")}
          </Button>
        </Shell>
      );
    }

    if (previewQ.isError) {
      const missing = [404, 410].includes(previewQ.error.status);
      return (
        <Shell
          icon={<IconAlertTriangle className="size-6" />}
          title={t("unavailableTitle")}
          body={previewQ.error.message || t(missing ? "invalidBody" : "previewFailed")}
        >
          <div className="flex flex-col gap-2">
            {!missing && (
              <Button
                className="w-full"
                disabled={previewQ.isFetching}
                onClick={() => void previewQ.refetch()}
              >
                {previewQ.isFetching ? <IconLoader2 className="size-4 animate-spin" /> : null}
                {tc("retry")}
              </Button>
            )}
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => router.replace("/canvas")}
            >
              {t("goToFizzStudio")}
            </Button>
          </div>
        </Shell>
      );
    }

    const preview = previewQ.data;
    if (!preview) return null;

    const existingAccess = preview.existingAccess;
    if (existingAccess) {
      return (
        <Shell
          icon={<IconUsers className="size-6" />}
          title={t("alreadyJoinedTitle")}
          body={
            existingAccess.scope === "workspace" && preview.currentRole
              ? t("alreadyWorkspaceMember", {
                  name: existingAccess.targetName,
                  role: tw(`roles.${preview.currentRole}`),
                })
              : t("alreadyJoinedBody", { name: existingAccess.targetName })
          }
        >
          <Button className="w-full" disabled={joining} onClick={() => enterTarget(existingAccess)}>
            {joining ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t(existingAccess.scope === "workspace" ? "enterWorkspace" : "enterProject")}
          </Button>
        </Shell>
      );
    }

    if (preview.status !== "pending") {
      const copy =
        preview.status === "revoked"
          ? t("revokedBody")
          : preview.status === "expired"
            ? t("expiredBody")
            : t("inactiveBody");
      return (
        <Shell
          icon={<IconAlertTriangle className="size-6" />}
          title={t("unavailableTitle")}
          body={copy}
        >
          <Button variant="secondary" className="w-full" onClick={() => router.replace("/canvas")}>
            {t("goToFizzStudio")}
          </Button>
        </Shell>
      );
    }

    const scopeWord = preview.scope === "workspace" ? t("scopeTeam") : t("scopeProject");
    return (
      <Shell
        icon={<IconUsers className="size-6" />}
        title={t("joinTitle", { name: preview.targetName })}
        body={t("joinBody", { scope: scopeWord, role: cap(preview.role) })}
      >
        <Button className="w-full" disabled={accepting || joining} onClick={accept}>
          {accepting || joining ? <IconLoader2 className="size-4 animate-spin" /> : null}
          {t("acceptInvitation")}
        </Button>
      </Shell>
    );
  }
}

function Shell({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-foreground">
        {icon}
      </span>
      <h1 className="mt-4 text-lg font-semibold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <div className="mt-5 w-full">{children}</div>
    </div>
  );
}
