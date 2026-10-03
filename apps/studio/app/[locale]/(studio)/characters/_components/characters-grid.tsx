"use client";

import { useCharacterOperation } from "../_lib/use-character-operation";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  IconAlertTriangle,
  IconDotsVertical,
  IconExternalLink,
  IconLoader2,
  IconMasksTheater,
  IconMusic,
  IconPhoto,
  IconPlus,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { TileCard } from "@/components/ui/tile-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/app/_components/auth-provider";
import { useWorkspace } from "@/app/_components/workspace-context";
import { cn } from "@/lib/utils";
import {
  characterMediaContentUrl,
  deleteCharacter,
  type CharacterKind,
  type CharacterSummary,
} from "@/lib/characters-api";
import { charactersKeys, useCharacters, useCharactersRealtime } from "../_lib/use-characters";
import { CreateCharacterDialog } from "./create-character-dialog";

/** Overlay chip rendered on top of a card's cover (kind / status). */
function OverlayChip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "pointer-events-none inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-xl",
        className
      )}
    >
      {children}
    </span>
  );
}

function kindLabel(kind: CharacterKind, t: ReturnType<typeof useTranslations>): string {
  return kind === "real_person" ? t("kindRealPerson") : t("kindVirtual");
}

/** Lifecycle chip for non-active characters (real states, honest UI). */
function StatusChip({ character }: { character: CharacterSummary }) {
  const t = useTranslations("characters");
  switch (character.status) {
    case "active":
      return null;
    case "pending_verification":
      return (
        <OverlayChip>
          <IconLoader2 className="size-3 animate-spin" stroke={2.2} />
          {t("chipVerifying")}
        </OverlayChip>
      );
    case "draft":
      return (
        <OverlayChip className="text-white/75">
          {character.kind === "real_person" ? t("chipNeedsVerification") : t("statusDraft")}
        </OverlayChip>
      );
    case "disabled":
      return <OverlayChip className="text-destructive">{t("statusDisabled")}</OverlayChip>;
    case "revoked":
      return <OverlayChip className="text-white/60">{t("statusRevoked")}</OverlayChip>;
  }
}

function CardMeta({ character }: { character: CharacterSummary }) {
  const t = useTranslations("characters");
  const { image, video, audio } = character.mediaCounts;
  if (image + video + audio === 0) {
    return <span>{t("noMediaYet")}</span>;
  }
  const chips: Array<{ key: string; icon: React.ReactNode; count: number; label: string }> = [
    {
      key: "image",
      icon: <IconPhoto className="size-3.5" stroke={1.7} />,
      count: image,
      label: t("imageCount", { count: image }),
    },
    {
      key: "video",
      icon: <IconVideo className="size-3.5" stroke={1.7} />,
      count: video,
      label: t("videoCount", { count: video }),
    },
    {
      key: "audio",
      icon: <IconMusic className="size-3.5" stroke={1.7} />,
      count: audio,
      label: t("audioCount", { count: audio }),
    },
  ];
  return (
    <span className="flex items-center gap-2.5">
      {chips
        .filter((chip) => chip.count > 0)
        .map((chip) => (
          <span
            key={chip.key}
            aria-label={chip.label}
            className="inline-flex items-center gap-1 tabular-nums"
          >
            {chip.icon}
            {chip.count}
          </span>
        ))}
    </span>
  );
}

function CardsSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="flex flex-col gap-2.5">
          <Skeleton className="aspect-square rounded-2xl" />
          <div>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1.5 h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Workspace character library (演员池): card grid of reusable subjects with a
 * leading "New character" tile. Real loading / signed-out / error / empty
 * states; cards open the detail surface, the ⋮ menu deletes (with a confirm
 * that spells out cast removal).
 */
export function CharactersGrid() {
  const t = useTranslations("characters");
  const tc = useTranslations("common");
  const settings = useTranslations("settings");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, loading: authLoading, signIn } = useAuth();
  const workspace = useWorkspace();
  const workspaceId =
    workspace.error || workspace.loading ? null : (workspace.activeWorkspace?.id ?? null);
  const query = useCharacters(user ? workspaceId : null);
  // Enrollment / provider-mirror changes reconcile the grid live.
  useCharactersRealtime();

  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<CharacterSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const operation = useCharacterOperation(workspaceId ?? "none", () => {
    setDeleting(null);
    setDeleteBusy(false);
    setCreateOpen(false);
  });

  // Deleting a live real_person likeness IS consent revocation — the confirm
  // dialog must say so (provider assets deleted, jobs cancelled, 30-day purge).
  const deletingIsRevoke = deleting?.kind === "real_person" && deleting.status !== "revoked";

  const confirmDelete = async () => {
    if (!deleting || deleteBusy) return;
    const revoke = deletingIsRevoke;
    const run = operation.start();
    if (!run) return;
    setDeleteBusy(true);
    try {
      await deleteCharacter(deleting.id, run.signal);
      if (!operation.isCurrent(run)) return;
      queryClient.removeQueries({ queryKey: charactersKeys.detail(deleting.id) });
      await queryClient.invalidateQueries({ queryKey: charactersKeys.lists() });
      if (!operation.isCurrent(run)) return;
      setDeleting(null);
      toast.success(revoke ? t("characterRevoked") : t("characterDeleted"));
    } catch (error) {
      if (!operation.isCurrent(run)) return;
      toast.error(error instanceof Error ? error.message : tc("error"));
    } finally {
      if (operation.finish(run)) setDeleteBusy(false);
    }
  };

  if (!authLoading && !user) {
    return (
      <FrostedPanel className="mt-6 flex flex-col items-center px-6 py-24 text-center">
        <div className="flex size-20 items-center justify-center rounded-full bg-white/[0.04]">
          <IconMasksTheater className="size-10 text-white/25" stroke={1.5} />
        </div>
        <p className="mt-6 text-sm font-medium">{t("signInTitle")}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("signInDescription")}</p>
        <Button variant="primary-cta" size="lg" className="mt-6" onClick={signIn}>
          {t("signIn")}
        </Button>
      </FrostedPanel>
    );
  }

  if (authLoading || workspace.loading) return <CardsSkeleton />;

  const workspaceUnavailable = workspace.error || !workspace.activeWorkspace;
  if (workspaceUnavailable || query.isError) {
    return (
      <FrostedPanel className="mt-6 flex flex-col items-center px-6 py-24 text-center">
        <div className="flex size-20 items-center justify-center rounded-full bg-destructive/10">
          <IconAlertTriangle className="size-10 text-destructive" stroke={1.5} />
        </div>
        <p className="mt-6 text-sm font-medium">{t("loadFailedTitle")}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {workspaceUnavailable
            ? workspace.error?.message || settings("workspaceUnavailable")
            : query.error instanceof Error
              ? query.error.message
              : tc("error")}
        </p>
        <Button
          variant="secondary"
          size="lg"
          className="mt-6"
          disabled={workspaceUnavailable ? workspace.fetching : query.isFetching}
          onClick={() => (workspaceUnavailable ? workspace.refresh() : void query.refetch())}
        >
          {tc("retry")}
        </Button>
      </FrostedPanel>
    );
  }

  // Auth or workspace still resolving, or the list in flight.
  if (authLoading || !workspaceId || query.isPending) {
    return <CardsSkeleton />;
  }

  const characters = query.data;

  return (
    <>
      {characters.length === 0 ? (
        <FrostedPanel className="mt-6 flex flex-col items-center px-6 py-24 text-center">
          <div className="flex size-20 items-center justify-center rounded-full bg-white/[0.04]">
            <IconMasksTheater className="size-10 text-white/25" stroke={1.5} />
          </div>
          <p className="mt-6 text-sm font-medium">{t("emptyTitle")}</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{t("emptyDescription")}</p>
          <Button
            variant="primary-cta"
            size="lg"
            className="mt-6"
            onClick={() => setCreateOpen(true)}
          >
            <IconPlus data-icon="inline-start" />
            {t("createCharacter")}
          </Button>
        </FrostedPanel>
      ) : (
        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5">
          {/* New character — soft tile + label below; the brand-red "+" is the
              sanctioned primary CTA (DESIGN.md §2). */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="group block text-left outline-none"
          >
            <TileCard
              aspect="square"
              title={t("newCharacter")}
              meta={t("newCharacterHint")}
              media={
                <span className="grid size-12 place-items-center rounded-full bg-[#E52227] text-white shadow-lg shadow-[#E52227]/25 transition group-hover:brightness-110">
                  <IconPlus className="size-6" stroke={2} />
                </span>
              }
            />
          </button>

          {characters.map((character) => {
            const revoked = character.status === "revoked";
            const card = (
              <TileCard
                aspect="square"
                // Revoked = tombstone: dimmed, desaturated, not openable.
                className={cn(revoked && "opacity-55")}
                tileClassName={cn(revoked && "grayscale")}
                title={character.name}
                meta={<CardMeta character={character} />}
                media={
                  character.coverAssetId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={characterMediaContentUrl(character.coverAssetId)}
                      alt={character.name}
                      className="size-full object-cover"
                    />
                  ) : (
                    <IconMasksTheater className="size-10 text-white/20" stroke={1.5} />
                  )
                }
                overlay={
                  <>
                    <span className="pointer-events-none absolute top-2 left-2 flex flex-col items-start gap-1">
                      <OverlayChip>{kindLabel(character.kind, t)}</OverlayChip>
                      <StatusChip character={character} />
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={t("characterActions")}
                        onClick={(event) => event.preventDefault()}
                        className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/50 text-white/70 opacity-0 shadow-md backdrop-blur-xl transition-opacity outline-none hover:text-white group-hover:opacity-100 data-[state=open]:opacity-100"
                      >
                        <IconDotsVertical className="size-4" stroke={1.8} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(event) => event.preventDefault()}>
                        {!revoked && (
                          <>
                            <DropdownMenuItem
                              onSelect={() => router.push(`/characters/${character.id}`)}
                            >
                              <IconExternalLink className="size-4" stroke={1.8} />
                              {t("open")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setDeleting(character)}
                        >
                          <IconTrash className="size-4" stroke={1.8} />
                          {tc("delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            );
            return revoked ? (
              <div key={character.id} className="group block">
                {card}
              </div>
            ) : (
              <Link
                key={character.id}
                href={`/characters/${character.id}`}
                className="group block outline-none"
              >
                {card}
              </Link>
            );
          })}
        </div>
      )}

      <CreateCharacterDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
      />

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deletingIsRevoke ? t("revokeCharacterTitle") : t("deleteCharacterTitle")}
            </DialogTitle>
            <DialogDescription>
              {deletingIsRevoke
                ? t("revokeCharacterDescription", { name: deleting?.name ?? "" })
                : t("deleteCharacterDescription", { name: deleting?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
            >
              {deletingIsRevoke ? t("revokeConfirm") : tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
