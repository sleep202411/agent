"use client";

import { Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconLoader2,
  IconMask,
  IconRosetteDiscountCheck,
  IconUser,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import { useCharacters } from "@/app/[locale]/(studio)/characters/_lib/use-characters";
import {
  acceptCastingInvite,
  characterApiErrorCode,
  characterMediaContentUrl,
  previewCastingInvite,
  REAL_PERSON_GRANT_CONSENT_VERSION,
  type CastingInvitePreview,
  type CharacterSummary,
} from "@/lib/characters-api";
import { ProjectGrantConsent } from "@/app/[locale]/(studio)/characters/_components/project-grant-consent";

/** Actor casting-accept landing — lend your verified face to a project you were
 *  invited to, without joining it. Outside the (studio) group, so it owns a
 *  minimal centered shell (mirrors the invite-accept page). */
export default function CastingAcceptPage() {
  return (
    <Suspense fallback={<CenteredSpinner />}>
      <CastingAcceptInner />
    </Suspense>
  );
}

function CenteredSpinner() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
    </main>
  );
}

function CastingAcceptInner() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const { user } = useAuth();
  const { workspaces } = useWorkspace();
  const workspaceId = workspaces.find((w) => w.isDefault)?.id ?? null;
  return (
    <CastingAcceptContent key={JSON.stringify([token, user?.id, workspaceId])} token={token} />
  );
}

function CastingAcceptContent({ token }: { token: string }) {
  const t = useTranslations("characters");
  const tc = useTranslations("common");
  const ti = useTranslations("invite");
  const router = useRouter();
  const { user, loading: authLoading, signIn } = useAuth();
  const { workspaces, loading: wsLoading } = useWorkspace();
  const userId = user?.id == null ? null : String(user.id);

  const [step, setStep] = useState<"pick" | "consent" | "done">("pick");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [consentRead, setConsentRead] = useState(false);
  const [consentAttested, setConsentAttested] = useState(false);

  // Include the signed-in user in the key so a sign-in (which resolves the
  // initial 401 for a signed-out actor) refetches the preview automatically.
  const previewQ = useQuery<CastingInvitePreview, ApiRequestError>({
    queryKey: ["casting-preview", token, userId ?? "anon"],
    queryFn: ({ signal }) => previewCastingInvite(token, signal),
    enabled: token.length > 0,
    retry: false,
  });

  // The actor's own likenesses live in their default workspace.
  const defaultWorkspaceId = useMemo(
    () => workspaces.find((w) => w.isDefault)?.id ?? null,
    [workspaces]
  );
  const charactersQ = useCharacters(user ? defaultWorkspaceId : null);
  const likenesses = useMemo(
    () => (charactersQ.data ?? []).filter((c) => c.kind === "real_person" && c.status === "active"),
    [charactersQ.data]
  );

  const active = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, []);
  const accept = async () => {
    if (
      !mounted.current ||
      active.current ||
      !userId ||
      !characterId ||
      !consentRead ||
      !consentAttested ||
      charactersQ.isError ||
      !likenesses.some((c) => c.id === characterId) ||
      !previewQ.data?.acceptable ||
      previewQ.data.status !== "pending"
    )
      return;
    const claim = new AbortController();
    active.current = claim;
    setPending(true);
    const current = () => mounted.current && active.current === claim;
    try {
      await acceptCastingInvite(
        token,
        characterId,
        { version: REAL_PERSON_GRANT_CONSENT_VERSION, adultAttested: true },
        claim.signal
      );
      if (current()) setStep("done");
    } catch (error) {
      if (!current()) return;
      const code = characterApiErrorCode(error);
      // Consent rejected → re-surface the gated consent screen.
      if (code === "CONSENT_REQUIRED") {
        setConsentRead(false);
        setConsentAttested(false);
        setStep("consent");
        toast.error(t("errorConsentRequired"));
        return;
      }
      const map: Record<string, string> = {
        ENROLLMENT_REQUIRED: t("castingErrorEnrollmentRequired"),
        CASTING_INVITE_NOT_YOURS: t("castingErrorNotYours"),
        CASTING_INVITE_NOT_PENDING: t("castingErrorNotPending"),
        CHARACTER_SUBJECT_MISMATCH: t("errorSubjectMismatch"),
      };
      toast.error(
        (code && map[code]) ||
          (error instanceof ApiRequestError ? error.message : t("castingAcceptFailed"))
      );
    } finally {
      if (current()) {
        active.current = null;
        setPending(false);
      }
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-sm font-semibold tracking-tight text-muted-foreground">
          <IconMask className="size-4" />
          {tc("fizzStudio")}
        </div>
        <div className="rounded-2xl bg-card p-6">{renderBody()}</div>
      </div>
    </main>
  );

  function renderBody() {
    if (!token) {
      return (
        <Shell
          icon={<IconAlertTriangle className="size-6" />}
          title={t("castingInvalidTitle")}
          body={t("castingInvalidBody")}
        >
          <GoHome />
        </Shell>
      );
    }

    if (authLoading || previewQ.isLoading) {
      return (
        <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
          <IconLoader2 className="size-6 animate-spin" />
          <p className="text-sm">{t("castingLoading")}</p>
        </div>
      );
    }

    if (previewQ.isError) {
      if (!user) {
        return (
          <Shell
            icon={<IconMask className="size-6" />}
            title={t("castingSignInTitle")}
            body={t("castingSignInBody")}
          >
            <Button className="w-full" onClick={signIn}>
              {t("signIn")}
            </Button>
          </Shell>
        );
      }
      const missing = [404, 410].includes(previewQ.error.status);
      return (
        <Shell
          icon={<IconAlertTriangle className="size-6" />}
          title={ti("unavailableTitle")}
          body={previewQ.error.message || ti(missing ? "invalidBody" : "previewFailed")}
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
            <GoHome />
          </div>
        </Shell>
      );
    }

    const preview = previewQ.data;
    if (!preview) return null;

    // Accepting always needs the actor's identity (they lend their OWN
    // likeness). If the preview is public but nobody is signed in, prompt first.
    if (!user && step !== "done") {
      return (
        <Shell
          icon={<IconMask className="size-6" />}
          title={t("castingSignInTitle")}
          body={t("castingSignInBody")}
        >
          <Button className="w-full" onClick={signIn}>
            {t("signIn")}
          </Button>
        </Shell>
      );
    }

    if (step === "done") {
      return (
        <Shell
          icon={<IconRosetteDiscountCheck className="size-6" />}
          title={t("castingDoneTitle")}
          body={t("castingDoneBody", { project: preview.projectName })}
        >
          <Button
            className="w-full"
            onClick={() => router.replace(`/project/${preview.projectId}`)}
          >
            {t("castingOpenProject")}
          </Button>
        </Shell>
      );
    }

    if (preview.status !== "pending" || !preview.acceptable) {
      const body =
        preview.status === "accepted"
          ? t("castingAlreadyAccepted")
          : preview.status === "expired"
            ? t("castingExpiredBody")
            : preview.status === "revoked" || preview.status === "declined"
              ? t("castingRevokedBody")
              : t("castingNotAcceptableBody");
      return (
        <Shell
          icon={<IconAlertTriangle className="size-6" />}
          title={t("castingUnavailableTitle")}
          body={body}
        >
          <GoHome />
        </Shell>
      );
    }

    // Consent step.
    if (step === "consent") {
      return (
        <div>
          <div className="mb-4 text-center">
            <h1 className="text-lg font-semibold">{t("castingConsentHeading")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("castingConsentSub", { project: preview.projectName })}
            </p>
          </div>
          <ProjectGrantConsent
            projectName={preview.projectName}
            read={consentRead}
            onRead={() => setConsentRead(true)}
            attested={consentAttested}
            onAttestedChange={setConsentAttested}
            disabled={pending}
          />
          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setStep("pick")}
              disabled={pending}
            >
              {tc("back")}
            </Button>
            <Button
              className="flex-1"
              disabled={pending || !consentRead || !consentAttested || !characterId}
              title={REAL_PERSON_GRANT_CONSENT_VERSION}
              onClick={() => void accept()}
            >
              {pending ? <IconLoader2 data-icon="inline-start" className="animate-spin" /> : null}
              {t("castingAccept")}
            </Button>
          </div>
        </div>
      );
    }

    // Pick-a-likeness step.
    const loadingLikenesses = wsLoading || (defaultWorkspaceId !== null && charactersQ.isPending);
    return (
      <div>
        <div className="mb-4 text-center">
          <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-secondary text-foreground">
            <IconMask className="size-6" />
          </span>
          <h1 className="text-lg font-semibold">
            {t("castingPickTitle", { project: preview.projectName })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("castingPickBody")}</p>
        </div>

        {loadingLikenesses ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <IconLoader2 className="size-5 animate-spin" />
          </div>
        ) : likenesses.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">{t("castingNoLikenessBody")}</p>
            <Button
              variant="secondary"
              className="w-full"
              // Preserve the token so the actor can return to this invite after
              // enrolling (the link itself carries the token).
              onClick={() => router.push("/characters")}
            >
              {t("castingEnrollFirst")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("castingEnrollThenReturn")}</p>
          </div>
        ) : (
          <>
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {likenesses.map((character) => (
                <LikenessRow
                  key={character.id}
                  character={character}
                  selected={characterId === character.id}
                  onSelect={() => setCharacterId(character.id)}
                />
              ))}
            </div>
            <Button
              className="mt-4 w-full"
              disabled={!characterId}
              onClick={() => setStep("consent")}
            >
              {tc("next")}
            </Button>
          </>
        )}
      </div>
    );
  }
}

function LikenessRow({
  character,
  selected,
  onSelect,
}: {
  character: CharacterSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors",
        selected ? "bg-white/[0.09]" : "hover:bg-white/[0.05]"
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.06]">
        {character.coverAssetId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={characterMediaContentUrl(character.coverAssetId)}
            alt={character.name}
            className="size-full object-cover"
          />
        ) : (
          <IconUser className="size-5 text-white/70" stroke={1.7} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{character.name}</span>
      {selected && <IconRosetteDiscountCheck className="size-4 shrink-0 text-white" stroke={1.8} />}
    </button>
  );
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

function GoHome() {
  const t = useTranslations("characters");
  const router = useRouter();
  return (
    <Button variant="secondary" className="w-full" onClick={() => router.replace("/canvas")}>
      {t("castingGoToFizzStudio")}
    </Button>
  );
}
