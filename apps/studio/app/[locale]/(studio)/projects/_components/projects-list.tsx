"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconDotsVertical, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { SectionHeading } from "@/components/ui/section-heading";
import { TileCard } from "@/components/ui/tile-card";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/app/_components/auth-provider";
import { ProjectCard } from "@/components/project-card";
import {
  createLegacyProject,
  deleteLegacyProject,
  listMyLegacyProjects,
  renameLegacyProject,
  type LegacyProject,
} from "@/lib/legacy-projects";

/**
 * "My history projects" — the user's legacy art-studio projects. A "New project"
 * tile leads; each card's ⋮ menu renames or deletes via the Java world/project
 * APIs (same calls apps/web uses). Cards link out to the project workspace in
 * apps/web. Hidden when signed out.
 */
export function ProjectsList() {
  const t = useTranslations("studioModes");
  const tp = useTranslations("projects");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["legacy-projects", "my", user?.id ?? "anon"];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: listMyLegacyProjects,
    enabled: !!user,
    staleTime: 30_000,
  });

  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renaming, setRenaming] = useState<LegacyProject | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<LegacyProject | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const items = data ?? [];
  const ownerName = user.nickName?.trim() || user.email || user.phone || "Me";
  // Legacy projects live in apps/web (fizzdragon.com / .cn for zh-CN).
  const webBase = locale === "zh-CN" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const submitCreate = async () => {
    const name = createName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await createLegacyProject(name);
      await refresh();
      setCreating(false);
      setCreateName("");
      toast.success(tp("projectCreated"));
    } catch {
      toast.error(tp("createProjectFailed"));
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    const name = renameValue.trim();
    if (!renaming || !name || busy) return;
    setBusy(true);
    try {
      await renameLegacyProject(renaming.id, name);
      await refresh();
      setRenaming(null);
      toast.success(tp("projectRenamed"));
    } catch {
      toast.error(tp("renameFailed"));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await deleteLegacyProject(deleting.id);
      await refresh();
      setDeleting(null);
      toast.success(tp("projectDeleted"));
    } catch {
      toast.error(tp("deleteFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionHeading
        as="h2"
        title={t("projects.historyTitle")}
        subtitle={t("projects.historySubtitle")}
      />
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <button
          type="button"
          onClick={() => {
            setCreateName("");
            setCreating(true);
          }}
          className="group block text-left outline-none"
        >
          <TileCard
            title={tp("newProject")}
            media={
              <span className="grid size-12 place-items-center rounded-full bg-[#E52227] text-white shadow-lg shadow-[#E52227]/25 transition group-hover:brightness-110">
                <IconPlus className="size-6" stroke={2} />
              </span>
            }
          />
        </button>

        {isLoading
          ? null
          : items.map((project) => (
              <ProjectCard
                key={project.id}
                name={project.name}
                ownerName={ownerName}
                metaLabel={formatDate(project.updatedAt)}
                cover={project.cover}
                href={`${webBase}/${locale}/projects/${project.id}`}
                menu={
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={tp("projectActions")}
                      onClick={(event) => event.preventDefault()}
                      className="grid size-8 shrink-0 place-items-center rounded-full text-white/90 transition outline-none hover:bg-white/[0.08]"
                    >
                      <IconDotsVertical className="size-4" stroke={1.8} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(event) => event.preventDefault()}>
                      <DropdownMenuItem
                        onSelect={() => {
                          setRenameValue(project.name);
                          setRenaming(project);
                        }}
                      >
                        <IconPencil className="size-4" stroke={1.8} />
                        {tp("rename")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(project)}>
                        <IconTrash className="size-4" stroke={1.8} />
                        {tc("delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            ))}
      </div>

      <Dialog open={creating} onOpenChange={(open) => !open && setCreating(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{tp("newProject")}</DialogTitle>
          </DialogHeader>
          <Input
            value={createName}
            autoFocus
            onChange={(event) => setCreateName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitCreate();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => void submitCreate()} disabled={busy || !createName.trim()}>
              {tc("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{tp("renameProject")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            autoFocus
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitRename();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              {tc("cancel")}
            </Button>
            <Button onClick={() => void submitRename()} disabled={busy || !renameValue.trim()}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{tp("deleteProjectTitle")}</DialogTitle>
            <DialogDescription>
              {tp("deleteProjectDescription", { name: deleting?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {tc("cancel")}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={busy}>
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}
