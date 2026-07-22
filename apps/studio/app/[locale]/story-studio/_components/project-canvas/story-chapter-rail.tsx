"use client";

import { useState } from "react";
import {
  IconArchive,
  IconArrowDown,
  IconArrowUp,
  IconDots,
  IconFileText,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconX,
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
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { StoryChapter } from "@/lib/story-projects-api";

interface StoryChapterRailProps {
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
  onClose: () => void;
}

/**
 * Story Studio's chapter navigation surface.
 *
 * Story-specific chapter navigation. The visual primitive can later be shared
 * with other paged canvases, but its data contract stays in Story Studio.
 */
export function StoryChapterRail({
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
  onClose,
}: StoryChapterRailProps) {
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
    <FrostedPanel
      role="navigation"
      aria-label={t("title")}
      className="absolute top-20 bottom-5 left-3 z-20 flex w-[252px] flex-col overflow-hidden rounded-[24px] bg-[oklch(0.205_0_0/0.78)] shadow-[18px_0_60px_rgba(0,0,0,0.32)] backdrop-blur-[60px] backdrop-saturate-150"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/66">
          <IconFileText className="size-4" stroke={1.8} />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-white/88">{t("title")}</h2>
          <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-semibold text-white/42">
            {chapters.length}
          </span>
        </div>

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

        <button
          type="button"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/48 transition hover:bg-white/[0.11] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
          aria-label={t("close")}
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      </div>

      <div className="h-px shrink-0 bg-white/[0.08]" />

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-1.5">
          {chapters.map((chapter, index) => {
            const active = chapter.id === activeChapterId;
            const pending = chapter.id === pendingChapterId;
            const editing = chapter.id === editingChapterId;
            return (
              <div
                key={chapter.id}
                aria-current={active ? "page" : undefined}
                className={`group relative flex min-h-16 w-full items-center overflow-hidden rounded-[18px] transition ${
                  active
                    ? "bg-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                    : "bg-white/[0.035] hover:bg-white/[0.07]"
                }`}
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
                    if (!editing) onSelect(chapter.id);
                  }}
                  onKeyDown={(event) => {
                    if (!editing && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onSelect(chapter.id);
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/35 focus-visible:outline-none"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-[14px] bg-white/[0.08] text-xs font-semibold tabular-nums text-white/74">
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
                        className={`block truncate text-xs font-semibold ${active ? "text-white" : "text-white/72"}`}
                      >
                        {chapter.title}
                      </span>
                    )}
                    <span className="mt-1 block truncate text-[10px] text-white/40">
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
        onOpenChange={(open) => {
          if (creating) return;
          setCreateOpen(open);
          if (!open) setCreateTitle("");
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
        onOpenChange={(open) => {
          if (!open && !pendingChapterId) setArchiveTarget(null);
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
    </FrostedPanel>
  );
}
