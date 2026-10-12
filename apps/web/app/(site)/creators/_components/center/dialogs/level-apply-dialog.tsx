"use client";

/**
 * Owner-only dialog: apply for a Java certification level.
 * Required: certification level. Crew, IP, attachment and notes may be omitted.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CertificationGuide } from "../certification-guide";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useQuery } from "@tanstack/react-query";
import { IconLoader2, IconPaperclip, IconUpload, IconX } from "@tabler/icons-react";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useMyCrews } from "@/app/(site)/crews/_hooks/use-crew";
import { useAllMyIpCommerceIps } from "@/src/lib/ip-commerce/hooks";
import { ipRoomPath } from "@/src/lib/ip-commerce/urls";
import { ApiRequestError } from "@/src/lib/api";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { Locale } from "@/src/i18n/config";
import { localizePath } from "@/src/i18n/locale-url";
import {
  listMyUserLevelApplications,
  listUserLevelOptions,
  submitUserLevelApply,
  uploadUserLevelApplyAttachment,
  USER_LEVEL_APPLY_ACCEPT,
  USER_LEVEL_APPLY_STATUS,
  type UserLevelOption,
} from "@/src/services/user-level-apply";
import { groupUserLevelOptions, userLevelDisplayCopy } from "@/src/lib/user-level-catalog";

const EXTRA_MAX = 300;

/**
 * Java `user_level.id` for AI Producer — must stay aligned with Nest
 * `CREW_CREATE_LEVEL_ID` in `apps/server/src/integrations/java/user-level-gates.ts`.
 */
export const AI_PRODUCER_LEVEL_ID = 13;

/** Radix Select needs a non-empty value; maps to "no crew / no IP selected". */
const SELECT_NONE = "__none__";

interface LevelApplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Lock the level picker to a single Java `user_level.id` (e.g. AI
   * Producer from the create-crew gate).
   */
  lockedLevelId?: number;
}

export function LevelApplyDialog(props: LevelApplyDialogProps) {
  const { user } = useCurrentUser();
  return props.open && user ? (
    <LevelApplyForm key={`${user.id}:${props.lockedLevelId ?? "any"}`} {...props} />
  ) : null;
}

function LevelApplyForm({ open, onOpenChange, lockedLevelId }: LevelApplyDialogProps) {
  const active = useRef(true);
  const operationPending = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const t = useTranslations("creatorCenter");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const { user } = useCurrentUser();
  const heldLevelIds = new Set((user?.raw.levels ?? []).map((level) => Number(level.id)));
  const levelLocked = lockedLevelId != null;

  const levelsQuery = useQuery({
    queryKey: ["user-levels", "options", locale],
    queryFn: listUserLevelOptions,
    staleTime: 60_000,
  });
  const pendingQuery = useQuery({
    queryKey: ["user-levels", "apply", "mine", USER_LEVEL_APPLY_STATUS.PENDING, locale, user?.id],
    enabled: Boolean(user),
    queryFn: () => listMyUserLevelApplications(USER_LEVEL_APPLY_STATUS.PENDING),
    staleTime: 30_000,
  });
  const crewsQuery = useMyCrews(true);
  const ipsQuery = useAllMyIpCommerceIps(true, { locale });

  const crews = useMemo(() => {
    const founded = crewsQuery.data?.founded ?? [];
    const joined = crewsQuery.data?.joined ?? [];
    const byId = new Map<string, { id: string; name: string }>();
    for (const c of [...founded, ...joined]) {
      if (!c?.id || !c.name) continue;
      byId.set(c.id, { id: c.id, name: c.name });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [crewsQuery.data]);

  const ips = useMemo(() => {
    const items = ipsQuery.data?.items ?? [];
    return items
      .filter((ip) => Boolean(ip.id && ip.title && ip.roomNumber))
      .map((ip) => ({
        id: ip.id,
        title: ip.title,
        roomNumber: ip.roomNumber,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [ipsQuery.data]);

  const levels: UserLevelOption[] = useMemo(() => {
    const rows = levelsQuery.data ?? [];
    const filtered =
      lockedLevelId == null ? rows : rows.filter((l) => Number(l.id) === lockedLevelId);
    return groupUserLevelOptions(filtered).flatMap((row) => row.levels);
  }, [levelsQuery.data, lockedLevelId]);

  const groupedLevels = useMemo(() => groupUserLevelOptions(levels), [levels]);

  const pendingLevelIds = useMemo(() => {
    const ids = new Set<number>();
    for (const row of pendingQuery.data ?? []) {
      if (row?.levelId != null) ids.add(row.levelId);
    }
    return ids;
  }, [pendingQuery.data]);

  const [levelId, setLevelId] = useState<string>(
    lockedLevelId == null ? "" : String(lockedLevelId)
  );
  const [crewId, setCrewId] = useState<string>("");
  const [ipId, setIpId] = useState<string>("");
  const [extraInfo, setExtraInfo] = useState("");
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedLevel = useMemo(
    () => levels.find((l) => String(l.id) === levelId) ?? null,
    [levelId, levels]
  );
  const selectedLevelCopy = selectedLevel ? userLevelDisplayCopy(selectedLevel, t) : null;
  const selectedLevelPending = selectedLevel
    ? !heldLevelIds.has(selectedLevel.id) && pendingLevelIds.has(selectedLevel.id)
    : false;

  function resetForm() {
    setLevelId(lockedLevelId != null ? String(lockedLevelId) : "");
    setCrewId("");
    setIpId("");
    setExtraInfo("");
    setAttachmentPath(null);
    setAttachmentName(null);
    setUploading(false);
    setSubmitting(false);
    setDragOver(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      active.current = false;
      resetForm();
    }
    onOpenChange(next);
  }

  async function handleFileChange(file: File | undefined) {
    if (!file || !active.current || operationPending.current) return;
    operationPending.current = true;
    setUploading(true);
    try {
      const path = await uploadUserLevelApplyAttachment(file);
      if (!active.current) return;
      setAttachmentPath(path);
      setAttachmentName(file.name);
      toast.success(t("levels.apply.uploadSuccess"));
    } catch (err) {
      if (!active.current) return;
      const msg = err instanceof ApiRequestError ? err.message : t("levels.apply.uploadFailed");
      toast.error(msg);
    } finally {
      operationPending.current = false;
      if (active.current) {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    }
  }

  async function handleSubmit() {
    if (!active.current || operationPending.current || pendingQuery.isError || levelsQuery.isError)
      return;
    const level = levels.find((l) => String(l.id) === levelId);
    if (!level) {
      toast.error(t("levels.apply.missingRequired"));
      return;
    }
    const crew = crews.find((c) => c.id === crewId);
    const ip = ips.find((i) => i.id === ipId);
    if (heldLevelIds.has(level.id)) {
      toast.error(t("levels.apply.levelHeldHint"));
      return;
    }
    if (pendingLevelIds.has(level.id)) {
      toast.error(t("levels.apply.levelPendingHint"));
      return;
    }
    const origin = window.location.origin;
    const crewLink = crew ? `${origin}${localizePath(`/crews/${crew.id}`, locale)}` : "";
    const ipLink = ip ? `${origin}${localizePath(ipRoomPath(ip.roomNumber), locale)}` : "";
    const note = extraInfo.trim();
    if (note.length > EXTRA_MAX) {
      toast.error(t("levels.apply.extraTooLong"));
      return;
    }

    operationPending.current = true;
    setSubmitting(true);
    try {
      await submitUserLevelApply({
        levelId: level.id,
        crewName: crew?.name ?? "",
        crewLink,
        ipName: ip?.title ?? "",
        ipLink,
        ...(attachmentPath ? { attachmentUrl: attachmentPath } : {}),
        ...(note ? { extraInfo: note } : {}),
      });
      if (!active.current) return;
      toast.success(t("levels.apply.submitSuccess"));
      void pendingQuery.refetch();
      handleOpenChange(false);
    } catch (err) {
      if (!active.current) return;
      const msg = err instanceof ApiRequestError ? err.message : t("levels.apply.submitFailed");
      toast.error(msg);
    } finally {
      operationPending.current = false;
      if (active.current) setSubmitting(false);
    }
  }

  const loadingLists =
    levelsQuery.isPending || pendingQuery.isPending || crewsQuery.isPending || ipsQuery.isPending;
  const canSubmit =
    !pendingQuery.isError &&
    !levelsQuery.isError &&
    !heldLevelIds.has(Number(levelId)) &&
    Boolean(selectedLevel) &&
    !selectedLevelPending &&
    !submitting &&
    !uploading &&
    !loadingLists;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-md flex-col overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="space-y-1.5 border-b border-border/60 px-5 py-4">
          <DialogTitle>
            {levelLocked ? t("levels.apply.titleAiProducer") : t("levels.apply.title")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {levelLocked ? t("levels.apply.descriptionAiProducer") : t("levels.apply.description")}
          </DialogDescription>
          <a
            className="text-sm text-primary underline underline-offset-4"
            href={`/${locale}/courses`}
          >
            {t("levels.apply.academy")}
          </a>
        </DialogHeader>

        <DialogBody className="space-y-5 px-5 py-4">
          {(pendingQuery.error || levelsQuery.error) && (
            <div role="alert">
              {(pendingQuery.error || levelsQuery.error)?.message}
              <Button
                type="button"
                onClick={() => {
                  void pendingQuery.refetch();
                  void levelsQuery.refetch();
                }}
              >
                {tc("retry")}
              </Button>
            </div>
          )}
          {loadingLists ? (
            <div className="flex h-28 items-center justify-center">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <FieldGroup className="gap-5">
              <Field>
                <div className="flex items-center gap-1">
                  <FieldLabel required className="mb-0">
                    {t("levels.apply.levelLabel")}
                  </FieldLabel>
                  <CertificationGuide />
                </div>
                <Select
                  value={levelId}
                  onValueChange={setLevelId}
                  disabled={levelLocked || levels.length === 0}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder={t("levels.apply.levelPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        {t("levels.apply.levelEmpty")}
                      </SelectItem>
                    ) : (
                      groupedLevels.map((group) => (
                        <SelectGroup key={group.group}>
                          <SelectLabel className="px-2 py-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
                            {t(`levels.groups.${group.group}`)}
                          </SelectLabel>
                          {group.levels.map((level) => {
                            const pending = pendingLevelIds.has(level.id);
                            const held = heldLevelIds.has(level.id);
                            const name = userLevelDisplayCopy(level, t).name;
                            return (
                              <SelectItem
                                key={level.id}
                                value={String(level.id)}
                                disabled={pending || held}
                              >
                                {held
                                  ? t("levels.apply.levelHeldOption", { name })
                                  : pending
                                    ? t("levels.apply.levelPendingOption", { name })
                                    : name}
                              </SelectItem>
                            );
                          })}
                        </SelectGroup>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {heldLevelIds.has(Number(levelId)) && (
                  <FieldDescription>{t("levels.apply.levelHeldHint")}</FieldDescription>
                )}
                {selectedLevelPending ? (
                  <FieldDescription className="mt-1.5 text-[11px] leading-relaxed text-amber-400">
                    {t("levels.apply.levelPendingHint")}
                  </FieldDescription>
                ) : selectedLevelCopy?.description ? (
                  <FieldDescription className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed">
                    {selectedLevelCopy.description}
                  </FieldDescription>
                ) : null}
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{t("levels.apply.crewLabel")}</FieldLabel>
                  <Select
                    value={crewId || SELECT_NONE}
                    onValueChange={(value) => setCrewId(value === SELECT_NONE ? "" : value)}
                  >
                    <SelectTrigger className="h-9 w-full" aria-label={t("levels.apply.crewLabel")}>
                      <SelectValue placeholder={t("levels.apply.crewPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_NONE}>{t("levels.apply.optionalSkip")}</SelectItem>
                      {crews.length === 0 ? (
                        <SelectItem value="__empty_crews" disabled>
                          {t("levels.apply.crewEmpty")}
                        </SelectItem>
                      ) : (
                        crews.map((crew) => (
                          <SelectItem key={crew.id} value={crew.id}>
                            {crew.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel>{t("levels.apply.ipLabel")}</FieldLabel>
                  <Select
                    value={ipId || SELECT_NONE}
                    onValueChange={(value) => setIpId(value === SELECT_NONE ? "" : value)}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder={t("levels.apply.ipPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_NONE}>{t("levels.apply.optionalSkip")}</SelectItem>
                      {ips.length === 0 ? (
                        <SelectItem value="__empty_ips" disabled>
                          {t("levels.apply.ipEmpty")}
                        </SelectItem>
                      ) : (
                        ips.map((ip) => (
                          <SelectItem key={ip.id} value={ip.id}>
                            {ip.title}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field>
                <FieldLabel>{t("levels.apply.attachmentLabel")}</FieldLabel>
                <FieldDescription className="mb-2 text-[11px] leading-relaxed">
                  {t("levels.apply.attachmentHint")}
                </FieldDescription>
                <input
                  ref={fileRef}
                  type="file"
                  accept={USER_LEVEL_APPLY_ACCEPT}
                  className="hidden"
                  onChange={(e) => void handleFileChange(e.target.files?.[0])}
                />
                {attachmentName ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs">
                    <IconPaperclip className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{attachmentName}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      color="muted"
                      size="sm"
                      aria-label={t("levels.apply.attachmentRemove")}
                      onClick={() => {
                        setAttachmentPath(null);
                        setAttachmentName(null);
                      }}
                    >
                      <IconX className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      void handleFileChange(e.dataTransfer.files?.[0]);
                    }}
                    className={cn(
                      "flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-5 text-center transition-colors",
                      dragOver
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-muted/20 hover:border-foreground/25 hover:bg-muted/35",
                      uploading && "pointer-events-none opacity-60"
                    )}
                  >
                    {uploading ? (
                      <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <IconUpload className="size-4 text-muted-foreground" />
                    )}
                    <span className="text-xs font-medium text-foreground/90">
                      {uploading ? t("levels.apply.uploading") : t("levels.apply.attachmentPick")}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {t("levels.apply.attachmentFormats")}
                    </span>
                  </button>
                )}
              </Field>

              <Field>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <FieldLabel className="mb-0">{t("levels.apply.extraLabel")}</FieldLabel>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {extraInfo.length}/{EXTRA_MAX}
                  </span>
                </div>
                <Textarea
                  value={extraInfo}
                  onChange={(e) => setExtraInfo(e.target.value.slice(0, EXTRA_MAX))}
                  placeholder={t("levels.apply.extraPlaceholder")}
                  rows={3}
                  className="min-h-[72px] resize-none text-xs"
                />
              </Field>
            </FieldGroup>
          )}
        </DialogBody>

        <DialogFooter className="gap-2 border-t border-border/60 px-5 py-3.5">
          <Button
            type="button"
            variant="outline"
            color="muted"
            disabled={submitting}
            onClick={() => handleOpenChange(false)}
          >
            {tc("cancel")}
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {submitting ? t("levels.apply.submitting") : t("levels.apply.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
