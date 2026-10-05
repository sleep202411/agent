"use client";

import { useState } from "react";
import {
  IconBook2,
  IconChevronDown,
  IconChevronUp,
  IconDots,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useProjectContext } from "./project-context";
import { useProjectSections } from "./project-sections-context";
import { useProjectUIStore } from "../_stores/project-ui-store";
import { DrawerPanel } from "@/components/ui/drawer-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ProjectSectionRef } from "@/lib/collab/projects-api";

type EditState = { kind: "create" } | { kind: "rename"; section: ProjectSectionRef } | null;

export function ProjectSectionsPanel() {
  const t = useTranslations("project.sections");
  const tc = useTranslations("common");
  const { canEdit } = useProjectContext();
  const {
    sections,
    activeSection,
    status,
    error,
    selectSection,
    createSection,
    renameSection,
    reorderSections,
    archiveSection,
  } = useProjectSections();
  const close = useProjectUIStore((state) => state.closeSections);
  const [edit, setEdit] = useState<EditState>(null);
  const [name, setName] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<ProjectSectionRef | null>(null);
  const [busy, setBusy] = useState(false);

  const openCreate = () => {
    setName("");
    setEdit({ kind: "create" });
  };
  const openRename = (section: ProjectSectionRef) => {
    setName(section.title);
    setEdit({ kind: "rename", section });
  };
  const submitEdit = async () => {
    const title = name.trim();
    if (!title || !edit || busy) return;
    setBusy(true);
    try {
      if (edit.kind === "create") await createSection(title);
      else await renameSection(edit.section.id, title);
      setEdit(null);
    } catch (reason) {
      toast.error(
        errorMessage(reason, edit.kind === "create" ? t("createError") : t("updateError"))
      );
    } finally {
      setBusy(false);
    }
  };
  const move = async (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= sections.length || busy) return;
    const ids = sections.map((section) => section.id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    setBusy(true);
    try {
      await reorderSections(ids);
    } catch (reason) {
      toast.error(errorMessage(reason, t("reorderError")));
    } finally {
      setBusy(false);
    }
  };
  const confirmArchive = async () => {
    if (!archiveTarget || busy) return;
    setBusy(true);
    try {
      await archiveSection(archiveTarget.id);
      setArchiveTarget(null);
    } catch (reason) {
      toast.error(errorMessage(reason, t("archiveError")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DrawerPanel.Header
        title={t("title")}
        count={sections.length}
        icon={<IconBook2 className="size-4" stroke={1.7} />}
        closeLabel={t("close")}
        onClose={close}
      />
      <DrawerPanel.Body className="gap-1 px-3 pb-3">
        {status === "loading" ? (
          <div className="space-y-2 pt-1" aria-busy="true">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-11 animate-pulse rounded-xl bg-white/[0.05]" />
            ))}
          </div>
        ) : status === "error" ? (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-xs leading-5 text-white/55">
            {error?.message || t("loadError")}
          </div>
        ) : (
          sections.map((section, index) => {
            const active = section.id === activeSection?.id;
            return (
              <div
                key={section.id}
                className={cn(
                  "group flex min-h-11 items-center gap-2 rounded-xl px-2 transition",
                  active ? "bg-white/[0.1] text-white" : "text-white/62 hover:bg-white/[0.055]"
                )}
              >
                <button
                  type="button"
                  onClick={() => selectSection(section.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-lg text-[10px] tabular-nums",
                      active ? "bg-white text-black" : "bg-white/[0.06] text-white/45"
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="truncate text-xs font-medium">{section.title}</span>
                </button>
                {canEdit ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={t("menu", { title: section.title })}
                      className="grid size-7 shrink-0 place-items-center rounded-lg text-white/38 opacity-0 transition hover:bg-white/[0.08] hover:text-white group-hover:opacity-100 focus:opacity-100"
                    >
                      <IconDots className="size-4" stroke={1.8} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => openRename(section)}>
                        <IconPencil className="size-4" stroke={1.8} />
                        {t("rename")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={index === 0 || busy}
                        onSelect={() => void move(index, -1)}
                      >
                        <IconChevronUp className="size-4" stroke={1.8} />
                        {t("moveUp")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={index === sections.length - 1 || busy}
                        onSelect={() => void move(index, 1)}
                      >
                        <IconChevronDown className="size-4" stroke={1.8} />
                        {t("moveDown")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={sections.length === 1 || busy}
                        onSelect={() => setArchiveTarget(section)}
                      >
                        <IconTrash className="size-4" stroke={1.8} />
                        {t("archive")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            );
          })
        )}
      </DrawerPanel.Body>
      {canEdit ? (
        <DrawerPanel.Footer>
          <Button
            className="w-full"
            variant="secondary"
            onClick={openCreate}
            disabled={status !== "ready"}
          >
            <IconPlus className="size-4" stroke={1.8} />
            {t("add")}
          </Button>
        </DrawerPanel.Footer>
      ) : null}

      <Dialog open={edit !== null} onOpenChange={(open) => !open && !busy && setEdit(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{edit?.kind === "rename" ? t("rename") : t("createTitle")}</DialogTitle>
            {edit?.kind === "create" ? (
              <DialogDescription>{t("createDescription")}</DialogDescription>
            ) : null}
          </DialogHeader>
          <label className="space-y-2 text-xs text-white/62">
            <span>{t("nameLabel")}</span>
            <Input
              autoFocus
              value={name}
              maxLength={160}
              placeholder={t("namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitEdit();
              }}
            />
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEdit(null)} disabled={busy}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => void submitEdit()} disabled={busy || !name.trim()}>
              {edit?.kind === "rename" ? tc("save") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && !busy && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("archiveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget ? t("archiveDescription", { title: archiveTarget.title }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{tc("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void confirmArchive();
              }}
            >
              {t("archive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
