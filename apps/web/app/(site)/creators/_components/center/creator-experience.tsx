"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { IconBriefcase, IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { useCreatorExperience } from "../../_hooks/use-creator";
import { ExperienceDialog } from "@/app/(site)/profile/experience-dialog";
import {
  useDeleteExperience,
  type ExperienceEntry,
} from "@/app/(site)/profile/_hooks/use-profile-extras";

export function CreatorExperience({ creatorId, isOwner }: { creatorId: string; isOwner: boolean }) {
  const { user } = useCurrentUser();
  const canEdit = isOwner && user?.id === creatorId;
  return (
    <ExperienceSection
      key={JSON.stringify([creatorId, user?.id, canEdit])}
      creatorId={creatorId}
      canEdit={canEdit}
    />
  );
}

function ExperienceSection({ creatorId, canEdit }: { creatorId: string; canEdit: boolean }) {
  const t = useTranslations("profile");
  const center = useTranslations("creatorCenter");
  const common = useTranslations("common");
  const query = useCreatorExperience(creatorId);
  const remove = useDeleteExperience();
  const [editing, setEditing] = useState<ExperienceEntry | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ExperienceEntry | null>(null);
  const active = useRef(false);
  const submitting = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const deleteEntry = async () => {
    if (!canEdit || deleting?.id === undefined || submitting.current || !active.current) return;
    submitting.current = true;
    try {
      await remove.mutateAsync(deleting.id);
      if (!active.current) return;
      setDeleting(null);
      toast.success(common("deleteSuccess"));
    } catch (error) {
      if (active.current)
        toast.error(
          error instanceof Error && error.message.trim() ? error.message : common("deleteFailed")
        );
    } finally {
      submitting.current = false;
    }
  };

  return (
    <section
      className="rounded-2xl bg-card px-5 py-4"
      aria-label={center("about.experienceHeading")}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {center("about.experienceHeading")}
        </h2>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            color="muted"
            aria-label={t("addExperience")}
            onClick={() => setEditing(null)}
          >
            <IconPlus className="size-3.5" />
          </Button>
        )}
      </header>
      {query.isPending ? (
        <p role="status" className="text-xs text-muted-foreground">
          {common("loading")}
        </p>
      ) : query.isError ? (
        <div role="alert" className="space-y-2 text-xs">
          <p className="break-words">{query.error.message || common("loadFailed")}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {common("retry")}
          </Button>
        </div>
      ) : !query.data?.length ? (
        <p className="text-xs text-muted-foreground">
          {center(canEdit ? "about.experienceEmptyOwner" : "about.experienceEmptyVisitor")}
        </p>
      ) : (
        <ul className="space-y-3.5">
          {query.data.map((entry, index) => (
            <li key={String(entry.id ?? index)} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
                <IconBriefcase className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-words text-sm font-medium">{entry.title || "—"}</p>
                {entry.organization && (
                  <p className="break-words text-xs text-muted-foreground">{entry.organization}</p>
                )}
                <p className="break-words text-[11px] text-muted-foreground">
                  {[[entry.startTime, entry.endTime].filter(Boolean).join(" – "), entry.location]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {entry.description && (
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                    {entry.description}
                  </p>
                )}
                {canEdit && entry.id !== undefined && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      color="muted"
                      aria-label={`${t("editExperience")}: ${entry.title}`}
                      onClick={() => setEditing(entry)}
                    >
                      <IconEdit className="size-3.5" />
                      <span>{common("edit")}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      color="muted"
                      aria-label={`${common("delete")}: ${entry.title}`}
                      onClick={() => setDeleting(entry)}
                    >
                      <IconTrash className="size-3.5" />
                      <span>{common("delete")}</span>
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && editing !== undefined && (
        <ExperienceDialog
          open
          initial={editing}
          onOpenChange={(open) => {
            if (!open) setEditing(undefined);
          }}
        />
      )}
      <AlertDialog
        open={canEdit && !!deleting}
        onOpenChange={(open) => {
          if (!open && !submitting.current) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("experienceConfirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{deleting?.title}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>{common("cancel")}</AlertDialogCancel>
            <Button disabled={remove.isPending} onClick={() => void deleteEntry()}>
              {remove.isPending ? common("loading") : common("delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
