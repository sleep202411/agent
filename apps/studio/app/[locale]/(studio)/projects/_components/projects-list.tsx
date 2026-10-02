"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconDotsVertical, IconPencil, IconTrash } from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { SectionHeading } from "@/components/ui/section-heading";
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
  deleteLegacyProject,
  listMyLegacyProjects,
  renameLegacyProject,
  type LegacyProject,
} from "@/lib/legacy-projects";
import { getWebBaseUrl } from "@/lib/web-base";
import { useSiteRegion } from "@/app/_components/region-provider";

/**
 * "My history projects" — the user's legacy art-studio projects.
 * Each card's ⋮ menu renames or deletes via the Java world/project
 * APIs (same calls apps/web uses). Cards link out to the project workspace in
 * apps/web. Hidden when signed out or there are no history projects.
 */
export function ProjectsList() {
  const t = useTranslations("studioModes");
  const tp = useTranslations("projects");
  const tc = useTranslations("common");
  const locale = useLocale();
  const siteRegion = useSiteRegion();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["legacy-projects", "my", user?.id ?? "anon"];
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: listMyLegacyProjects,
    enabled: !!user,
    staleTime: 30_000,
  });

  const [renaming, setRenaming] = useState<LegacyProject | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<LegacyProject | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user || (!isPending && !error && !data?.length)) return null;

  const items = data ?? [];
  const ownerName = user.nickName?.trim() || user.email || user.phone || "Me";
  // Legacy projects live in apps/web; the domain follows the deployment cell.
  const webBase = getWebBaseUrl(siteRegion);
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const submitRename = async () => {
    const name = renameValue.trim();
    if (!renaming || !name || busy) return;
    setBusy(true);
    try {
      await renameLegacyProject(renaming.id, name);
      await refresh();
      setRenaming((current) => (current === renaming ? null : current));
      toast.success(tp("projectRenamed"));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : tp("renameFailed"));
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
      setDeleting((current) => (current === deleting ? null : current));
      toast.success(tp("projectDeleted"));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : tp("deleteFailed"));
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
      {isPending ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {tc("loading")}
        </p>
      ) : null}
      {error ? (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl bg-muted p-4">
          <p role="alert" className="min-w-0 break-words text-sm text-muted-foreground">
            {error instanceof Error && error.message ? error.message : tp("loadFailed")}
          </p>
          <Button
            variant="secondary"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {tc("retry")}
          </Button>
        </div>
      ) : null}
      <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
        {items.map((project) => (
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
                      // Each opening owns its completion, even for the same project.
                      setRenaming({ ...project });
                    }}
                  >
                    <IconPencil className="size-4" stroke={1.8} />
                    {tp("rename")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleting({ ...project })}
                  >
                    <IconTrash className="size-4" stroke={1.8} />
                    {tc("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        ))}
      </div>

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
