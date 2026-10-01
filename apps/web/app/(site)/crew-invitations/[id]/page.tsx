"use client";

import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconSignature,
  IconUsers,
} from "@tabler/icons-react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import { useCurrentUser } from "@/src/hooks/use-user";
import { Button } from "@/components/ui/button";
import {
  useAcceptCrewInvitation,
  useDeclineCrewInvitation,
  useMyCrewInvitation,
} from "@/app/(site)/crews/_hooks/use-crew";
import { useTranslations } from "@/src/i18n/i18n";
import { getCurrentLocale, localizePath } from "@/src/i18n/locale-url";

export default function CrewInvitationPage() {
  const t = useTranslations("crewInvitations");
  const roleT = useTranslations("crewRoles");
  const setupT = useTranslations("crewSetup");
  const { user, isLoading: accountLoading } = useCurrentUser();
  const { open: openAuthDialog } = useAuthDialog();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const invitationId = params.id;
  const invitation = useMyCrewInvitation(invitationId);
  const accept = useAcceptCrewInvitation(invitationId);
  const decline = useDeclineCrewInvitation(invitationId);

  if (accountLoading || invitation.isLoading) {
    return (
      <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-[#08090b] px-6">
        <div
          role="status"
          className="size-7 animate-spin rounded-full border-2 border-white/15 border-t-white"
        />
      </main>
    );
  }

  if (!user) {
    return (
      <StateCard
        icon={<IconUsers className="size-5" />}
        title={t("signIn")}
        body={t("signInRequired")}
        action={
          <Button className="mt-5" onClick={() => openAuthDialog()}>
            {t("signIn")}
          </Button>
        }
      />
    );
  }

  if (invitation.isError || !invitation.data) {
    return (
      <StateCard
        icon={<IconAlertTriangle className="size-5 text-red-400" />}
        title={t("notFoundTitle")}
        body={invitation.error instanceof Error ? invitation.error.message : t("notFoundBody")}
      />
    );
  }

  const item = invitation.data;
  const crew = item.crew;
  const pending = item.status === "pending";

  const handleAccept = async () => {
    try {
      const result = await accept.mutateAsync();
      toast.success(t("accepted"));
      router.replace(localizePath(result.workspaceHref, getCurrentLocale()));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
    }
  };

  const handleDecline = async () => {
    try {
      await decline.mutateAsync();
      toast.success(t("declined"));
      void invitation.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("actionFailed"));
    }
  };

  return (
    <main className="min-h-[calc(100dvh-4rem)] bg-[#08090b] px-5 py-16 text-white sm:px-8">
      <section className="mx-auto w-full max-w-[620px]">
        <div className="mb-8 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/40">
          <IconUsers className="size-4" />
          {t("eyebrow")}
        </div>

        <div className="overflow-hidden rounded-2xl bg-[#111318] ring-1 ring-white/10">
          <div className="relative h-44 bg-[#17191f]">
            {crew?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={crew.logo} alt="" className="size-full object-cover opacity-30" />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-[#111318] via-[#111318]/35 to-transparent" />
            <div className="absolute bottom-5 left-6 flex items-end gap-4">
              <div className="flex size-16 items-center justify-center overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/15">
                {crew?.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={crew.logo} alt="" className="size-full object-cover" />
                ) : (
                  <IconUsers className="size-7 text-white/55" />
                )}
              </div>
              <div>
                <p className="text-[11px] text-white/45">{t("invitedTo")}</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                  {crew?.name ?? t("crew")}
                </h1>
              </div>
            </div>
          </div>

          <div className="px-6 pb-6 pt-5">
            <p className="max-w-lg text-sm leading-6 text-white/62">{crew?.tagline || t("body")}</p>

            <dl className="mt-7 divide-y divide-white/[0.07] border-y border-white/[0.07]">
              <InfoRow
                label={t("expires")}
                value={new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                  new Date(item.expiresAt)
                )}
              />
              <InfoRow label={t("statusLabel")} value={t(`status.${item.status}`)} />
            </dl>

            {item.positionCategory && (
              <p className="mt-4 text-sm">
                {setupT("invitedRole", { role: roleT(item.positionCategory) })}
              </p>
            )}
            {item.agreementRequest ? (
              <div className="mt-5 rounded-xl bg-white/[0.035] p-4 ring-1 ring-white/[0.08]">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <IconSignature className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-white/85">
                        {item.agreementRequest.title}
                      </p>
                      <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-white/45">
                        {t("agreementOptional")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-white/42">
                      {item.agreementRequest.signerName} · {item.agreementRequest.signerEmail}
                    </p>
                    <p className="mt-3 text-xs leading-5 text-white/52">
                      {item.agreementRequest.agreementId
                        ? t("agreementQueued")
                        : t("agreementAfterAccept")}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            {pending ? (
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  color="muted"
                  onClick={() => void handleDecline()}
                  disabled={accept.isPending || decline.isPending}
                >
                  {t("decline")}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleAccept()}
                  disabled={accept.isPending || decline.isPending}
                  icon={<IconCheck />}
                >
                  {accept.isPending ? t("accepting") : t("accept")}
                </Button>
              </div>
            ) : (
              <div className="mt-6 flex items-center gap-2 rounded-xl bg-white/[0.04] px-4 py-3 text-sm text-white/62">
                <IconClock className="size-4" />
                {t(`finished.${item.status}`)}
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 text-sm">
      <dt className="text-white/40">{label}</dt>
      <dd className="text-right text-white/80">{value}</dd>
    </div>
  );
}

function StateCard({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-[#08090b] px-6 text-white">
      <section className="w-full max-w-md rounded-2xl bg-[#111318] p-7 ring-1 ring-white/10">
        <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-white/[0.05]">
          {icon}
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-white/50">{body}</p>
        {action}
      </section>
    </main>
  );
}
