"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconMasksTheater,
  IconPencil,
  IconRosetteDiscountCheck,
  IconTrash,
  IconUserOff,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiRequestError } from "@/lib/api";
import {
  characterMediaContentUrl,
  deleteCharacter,
  updateCharacter,
  type CharacterStatus,
} from "@/lib/characters-api";
import {
  charactersKeys,
  useApplyCharacterDetail,
  useCharacter,
  useCharactersRealtime,
} from "../_lib/use-characters";
import { CharacterEnrollmentWizard } from "./character-enrollment-wizard";
import { CharacterMediaBoard } from "./character-media-board";
import { RealPersonAuthorizations } from "./real-person-authorizations";

const NAME_MAX = 64;
const DESCRIPTION_MAX = 200;

function DetailSkeleton() {
  return (
    <div>
      <Skeleton className="h-5 w-28" />
      <div className="mt-6 flex items-start gap-5">
        <Skeleton className="size-24 shrink-0 rounded-2xl" />
        <div className="flex-1">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-2.5 h-4 w-80" />
          <Skeleton className="mt-2.5 h-3 w-32" />
        </div>
      </div>
      <div className="mt-12 grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
        {[0, 1, 2, 3, 4].map((key) => (
          <Skeleton key={key} className="aspect-square rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/**
 * Character detail: header (cover, inline rename / description edit, kind +
 * status, delete) over the per-kind reference-media board. Every mutation
 * writes the server-returned detail back through the shared cache path so the
 * library grid stays in sync.
 */
export function CharacterDetailView({ characterId }: { characterId: string }) {
  const t = useTranslations("characters");
  const tc = useTranslations("common");
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useCharacter(characterId);
  const applyDetail = useApplyCharacterDetail();
  // Leave-and-notify: provider-mirror + enrollment changes land as
  // `character_media_updated` events and reconcile this detail live.
  useCharactersRealtime();

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const character = query.data;

  const saveName = async () => {
    if (!character || saveBusy) return;
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === character.name) {
      setEditingName(false);
      return;
    }
    setSaveBusy(true);
    try {
      applyDetail(await updateCharacter(character.id, { name: trimmed }));
      setEditingName(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("error"));
    } finally {
      setSaveBusy(false);
    }
  };

  const saveDescription = async () => {
    if (!character || saveBusy) return;
    const trimmed = descriptionValue.trim();
    if (trimmed === (character.description ?? "")) {
      setEditingDescription(false);
      return;
    }
    setSaveBusy(true);
    try {
      applyDetail(await updateCharacter(character.id, { description: trimmed || null }));
      setEditingDescription(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("error"));
    } finally {
      setSaveBusy(false);
    }
  };

  // For a real_person likeness, delete IS consent revocation (provider assets
  // deleted, jobs cancelled, 30-day face-data purge) — the dialog says so.
  const isRevoke = character?.kind === "real_person" && character.status !== "revoked";

  const confirmDelete = async () => {
    if (!character || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await deleteCharacter(character.id);
      queryClient.removeQueries({ queryKey: charactersKeys.detail(character.id) });
      await queryClient.invalidateQueries({ queryKey: charactersKeys.lists() });
      toast.success(isRevoke ? t("characterRevoked") : t("characterDeleted"));
      router.push("/characters");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("error"));
      setDeleteBusy(false);
    }
  };

  const backLink = (
    <Link
      href="/characters"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <IconArrowLeft className="size-4" stroke={1.8} />
      {t("backToLibrary")}
    </Link>
  );

  if (query.isPending) {
    return <DetailSkeleton />;
  }

  if (query.isError) {
    const notFound = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <div>
        {backLink}
        <FrostedPanel className="mt-6 flex flex-col items-center px-6 py-24 text-center">
          <div
            className={cn(
              "flex size-20 items-center justify-center rounded-full",
              notFound ? "bg-white/[0.04]" : "bg-destructive/10"
            )}
          >
            {notFound ? (
              <IconMasksTheater className="size-10 text-white/25" stroke={1.5} />
            ) : (
              <IconAlertTriangle className="size-10 text-destructive" stroke={1.5} />
            )}
          </div>
          <p className="mt-6 text-sm font-medium">
            {notFound ? t("notFoundTitle") : t("loadFailedTitle")}
          </p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {notFound
              ? t("notFoundDescription")
              : query.error instanceof Error
                ? query.error.message
                : tc("error")}
          </p>
          {!notFound && (
            <Button
              variant="secondary"
              size="lg"
              className="mt-6"
              onClick={() => void query.refetch()}
            >
              {tc("retry")}
            </Button>
          )}
        </FrostedPanel>
      </div>
    );
  }

  const detail = query.data;
  const statusLabel: Record<CharacterStatus, string> = {
    draft: t("statusDraft"),
    pending_verification: t("statusPendingVerification"),
    active: t("statusActive"),
    disabled: t("statusDisabled"),
    revoked: t("statusRevoked"),
  };

  return (
    <div>
      {backLink}

      <div className="mt-6 flex items-start gap-5">
        {/* Cover */}
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/[0.03]">
          {detail.coverAssetId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={characterMediaContentUrl(detail.coverAssetId)}
              alt={detail.name}
              className="size-full object-cover"
            />
          ) : (
            <IconMasksTheater className="size-9 text-white/20" stroke={1.5} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameValue}
                autoFocus
                maxLength={NAME_MAX}
                className="h-9 max-w-72 rounded-xl text-base font-semibold"
                onChange={(event) => setNameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveName();
                  if (event.key === "Escape") setEditingName(false);
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void saveName()}
                disabled={saveBusy || !nameValue.trim()}
              >
                {tc("save")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingName(false)}
                disabled={saveBusy}
              >
                {tc("cancel")}
              </Button>
            </div>
          ) : (
            <div className="group/name flex min-w-0 items-center gap-2">
              <h1 className="truncate text-[22px] font-semibold tracking-tight">{detail.name}</h1>
              <span className="shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-medium text-white/70">
                {detail.kind === "real_person" ? t("kindRealPerson") : t("kindVirtual")}
              </span>
              {detail.kind === "real_person" && detail.status === "active" && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-medium text-white/80">
                  <IconRosetteDiscountCheck className="size-3.5" stroke={1.8} />
                  {t("enrollVerified")}
                </span>
              )}
              {/* Virtual + at least one AIGC-certified image = safe for video
                  gen (Seedance real-person risk control accepts it). Detail
                  only — CharacterSummary carries no per-media mirror. */}
              {detail.kind === "virtual" &&
                detail.media.some(
                  (item) => item.mediaKind === "image" && item.mirror?.status === "active"
                ) && (
                  <span
                    title={t("aigcCertifiedHint")}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-medium text-white/80"
                  >
                    <IconRosetteDiscountCheck className="size-3.5" stroke={1.8} />
                    {t("mirrorCertified")}
                  </span>
                )}
              {detail.status !== "active" && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    // In-progress lifecycle reads neutral; only terminal
                    // refusals (disabled / revoked) carry error semantics.
                    detail.status === "disabled" || detail.status === "revoked"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-white/[0.07] text-white/70"
                  )}
                >
                  {statusLabel[detail.status]}
                </span>
              )}
              <button
                type="button"
                aria-label={t("renameCharacter")}
                onClick={() => {
                  setNameValue(detail.name);
                  setEditingName(true);
                }}
                className="shrink-0 text-white/40 opacity-0 transition-opacity group-hover/name:opacity-100 hover:text-white focus-visible:opacity-100"
              >
                <IconPencil className="size-4" stroke={1.8} />
              </button>
            </div>
          )}

          {editingDescription ? (
            <div className="mt-2 max-w-xl">
              <Textarea
                value={descriptionValue}
                autoFocus
                maxLength={DESCRIPTION_MAX}
                placeholder={t("descriptionPlaceholder")}
                className="min-h-16 rounded-xl"
                onChange={(event) => setDescriptionValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setEditingDescription(false);
                }}
              />
              <div className="mt-2 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void saveDescription()}
                  disabled={saveBusy}
                >
                  {tc("save")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingDescription(false)}
                  disabled={saveBusy}
                >
                  {tc("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              aria-label={t("editDescription")}
              onClick={() => {
                setDescriptionValue(detail.description ?? "");
                setEditingDescription(true);
              }}
              className="group/desc mt-1.5 flex max-w-xl items-start gap-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>{detail.description || t("addDescription")}</span>
              <IconPencil
                className="mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover/desc:opacity-100"
                stroke={1.8}
              />
            </button>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            {t("createdOn", { date: new Date(detail.createdAt).toLocaleDateString() })}
          </p>
        </div>

        <Button variant="destructive" className="shrink-0" onClick={() => setDeleteOpen(true)}>
          <IconTrash data-icon="inline-start" />
          {isRevoke ? t("revokeCharacter") : t("deleteCharacter")}
        </Button>
      </div>

      {/* Real-person lifecycle: verification wizard while unverified, tombstone
          notice once revoked, media board (with mirror states) otherwise. */}
      {detail.kind === "real_person" &&
      (detail.status === "draft" || detail.status === "pending_verification") ? (
        <CharacterEnrollmentWizard character={detail} onDetail={applyDetail} />
      ) : detail.status === "revoked" ? (
        <FrostedPanel className="mt-8 flex items-start gap-3 p-6">
          <IconUserOff className="mt-0.5 size-5 shrink-0 text-white/40" stroke={1.6} />
          <div>
            <p className="text-sm font-medium">{t("statusRevoked")}</p>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("revokedNotice")}</p>
          </div>
        </FrostedPanel>
      ) : (
        <>
          <CharacterMediaBoard character={detail} onDetail={applyDetail} />
          {/* Subject-controlled collaborative-likeness surface (v2): authorize
              projects to use this likeness + take down videos made from it. */}
          {detail.kind === "real_person" && detail.status === "active" && (
            <RealPersonAuthorizations characterId={detail.id} />
          )}
        </>
      )}

      <Dialog open={deleteOpen} onOpenChange={(open) => !deleteBusy && setDeleteOpen(open)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {isRevoke ? t("revokeCharacterTitle") : t("deleteCharacterTitle")}
            </DialogTitle>
            <DialogDescription>
              {isRevoke
                ? t("revokeCharacterDescription", { name: detail.name })
                : t("deleteCharacterDescription", { name: detail.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
            >
              {isRevoke ? t("revokeConfirm") : tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
