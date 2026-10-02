"use client";

import { useRef, useState, type ReactNode } from "react";
import { IconId, IconPhoto, IconPhotoUp, IconTrash, IconLoader2 } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useProjectContext } from "./project-context";
import { useProjectUIStore } from "../_stores/project-ui-store";
import { DrawerPanel } from "@/components/ui/drawer-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import { useAuth } from "@/app/_components/auth-provider";
import { ApiRequestError } from "@/lib/api";
import { getProject, updateProject, type ProjectRef } from "@/lib/collab/projects-api";

/**
 * Project overview panel — the metadata home for a platform project: name,
 * explicit cover (uploaded image, else the auto-derived canvas-first-frame
 * thumbnail) and the free-form description. Read-only for viewers.
 */
export function ProjectOverviewPanel({
  onNameCommitted,
}: {
  onNameCommitted: (name: string) => void;
}) {
  const { projectId } = useProjectContext();
  const { user } = useAuth();
  const t = useTranslations("project.overview");
  const common = useTranslations("common");
  const close = useProjectUIStore((state) => state.closeOverview);
  const queryClient = useQueryClient();
  const queryKey = ["platform-project-overview", user?.id ?? null, projectId];
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getProject(projectId, signal),
    enabled: Boolean(user),
    retry: false,
  });
  const unavailable =
    query.error instanceof ApiRequestError && [401, 403, 404, 410].includes(query.error.status);
  const recovery = query.isError ? (
    <div className="space-y-3 text-sm">
      <p role="alert" className="text-white/60">
        {errorMessage(query.error, t("loadFailed"))}
      </p>
      <Button size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>
        {common("retry")}
      </Button>
    </div>
  ) : null;
  if (!user || !query.data || unavailable)
    return (
      <>
        <DrawerPanel.Header
          title={t("title")}
          icon={<IconId className="size-4" stroke={1.7} />}
          closeLabel={common("close")}
          onClose={close}
        />
        <DrawerPanel.Body className="gap-5 px-4 pb-4">
          {recovery ?? (
            <p role="status" className="text-sm text-white/50">
              {common("loading")}
            </p>
          )}
        </DrawerPanel.Body>
      </>
    );
  return (
    <ProjectOverviewEditor
      key={`${user.id}:${projectId}`}
      project={query.data}
      recovery={recovery}
      onNameCommitted={onNameCommitted}
      onProjectUpdated={(next) => queryClient.setQueryData(queryKey, next)}
    />
  );
}

function ProjectOverviewEditor({
  project,
  recovery,
  onProjectUpdated,
  onNameCommitted,
}: {
  project: ProjectRef;
  recovery: ReactNode;
  onProjectUpdated: (next: ProjectRef) => void;
  onNameCommitted: (name: string) => void;
}) {
  const t = useTranslations("project.overview");
  const tProject = useTranslations("project");
  const tCommon = useTranslations("common");
  const { projectId, canEdit } = useProjectContext();
  const close = useProjectUIStore((state) => state.closeOverview);
  const queryClient = useQueryClient();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [descriptionBusy, setDescriptionBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Project reads and the home "recent projects" rail share the derived
   *  thumbnail, so a cover change must retire both caches. */
  const applyUpdate = (next: ProjectRef) => {
    onProjectUpdated(next);
    void queryClient.invalidateQueries({ queryKey: ["home-recent-projects"] });
  };

  const saveName = async () => {
    const trimmed = name.trim();
    if (nameBusy || !project || !trimmed || trimmed === project.name) return;
    setNameBusy(true);
    try {
      const next = await updateProject(projectId, { name: trimmed });
      setName(next.name);
      applyUpdate(next);
      // Keep the header's inline rename input showing the committed value.
      onNameCommitted(next.name);
      toast.success(t("nameSaved"));
    } catch (reason) {
      toast.error(errorMessage(reason, t("nameSaveFailed")));
    } finally {
      setNameBusy(false);
    }
  };

  const pickCover = async (file: File | undefined) => {
    if (!file || coverBusy || !project) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("coverNotImage"));
      return;
    }
    setCoverBusy(true);
    try {
      const uploaded = await uploadFileViaSignedUrl(file, {
        kind: "ai_reference_image",
        contentType: file.type,
        workspaceId: project.workspaceId,
      });
      applyUpdate(await updateProject(projectId, { coverAssetId: uploaded.mediaAssetId }));
      toast.success(t("coverUpdated"));
    } catch (reason) {
      toast.error(errorMessage(reason, t("coverUpdateFailed")));
    } finally {
      setCoverBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeCover = async () => {
    if (coverBusy || !project) return;
    setCoverBusy(true);
    try {
      applyUpdate(await updateProject(projectId, { coverAssetId: null }));
      toast.success(t("coverRemoved"));
    } catch (reason) {
      toast.error(errorMessage(reason, t("coverUpdateFailed")));
    } finally {
      setCoverBusy(false);
    }
  };

  const saveDescription = async () => {
    if (descriptionBusy || !project) return;
    setDescriptionBusy(true);
    try {
      const next = await updateProject(projectId, { description: description.trim() || null });
      setDescription(next.description ?? "");
      applyUpdate(next);
      toast.success(t("descriptionSaved"));
    } catch (reason) {
      toast.error(errorMessage(reason, t("descriptionSaveFailed")));
    } finally {
      setDescriptionBusy(false);
    }
  };

  const descriptionDirty = description !== (project?.description ?? "");

  return (
    <>
      <DrawerPanel.Header
        title={t("title")}
        icon={<IconId className="size-4" stroke={1.7} />}
        closeLabel={tCommon("close")}
        onClose={close}
      />
      <DrawerPanel.Body className="gap-5 px-4 pb-4">
        {recovery}
        <section className="space-y-2.5">
          <h3 className="text-xs font-semibold tracking-wide text-white/40 uppercase">
            {t("coverTitle")}
          </h3>
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/[0.08] bg-[#141414]">
            {project?.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={project.thumbnailUrl}
                alt={t("coverAlt")}
                className="size-full object-cover"
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-1.5 text-white/28">
                <IconPhoto className="size-7" stroke={1.4} />
                <span className="text-[11px]">{t("coverEmpty")}</span>
              </div>
            )}
            {coverBusy ? (
              <div className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[1px]">
                <IconLoader2 className="size-6 animate-spin text-white/85" stroke={1.6} />
              </div>
            ) : null}
          </div>
          {canEdit ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void pickCover(event.target.files?.[0]);
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={coverBusy || !project}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <IconPhotoUp className="size-4" stroke={1.7} />
                  {t("changeCover")}
                </Button>
                {project?.coverAssetId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={coverBusy}
                    onClick={() => void removeCover()}
                  >
                    <IconTrash className="size-4" stroke={1.7} />
                    {t("removeCover")}
                  </Button>
                ) : null}
              </div>
              <p className="text-[11px] leading-4 text-white/32">{t("coverHint")}</p>
            </>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-white/40 uppercase">
            {t("detailsTitle")}
          </h3>
          {canEdit ? (
            <div className="flex items-center gap-2">
              <Input
                value={name}
                aria-label={t("detailsName")}
                placeholder={tProject("untitled")}
                disabled={nameBusy || !project}
                maxLength={160}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveName();
                }}
                className="h-8 text-[13px]"
              />
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                disabled={nameBusy || !project || !name.trim() || name.trim() === project?.name}
                onClick={() => void saveName()}
              >
                {nameBusy ? <IconLoader2 className="size-4 animate-spin" stroke={1.7} /> : null}
                {tCommon("save")}
              </Button>
            </div>
          ) : (
            <p className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[13px] font-medium text-white/85">
              {project?.name ?? "—"}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-white/40 uppercase">
            {t("descriptionTitle")}
          </h3>
          {canEdit ? (
            <>
              <Textarea
                value={description}
                placeholder={t("descriptionPlaceholder")}
                disabled={descriptionBusy || !project}
                rows={4}
                maxLength={5000}
                onChange={(event) => setDescription(event.target.value)}
                className="resize-none text-[13px]"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] tabular-nums text-white/30">
                  {description.length}/5000
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={!descriptionDirty || descriptionBusy || !project}
                  onClick={() => void saveDescription()}
                >
                  {descriptionBusy ? (
                    <IconLoader2 className="size-4 animate-spin" stroke={1.7} />
                  ) : null}
                  {tCommon("save")}
                </Button>
              </div>
            </>
          ) : (
            <p className="min-h-16 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 text-[13px] leading-5 whitespace-pre-wrap text-white/70">
              {project?.description?.trim() || t("descriptionEmpty")}
            </p>
          )}
        </section>
      </DrawerPanel.Body>
    </>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
