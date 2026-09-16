"use client";

import { isCrewCursorError } from "@/app/(site)/crews/_hooks/api";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertCircle,
  IconArchive,
  IconCheck,
  IconDownload,
  IconExternalLink,
  IconSignature,
  IconLoader2,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCreateCrewAgreement,
  useCreateCrewAgreementSigningSession,
  useCrewAgreements,
  useRetryCrewAgreementSend,
  useRetryCrewAgreementArchive,
  useSyncCrewAgreement,
  type CrewAgreementStatus,
  type CrewAgreementView,
  type CrewMemberDTO,
} from "@/app/(site)/crews/_hooks/use-crew";
import { displayNameOf, useUserDisplays } from "@/app/(site)/crews/_hooks/use-users";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";

interface CrewAgreementsDialogProps {
  crewId: string;
  members: CrewMemberDTO[];
  isOwner: boolean;
  focusAgreementId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CrewAgreementsDialog(props: CrewAgreementsDialogProps) {
  const { user } = useCurrentUser();
  if (!props.open) return null;
  return <AgreementSession key={JSON.stringify([user?.id, props.crewId])} {...props} />;
}

function AgreementSession({
  crewId,
  members,
  isOwner,
  focusAgreementId,
  open,
  onOpenChange,
}: CrewAgreementsDialogProps) {
  const t = useTranslations("crewAgreements");
  const tc = useTranslations("common");
  const [view, setView] = useState<CrewAgreementView>("all");
  const agreements = useCrewAgreements(crewId, open, view);
  const createAgreement = useCreateCrewAgreement(crewId);
  const createSigningSession = useCreateCrewAgreementSigningSession();
  const syncAgreement = useSyncCrewAgreement(crewId);
  const retrySend = useRetryCrewAgreementSend(crewId);
  const retryArchive = useRetryCrewAgreementArchive(crewId);
  const displays = useUserDisplays(members.map((member) => member.userId));
  const [composing, setComposing] = useState(false);
  const [memberUserId, setMemberUserId] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [title, setTitle] = useState("");
  const alive = useRef(false);
  const operations = useRef(new Set<string>());
  const signingWindows = useRef(new Map<string, Window>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  useLayoutEffect(() => {
    alive.current = true;
    const windows = signingWindows.current;
    return () => {
      alive.current = false;
      for (const popup of windows.values()) popup.close();
      windows.clear();
    };
  }, []);
  const begin = (key: string) => {
    if (!alive.current || operations.current.has(key)) return false;
    operations.current.add(key);
    setPending(new Set(operations.current));
    return true;
  };
  const finish = (key: string) => {
    if (!alive.current) return;
    operations.current.delete(key);
    setPending(new Set(operations.current));
  };
  const creating = pending.has("create");

  const memberOptions = useMemo(
    () =>
      members.map((member) => ({
        value: member.userId,
        label: displayNameOf(member.userId, displays),
      })),
    [displays, members]
  );
  const payload = agreements.data;
  const canCreate = isOwner && payload?.capabilities.create === true;
  const focusedAgreementLoaded = Boolean(
    focusAgreementId && payload?.items.some((agreement) => agreement.id === focusAgreementId)
  );

  useEffect(() => {
    if (open && focusAgreementId) setView("all");
  }, [focusAgreementId, open]);

  useEffect(() => {
    if (
      !open ||
      !focusAgreementId ||
      !payload ||
      focusedAgreementLoaded ||
      !agreements.hasNextPage ||
      agreements.isFetching ||
      agreements.isError
    ) {
      return;
    }
    void agreements.fetchNextPage();
  }, [agreements, focusAgreementId, focusedAgreementLoaded, open, payload]);

  useEffect(() => {
    if (!open || !focusAgreementId || !focusedAgreementLoaded) return;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`crew-agreement-${focusAgreementId}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAgreementId, focusedAgreementLoaded, open]);

  const resetComposer = () => {
    setComposing(false);
    setMemberUserId("");
    setSignerName("");
    setSignerEmail("");
    setTitle("");
  };

  const chooseMember = (userId: string) => {
    setMemberUserId(userId);
    setSignerName(displayNameOf(userId, displays));
  };

  const create = async () => {
    if (
      !canCreate ||
      !memberUserId ||
      !signerName.trim() ||
      !signerEmail.trim() ||
      !title.trim() ||
      !begin("create")
    )
      return;
    try {
      await createAgreement.mutateAsync({
        memberUserId,
        signerName: signerName.trim(),
        signerEmail: signerEmail.trim(),
        title: title.trim(),
      });
      if (!alive.current) return;
      toast.success(t("queued"));
      resetComposer();
    } catch (error) {
      if (alive.current) toast.error(error instanceof Error ? error.message : t("sendFailed"));
    } finally {
      finish("create");
    }
  };

  const runAgreementAction = async (
    id: string,
    action: () => Promise<unknown>,
    success: string,
    failure: string
  ) => {
    if (!begin(id)) return;
    try {
      await action();
      if (alive.current) toast.success(t(success));
    } catch (error) {
      if (alive.current) toast.error(error instanceof Error ? error.message : t(failure));
    } finally {
      finish(id);
    }
  };

  const openSigningSession = async (agreementId: string) => {
    if (!begin(agreementId)) return;
    let signingWindow: Window | null = null;
    try {
      signingWindow = window.open("about:blank", "_blank", "popup");
      if (!signingWindow) {
        toast.error(t("popupBlocked"));
        return;
      }
      signingWindows.current.set(agreementId, signingWindow);
      signingWindow.opener = null;
      signingWindow.document.title = t("openingSigning");
      const session = await createSigningSession.mutateAsync(agreementId);
      if (!alive.current || signingWindow.closed) return;
      signingWindow.location.replace(session.signLink);
    } catch (error) {
      signingWindow?.close();
      if (alive.current) toast.error(error instanceof Error ? error.message : t("signingFailed"));
    } finally {
      signingWindows.current.delete(agreementId);
      finish(agreementId);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetComposer();
        onOpenChange(next);
      }}
    >
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-white/[0.07] px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <IconSignature className="size-5 text-primary" />
                {t("title")}
              </DialogTitle>
              <DialogDescription className="mt-1">{t("subtitle")}</DialogDescription>
            </div>
            {canCreate && !composing ? (
              <Button size="sm" onClick={() => setComposing(true)} icon={<IconPlus />}>
                {t("newAgreement")}
              </Button>
            ) : null}
          </div>
        </DialogHeader>

        <DialogBody className="max-h-[70dvh] overflow-y-auto">
          {isOwner && payload && !payload.capabilities.create ? (
            <div className="mb-4 flex gap-3 rounded-xl bg-amber-500/[0.08] px-4 py-3 text-xs leading-5 text-amber-200/80 ring-1 ring-amber-400/15">
              <IconAlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{t("notConfigured")}</span>
            </div>
          ) : null}

          {composing ? (
            <div className="mb-5 rounded-xl bg-white/[0.025] p-4 ring-1 ring-white/[0.08]">
              <FieldGroup>
                <Field>
                  <FieldLabel required>{t("member")}</FieldLabel>
                  <Select value={memberUserId} onValueChange={chooseMember} disabled={creating}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("chooseMember")} />
                    </SelectTrigger>
                    <SelectContent>
                      {memberOptions.map((member) => (
                        <SelectItem key={member.value} value={member.value}>
                          {member.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel required>{t("signerName")}</FieldLabel>
                    <Input
                      disabled={creating}
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel required>{t("signerEmail")}</FieldLabel>
                    <Input
                      disabled={creating}
                      type="email"
                      value={signerEmail}
                      onChange={(e) => setSignerEmail(e.target.value)}
                      placeholder="name@example.com"
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel required>{t("agreementTitle")}</FieldLabel>
                  <Input
                    disabled={creating}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("agreementTitlePlaceholder")}
                  />
                </Field>
              </FieldGroup>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" color="muted" disabled={creating} onClick={resetComposer}>
                  {t("cancel")}
                </Button>
                <Button
                  disabled={
                    creating ||
                    !memberUserId ||
                    !signerName.trim() ||
                    !signerEmail.trim() ||
                    !title.trim()
                  }
                  onClick={() => void create()}
                  icon={creating ? <IconLoader2 className="animate-spin" /> : <IconSignature />}
                >
                  {creating ? t("queueing") : t("queueWithBoldSign")}
                </Button>
              </div>
            </div>
          ) : null}

          {payload ? (
            <div
              className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-white/[0.035] p-1"
              aria-label={t("filterLabel")}
            >
              {(["all", "active", "signed", "attention"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={cn(
                    "shrink-0 rounded-md px-3 py-1.5 text-xs transition-colors",
                    view === option
                      ? "bg-white/[0.11] text-white"
                      : "text-white/45 hover:bg-white/[0.05] hover:text-white/75"
                  )}
                >
                  {t(`filter.${option}`)} {payload.summary[option]}
                </button>
              ))}
            </div>
          ) : null}

          {agreements.isError ? (
            <div role="alert" className="py-4 text-center">
              <p className="text-sm text-destructive">
                {agreements.error instanceof Error ? agreements.error.message : t("loadFailed")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                color="muted"
                className="mt-3"
                disabled={agreements.isFetching}
                onClick={() =>
                  void (agreements.isFetchNextPageError &&
                  !isCrewCursorError(agreements.error, "CREW_AGREEMENT_CURSOR_INVALID")
                    ? agreements.fetchNextPage()
                    : agreements.refetch())
                }
              >
                {tc("retry")}
              </Button>
            </div>
          ) : null}
          {agreements.isLoading && !payload ? (
            <div className="flex h-36 items-center justify-center">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : payload?.items.length ? (
            <>
              <div className="divide-y divide-white/[0.065]">
                {payload.items.map((agreement) => {
                  const busy = pending.has(agreement.id);
                  const syncing = busy && syncAgreement.isPending;
                  const retrying = busy && retryArchive.isPending;
                  const retryingSend = busy && retrySend.isPending;
                  return (
                    <div
                      key={agreement.id}
                      id={`crew-agreement-${agreement.id}`}
                      className={cn(
                        "flex items-start gap-4 rounded-xl py-4 first:pt-0",
                        focusAgreementId === agreement.id &&
                          "bg-primary/[0.055] px-3 ring-1 ring-primary/25"
                      )}
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05]">
                        <IconSignature className="size-4 text-white/55" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-foreground">
                            {agreement.title}
                          </p>
                          <StatusPill status={agreement.status} t={t} />
                        </div>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                          {agreement.signerName} · {agreement.signerEmail}
                        </p>
                        <AgreementArchiveState archive={agreement.archive} t={t} />
                        <AgreementDeliveryState delivery={agreement.delivery} t={t} />
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {agreement.capabilities.sign ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="solid"
                            color="primary"
                            disabled={busy}
                            onClick={() => void openSigningSession(agreement.id)}
                            icon={
                              busy && createSigningSession.isPending ? (
                                <IconLoader2 className="animate-spin" />
                              ) : (
                                <IconExternalLink />
                              )
                            }
                          >
                            {busy && createSigningSession.isPending
                              ? t("openingSigning")
                              : t("reviewAndSign")}
                          </Button>
                        ) : null}
                        {agreement.delivery.canRetry ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            color="warning"
                            disabled={busy}
                            onClick={() =>
                              void runAgreementAction(
                                agreement.id,
                                () => retrySend.mutateAsync(agreement.id),
                                "sendRetrying",
                                "sendRetryFailed"
                              )
                            }
                            icon={
                              retryingSend ? (
                                <IconLoader2 className="animate-spin" />
                              ) : (
                                <IconRefresh />
                              )
                            }
                          >
                            {t("sendRetry")}
                          </Button>
                        ) : null}
                        {agreement.archive.canRetry ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            color="warning"
                            disabled={busy}
                            onClick={() =>
                              void runAgreementAction(
                                agreement.id,
                                () => retryArchive.mutateAsync(agreement.id),
                                "archiveRetrying",
                                "archiveRetryFailed"
                              )
                            }
                            icon={
                              retrying ? <IconLoader2 className="animate-spin" /> : <IconArchive />
                            }
                          >
                            {t("archiveRetry")}
                          </Button>
                        ) : null}
                        {payload.capabilities.sync && agreement.providerDocumentId ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            color="muted"
                            disabled={busy}
                            onClick={() =>
                              void runAgreementAction(
                                agreement.id,
                                () => syncAgreement.mutateAsync(agreement.id),
                                "synced",
                                "syncFailed"
                              )
                            }
                            icon={
                              syncing ? <IconLoader2 className="animate-spin" /> : <IconRefresh />
                            }
                          >
                            {t("sync")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {agreements.hasNextPage && !agreements.isError ? (
                <div className="border-t border-white/[0.065] pt-3 text-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    color="muted"
                    disabled={agreements.isFetching}
                    onClick={() => void agreements.fetchNextPage()}
                    icon={
                      agreements.isFetchingNextPage ? (
                        <IconLoader2 className="animate-spin" />
                      ) : undefined
                    }
                  >
                    {agreements.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
                  </Button>
                </div>
              ) : null}
            </>
          ) : agreements.isError ? null : (
            <div className="py-14 text-center">
              <IconCheck className="mx-auto size-6 text-white/25" />
              <p className="mt-3 text-sm text-white/55">
                {view === "all" ? t("empty") : t("emptyFiltered")}
              </p>
              <p className="mt-1 text-xs text-white/32">
                {view === "all" ? t("emptyHint") : t("emptyFilteredHint")}
              </p>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" color="muted" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgreementDeliveryState({
  delivery,
  t,
}: {
  delivery: import("@/app/(site)/crews/_hooks/use-crew").CrewAgreementDTO["delivery"];
  t: ReturnType<typeof useTranslations>;
}) {
  if (delivery.status === "completed") return null;
  if (delivery.status === "failed") {
    return (
      <div className="mt-2">
        <p className="inline-flex items-center gap-1 text-[11px] text-amber-300/80">
          <IconAlertCircle className="size-3" />
          {t("sendDispatchFailed")}
        </p>
        {delivery.error ? (
          <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-white/32">{delivery.error}</p>
        ) : null}
      </div>
    );
  }
  return (
    <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/40">
      <IconLoader2 className="size-3 animate-spin" />
      {delivery.status === "processing" ? t("dispatching") : t("sendQueued")}
    </p>
  );
}

function AgreementArchiveState({
  archive,
  t,
}: {
  archive: import("@/app/(site)/crews/_hooks/use-crew").CrewAgreementDTO["archive"];
  t: ReturnType<typeof useTranslations>;
}) {
  if (archive.status === "not_applicable") return null;
  if (archive.status === "ready") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1 text-emerald-300/80">
          <IconArchive className="size-3" />
          {t("archiveReady")}
        </span>
        {archive.signedDocumentUrl ? (
          <a
            className="inline-flex items-center gap-1 text-white/50 transition-colors hover:text-white/80"
            href={archive.signedDocumentUrl}
            target="_blank"
            rel="noreferrer"
          >
            <IconDownload className="size-3" />
            {t("signedDocument")}
          </a>
        ) : null}
        {archive.auditTrailUrl ? (
          <a
            className="inline-flex items-center gap-1 text-white/50 transition-colors hover:text-white/80"
            href={archive.auditTrailUrl}
            target="_blank"
            rel="noreferrer"
          >
            <IconDownload className="size-3" />
            {t("auditTrail")}
          </a>
        ) : null}
      </div>
    );
  }
  if (archive.status === "failed") {
    return (
      <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-amber-300/80">
        <IconAlertCircle className="size-3" />
        {t("archiveFailed")}
      </p>
    );
  }
  return (
    <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/40">
      <IconLoader2 className="size-3 animate-spin" />
      {archive.status === "processing" ? t("archiving") : t("archiveQueued")}
    </p>
  );
}

function StatusPill({
  status,
  t,
}: {
  status: CrewAgreementStatus;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] uppercase tracking-[0.07em]",
        status === "signed" && "bg-emerald-500/12 text-emerald-300",
        ["sending", "sent"].includes(status) && "bg-blue-500/12 text-blue-300",
        status === "failed" && "bg-red-500/12 text-red-300",
        ["draft", "declined", "expired", "voided"].includes(status) &&
          "bg-white/[0.06] text-white/45"
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}
