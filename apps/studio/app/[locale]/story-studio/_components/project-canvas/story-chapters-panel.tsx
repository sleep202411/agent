"use client";

import { useState } from "react";
import {
  IconArchive,
  IconArrowDown,
  IconArrowUp,
  IconDots,
  IconLoader2,
  IconPencil,
  IconPlus,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
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
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { StoryChapter } from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";

export interface StoryChaptersPanelProps {
  chapters: StoryChapter[];
  activeChapterId: string;
  canEdit: boolean;
  creating: boolean;
  pendingChapterId: string | null;
  onSelect: (chapterId: string) => void;
  onCreate: (title: string) => Promise<boolean>;
  onRename: (chapter: StoryChapter, title: string) => Promise<boolean>;
  onMove: (chapter: StoryChapter, direction: -1 | 1) => Promise<boolean>;
  onArchive: (chapter: StoryChapter) => Promise<boolean>;
}

/**
 * Chapter manager — one tenant of the side-panel dock, canvas-rendered inside
 * StoryProjectSidePanelShell because chapter identity, ordering and mutations
 * stay authoritative in the canvas's workbench projection. The panel owns
 * interaction state only.
 */
export function StoryChaptersPanel({
  chapters,
  activeChapterId,
  canEdit,
  creating,
  pendingChapterId,
  onSelect,
  onCreate,
  onRename,
  onMove,
  onArchive,
}: StoryChaptersPanelProps) {
  const t = useTranslations("storyStudio.canvas.chapters");
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<StoryChapter | null>(null);

  const beginRename = (chapter: StoryChapter) => {
    setEditingChapterId(chapter.id);
    setEditingTitle(chapter.title);
  };

  const submitRename = async (chapter: StoryChapter) => {
    const title = editingTitle.trim();
    if (!title || title === chapter.title) {
      setEditingChapterId(null);
      return;
    }
    if (await onRename(chapter, title)) setEditingChapterId(null);
  };

  const submitCreate = async () => {
    const title = createTitle.trim();
    if (!title || creating) return;
    if (await onCreate(title)) {
      setCreateOpen(false);
      setCreateTitle("");
    }
  };

  return (
    <nav aria-label={t("title")} className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold text-white/82">
          {t("title")}
        </h2>
        <span className="text-[10px] font-medium tabular-nums text-white/38">
          {chapters.length}
        </span>
        {canEdit ? (
          <button
            type="button"
            disabled={creating}
            onClick={() => setCreateOpen(true)}
            className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/55 transition hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none disabled:cursor-wait"
            aria-label={t("add")}
          >
            {creating ? (
              <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
            ) : (
              <IconPlus className="size-4" stroke={1.8} />
            )}
          </button>
        ) : null}
      </div>

      <div className="h-px shrink-0 bg-white/[0.07]" />

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {chapters.map((chapter, index) => {
            const active = chapter.id === activeChapterId;
            const pending = chapter.id === pendingChapterId;
            const editing = chapter.id === editingChapterId;
            return (
              <div
                key={chapter.id}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group relative flex min-h-14 w-full items-center overflow-hidden rounded-2xl transition",
                  active ? "bg-white/[0.1]" : "hover:bg-white/[0.055]"
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-white/70"
                  />
                ) : null}
                <div
                  role={editing ? undefined : "button"}
                  tabIndex={editing ? undefined : 0}
                  onClick={() => {
                    if (editing) return;
                    onSelect(chapter.id);
                  }}
                  onKeyDown={(event) => {
                    if (!editing && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onSelect(chapter.id);
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/35 focus-visible:outline-none"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-[13px] bg-white/[0.07] text-[11px] font-semibold tabular-nums text-white/66">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    {editing ? (
                      <Input
                        autoFocus
                        value={editingTitle}
                        maxLength={160}
                        aria-label={t("nameLabel")}
                        onClick={(event) => event.stopPropagation()}
                        onBlur={() => void submitRename(chapter)}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setEditingChapterId(null);
                          }
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void submitRename(chapter);
                          }
                        }}
                        className="h-7 border-0 bg-white/[0.08] px-2 text-xs text-white shadow-none focus-visible:ring-white/30"
                      />
                    ) : (
                      <span
                        className={cn(
                          "block truncate text-xs font-semibold",
                          active ? "text-white" : "text-white/72"
                        )}
                      >
                        {chapter.title}
                      </span>
                    )}
                    <span className="mt-0.5 block truncate text-[10px] text-white/38">
                      {t("sceneCount", { count: chapter.nodeCount })}
                    </span>
                  </span>
                  {pending ? (
                    <IconLoader2 className="size-3.5 shrink-0 animate-spin text-white/52" />
                  ) : null}
                </div>
                {canEdit && !editing ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={pending}
                        className="mr-2 grid size-7 shrink-0 place-items-center rounded-lg text-white/34 opacity-0 transition hover:bg-white/[0.09] hover:text-white/72 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none group-hover:opacity-100 data-[state=open]:bg-white/[0.09] data-[state=open]:text-white/72 data-[state=open]:opacity-100"
                        aria-label={t("menu", { title: chapter.title })}
                      >
                        <IconDots className="size-4" stroke={1.8} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="min-w-44 rounded-xl bg-[oklch(0.24_0_0/0.98)] text-white/78 shadow-2xl"
                    >
                      <DropdownMenuItem onSelect={() => beginRename(chapter)}>
                        <IconPencil />
                        {t("rename")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={index === 0}
                        onSelect={() => void onMove(chapter, -1)}
                      >
                        <IconArrowUp />
                        {t("moveUp")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={index === chapters.length - 1}
                        onSelect={() => void onMove(chapter, 1)}
                      >
                        <IconArrowDown />
                        {t("moveDown")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={chapters.length === 1 || chapter.nodeCount > 0}
                        onSelect={() => setArchiveTarget(chapter)}
                      >
                        <IconArchive />
                        {t("archive")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(nextOpen) => {
          if (creating) return;
          setCreateOpen(nextOpen);
          if (!nextOpen) setCreateTitle("");
        }}
      >
        <DialogContent className="border-0 bg-[oklch(0.22_0_0)] text-white shadow-2xl sm:max-w-md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreate();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("createTitle")}</DialogTitle>
              <DialogDescription>{t("createDescription")}</DialogDescription>
            </DialogHeader>
            <Field
              dense
              required
              className="mt-5"
              label={t("nameLabel")}
              htmlFor="story-create-chapter-name"
            >
              <Input
                id="story-create-chapter-name"
                autoFocus
                aria-required="true"
                value={createTitle}
                maxLength={160}
                placeholder={t("namePlaceholder")}
                onChange={(event) => setCreateTitle(event.target.value)}
              />
            </Field>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="ghost"
                disabled={creating}
                onClick={() => {
                  setCreateOpen(false);
                  setCreateTitle("");
                }}
              >
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={!createTitle.trim() || creating}>
                {creating ? <IconLoader2 className="animate-spin" /> : null}
                {t("createConfirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !pendingChapterId) setArchiveTarget(null);
        }}
      >
        <DialogContent className="border-0 bg-[oklch(0.22_0_0)] text-white shadow-2xl">
          <DialogHeader>
            <DialogTitle>{t("archiveTitle")}</DialogTitle>
            <DialogDescription>
              {t("archiveDescription", { title: archiveTarget?.title ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pendingChapterId !== null}
              onClick={() => setArchiveTarget(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!archiveTarget || pendingChapterId !== null}
              onClick={() => {
                if (!archiveTarget) return;
                void onArchive(archiveTarget).then((archived) => {
                  if (archived) setArchiveTarget(null);
                });
              }}
            >
              {pendingChapterId ? <IconLoader2 className="animate-spin" /> : null}
              {t("archiveConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </nav>
  );
}
