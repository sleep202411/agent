"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  IconArrowLeft,
  IconCheck,
  IconDownload,
  IconFileUpload,
  IconLoader2,
  IconPhoto,
  IconPuzzle,
  IconSearch,
  IconShieldCheck,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DrawerPanel } from "@/components/ui/drawer-panel";
import { Field } from "@/components/ui/field";
import { SkillPreviewImage } from "@/components/project-skills/skill-preview-image";
import { cn } from "@/lib/utils";
import {
  installProjectSkill,
  importProjectSkill,
  setProjectSkillDefaults,
  uninstallProjectSkill,
  type ProjectSkillCatalogItem,
  type ProjectSkillKind,
  type ProjectSkillOwnerKind,
  type ProjectSkillScope,
} from "@/lib/project-skills-api";
import { useProjectContext } from "./project-context";
import { useProjectUIStore } from "../_stores/project-ui-store";

type CatalogFilter = "all" | ProjectSkillKind;

const CATALOG_FILTERS: readonly CatalogFilter[] = ["all", "general", "image", "video"];
const DEFAULT_SCOPES: readonly ProjectSkillScope[] = [
  "image_generation",
  "video_generation",
  "agent_prompt",
];
const SKILL_KIND_ICONS = { general: IconPuzzle, image: IconPhoto, video: IconVideo } as const;

function SkillDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 py-3">
      <dt className="text-[11px] leading-5 text-white/38">{label}</dt>
      <dd className="text-xs leading-5 text-white/78">{value}</dd>
    </div>
  );
}

function ownerKindOf(kind: "platform_project" | "story_project"): ProjectSkillOwnerKind {
  return kind === "platform_project" ? "platform" : "story";
}

export function ProjectSkillsPanel() {
  const t = useTranslations("project.skills");
  const { owner, projectSkills, projectSkillCatalog: catalog } = useProjectContext();
  const closeSkills = useProjectUIStore((state) => state.closeSkills);
  const selectedSkillId = useProjectUIStore((state) => state.selectedSkillId);
  const setSelectedSkillId = useProjectUIStore((state) => state.selectSkill);
  const queryClient = useQueryClient();
  const ownerKind = ownerKindOf(owner.kind);
  const projectId = owner.projectId;
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>("all");
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadScope, setUploadScope] = useState<"project" | "workspace">("project");
  const [uploadKind, setUploadKind] = useState<ProjectSkillKind>("general");
  const [uninstallTarget, setUninstallTarget] = useState<ProjectSkillCatalogItem | null>(null);
  const skillName = (skill: ProjectSkillCatalogItem) => {
    const key = translationKeyOf(skill);
    return key ? t(`items.${key}.name`) : skill.name;
  };
  const skillDescription = (skill: ProjectSkillCatalogItem) => {
    const key = translationKeyOf(skill);
    return key ? t(`items.${key}.description`) : skill.description;
  };

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["project-skills"] });
  };
  const installMutation = useMutation({
    mutationFn: (skill: ProjectSkillCatalogItem) =>
      installProjectSkill({
        ownerKind,
        projectId,
        skillId: skill.id,
        expectedProjectRevision: projectSkills.data?.projectRevision ?? 0,
      }),
    onSettled: invalidate,
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.install")),
  });
  const uninstallMutation = useMutation({
    mutationFn: (skill: ProjectSkillCatalogItem) => {
      if (!skill.installation) throw new Error(t("errors.notInstalled"));
      return uninstallProjectSkill({
        ownerKind,
        projectId,
        installation: skill.installation,
        expectedProjectRevision: projectSkills.data?.projectRevision ?? 0,
      });
    },
    onSuccess: () => {
      toast.success(t("uninstall.success"));
      setUninstallTarget(null);
      setSelectedSkillId(null);
    },
    onSettled: invalidate,
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.uninstall")),
  });
  const importMutation = useMutation({
    mutationFn: () => {
      if (!uploadFile) throw new Error(t("upload.fileRequired"));
      return importProjectSkill({
        ownerKind,
        projectId,
        file: uploadFile,
        scope: uploadScope,
        kind: uploadKind,
        expectedProjectRevision: projectSkills.data?.projectRevision ?? 0,
      });
    },
    onSuccess: (response) => {
      toast.success(t("upload.success", { name: response.skill.name }));
      setUploadOpen(false);
      setUploadFile(null);
      setSelectedSkillId(response.skill.id);
    },
    onSettled: invalidate,
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.upload")),
  });
  const defaultsMutation = useMutation({
    mutationFn: ({
      skill,
      scope,
    }: {
      skill: ProjectSkillCatalogItem;
      scope: ProjectSkillScope;
    }) => {
      const installation = skill.installation;
      if (!installation) throw new Error(t("errors.notInstalled"));
      const current = projectSkills.data?.installations ?? [];
      const enabled = installation.defaults.some(
        (item) => item.scope === scope && !item.workbenchMode && !item.sourceSurface
      );
      const installationIds = current
        .filter(
          (item) =>
            item.status === "active" &&
            item.defaults.some(
              (entry) => entry.scope === scope && !entry.workbenchMode && !entry.sourceSurface
            )
        )
        .map((item) => item.id)
        .filter((id) => id !== installation.id);
      if (!enabled) installationIds.push(installation.id);
      return setProjectSkillDefaults({
        ownerKind,
        projectId,
        scope,
        installationIds,
        expectedProjectRevision: projectSkills.data?.projectRevision ?? 0,
      });
    },
    onSettled: invalidate,
    onError: (error) => toast.error(error instanceof Error ? error.message : t("errors.defaults")),
  });

  const selectedSkill = catalog.data?.items.find((skill) => skill.id === selectedSkillId) ?? null;
  const skills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (catalog.data?.items ?? [])
      .filter((skill) => {
        if (catalogFilter !== "all" && skill.kind !== catalogFilter) return false;
        if (!normalizedQuery) return true;
        return `${skill.name} ${skill.description} ${skill.category}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      })
      .sort(
        (left, right) => Number(Boolean(right.installation)) - Number(Boolean(left.installation))
      );
  }, [catalog.data?.items, catalogFilter, query]);

  if (selectedSkill) {
    const SelectedKindIcon = SKILL_KIND_ICONS[selectedSkill.kind];
    const installation = selectedSkill.installation;
    const canManage = catalog.data?.canManage ?? false;
    const mutationPending =
      installMutation.isPending || uninstallMutation.isPending || defaultsMutation.isPending;
    const supportedDefaults = DEFAULT_SCOPES.filter((scope) =>
      (installation?.version ?? selectedSkill.latestVersion)?.capabilities.includes(scope)
    );
    return (
      <div className="flex min-h-0 flex-1 flex-col motion-safe:duration-150 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-3">
        <DrawerPanel.Header
          title={skillName(selectedSkill)}
          description={`${selectedSkill.publisherName} · ${t(`filters.${selectedSkill.kind}`)}`}
          icon={
            <button
              type="button"
              onClick={() => setSelectedSkillId(null)}
              aria-label={t("detail.back")}
              className="grid size-6 place-items-center rounded-lg text-white/62 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
            >
              <IconArrowLeft className="size-4" stroke={1.8} />
            </button>
          }
          closeLabel={t("close")}
          onClose={closeSkills}
        />

        <DrawerPanel.Body className="px-4 pb-5">
          <div className="relative aspect-3/2 shrink-0 overflow-hidden rounded-2xl bg-white/[0.055]">
            {selectedSkill.previewVideoUrl ? (
              <video
                src={selectedSkill.previewVideoUrl}
                poster={selectedSkill.previewUrl ?? undefined}
                controls
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-label={skillName(selectedSkill)}
                className="size-full object-cover"
              />
            ) : (
              <SkillPreviewImage
                src={selectedSkill.previewUrl}
                alt={skillName(selectedSkill)}
                sizes="288px"
                className="object-cover"
                fallbackIconClassName="size-10"
              />
            )}
            <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-lg bg-black/68 px-2 py-1 text-[10px] font-medium text-white/78 backdrop-blur-md">
              <SelectedKindIcon
                className={cn("size-3.5", selectedSkill.kind === "general" && "text-brand-yellow")}
                stroke={1.8}
              />
              {t("detail.effectPreview")}
            </div>
          </div>

          <section className="pt-5" aria-labelledby="skill-detail-about">
            <h3 id="skill-detail-about" className="text-sm font-semibold text-white/90">
              {t("detail.about")}
            </h3>
            <dl className="mt-2 space-y-1">
              <SkillDetailRow
                label={t("detail.introduction")}
                value={skillDescription(selectedSkill)}
              />
              <SkillDetailRow
                label={t("detail.category")}
                value={t(`filters.${selectedSkill.kind}`)}
              />
              <SkillDetailRow
                label={t("detail.appliesToLabel")}
                value={t(`detail.appliesTo.${selectedSkill.kind}`)}
              />
              <SkillDetailRow
                label={t("detail.howToUseLabel")}
                value={t(`detail.howToUse.${selectedSkill.kind}`)}
              />
              <SkillDetailRow
                label={t("detail.outputLabel")}
                value={t(`detail.output.${selectedSkill.kind}`)}
              />
            </dl>
          </section>

          {installation && supportedDefaults.length > 0 ? (
            <section className="mt-6">
              <h3 className="text-xs font-semibold text-white/82">{t("detail.defaultsTitle")}</h3>
              <p className="mt-1 text-[11px] leading-4 text-white/38">
                {t("detail.defaultsDescription")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {supportedDefaults.map((scope) => {
                  const active = installation.defaults.some(
                    (item) => item.scope === scope && !item.workbenchMode && !item.sourceSurface
                  );
                  return (
                    <button
                      key={scope}
                      type="button"
                      disabled={!canManage || mutationPending}
                      onClick={() => defaultsMutation.mutate({ skill: selectedSkill, scope })}
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                        active
                          ? "bg-white text-black"
                          : "bg-white/[0.07] text-white/58 hover:bg-white/[0.11] hover:text-white/82"
                      )}
                    >
                      {active ? <IconCheck className="size-3.5" stroke={2} /> : null}
                      {t(`scopes.${scope}`)}
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}
        </DrawerPanel.Body>

        <DrawerPanel.Footer divider={false}>
          {installation ? (
            <div className="flex min-w-0 gap-2">
              <Button disabled variant="secondary" className="min-w-0 flex-1 disabled:opacity-100">
                <IconCheck className="size-4" stroke={2} />
                {t("detail.installed")}
              </Button>
              <Button
                variant="destructive"
                className="px-3"
                disabled={!canManage || mutationPending}
                aria-label={t("detail.uninstall")}
                onClick={() => setUninstallTarget(selectedSkill)}
              >
                <IconTrash className="size-4" stroke={1.8} />
                {t("detail.remove")}
              </Button>
            </div>
          ) : (
            <Button
              block
              disabled={!canManage || mutationPending}
              onClick={() => installMutation.mutate(selectedSkill)}
            >
              {installMutation.isPending ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {t("detail.addSkill")}
            </Button>
          )}
          {!canManage ? (
            <p className="mt-2 text-center text-[10px] text-white/34">
              {t("detail.managePermission")}
            </p>
          ) : null}
        </DrawerPanel.Footer>

        <AlertDialog
          open={uninstallTarget !== null}
          onOpenChange={(open) => !open && !uninstallMutation.isPending && setUninstallTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("uninstall.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {uninstallTarget
                  ? t("uninstall.description", { name: skillName(uninstallTarget) })
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={uninstallMutation.isPending}>
                {t("uninstall.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={uninstallMutation.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  if (uninstallTarget) uninstallMutation.mutate(uninstallTarget);
                }}
              >
                {uninstallMutation.isPending ? (
                  <IconLoader2 className="size-4 animate-spin" />
                ) : (
                  <IconTrash className="size-4" stroke={1.8} />
                )}
                {t("uninstall.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <>
      <DrawerPanel.Header
        title={t("title")}
        count={catalog.data?.items.length}
        icon={<IconPuzzle className="text-brand-yellow size-4" stroke={1.8} />}
        description={t("catalogDescription")}
        closeLabel={t("close")}
        onClose={closeSkills}
      />

      <div
        role="tablist"
        aria-label={t("filterLabel")}
        className="mx-4 mb-3 flex shrink-0 items-center gap-4 border-b border-white/[0.07]"
      >
        {CATALOG_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            role="tab"
            aria-selected={catalogFilter === filter}
            onClick={() => setCatalogFilter(filter)}
            className={cn(
              "relative h-8 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
              catalogFilter === filter ? "text-white/92" : "text-white/38 hover:text-white/68"
            )}
          >
            {t(`filters.${filter}`)}
            {catalogFilter === filter ? (
              <span className="absolute inset-x-0 bottom-0 h-px bg-white/75" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="mx-4 mb-3 flex h-9 shrink-0 items-center gap-2.5 rounded-xl bg-white/[0.065] px-3 focus-within:bg-white/[0.09]">
        <IconSearch className="size-4 shrink-0 text-white/44" stroke={1.7} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-xs text-white/88 outline-none placeholder:text-white/34"
        />
      </div>

      <DrawerPanel.Body className="px-3 pb-4">
        {catalog.loading ? (
          <div className="grid place-items-center py-16 text-white/45">
            <IconLoader2 className="size-5 animate-spin" stroke={1.7} />
          </div>
        ) : catalog.error ? (
          <button
            type="button"
            onClick={catalog.retry}
            className="mx-auto block px-3 py-10 text-center text-xs leading-5 text-white/52 hover:text-white/78"
          >
            {t("loadFailed")}
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-x-2 gap-y-3">
            {skills.map((skill) => {
              const name = skillName(skill);
              return (
                <article key={skill.id} className="min-w-0">
                  <button
                    type="button"
                    aria-label={t("detail.open", { name })}
                    onClick={() => setSelectedSkillId(skill.id)}
                    className="group block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                  >
                    <div className="relative aspect-3/2 overflow-hidden rounded-xl bg-white/[0.055]">
                      <SkillPreviewImage
                        src={skill.previewUrl}
                        alt={name}
                        sizes="134px"
                        className="object-cover transition-transform duration-200 group-hover:scale-[1.025]"
                      />
                      {skill.ownershipScope !== "community" ? (
                        <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-white/65 backdrop-blur-sm">
                          {t(`ownership.${skill.ownershipScope}`)}
                        </span>
                      ) : null}
                      {skill.installation ? (
                        <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-white text-black shadow-sm">
                          <IconCheck className="size-3" stroke={2.3} />
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-1.5 line-clamp-2 min-h-8 px-0.5 text-[11px] leading-4 font-medium text-white/78 transition-colors group-hover:text-white/95">
                      {name}
                    </h3>
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {!catalog.loading && !catalog.error && skills.length === 0 ? (
          <p className="px-3 py-10 text-center text-xs leading-5 text-white/38">{t("noMatches")}</p>
        ) : null}
      </DrawerPanel.Body>

      {(catalog.data?.canManage ?? false) ? (
        <DrawerPanel.Footer>
          <Button block variant="secondary" onClick={() => setUploadOpen(true)}>
            <IconFileUpload className="size-4" stroke={1.8} />
            {t("upload.open")}
          </Button>
        </DrawerPanel.Footer>
      ) : null}

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          if (!open && importMutation.isPending) return;
          setUploadOpen(open);
          if (!open) setUploadFile(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("upload.title")}</DialogTitle>
            <DialogDescription>{t("upload.description")}</DialogDescription>
          </DialogHeader>

          <Field
            label={t("upload.fileLabel")}
            required
            action={
              <Button asChild variant="ghost" size="xs">
                <a href="/skills/templates/SKILL.md" download="SKILL.md">
                  <IconDownload className="size-3" stroke={1.8} />
                  {t("upload.downloadTemplate")}
                </a>
              </Button>
            }
          >
            <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-white/[0.055] px-4 text-center transition-colors hover:bg-white/[0.085] focus-within:ring-2 focus-within:ring-white/35">
              <IconFileUpload className="size-5 text-white/52" stroke={1.7} />
              <span className="text-xs font-medium text-white/78">
                {uploadFile?.name ?? t("upload.chooseFile")}
              </span>
              <span className="text-[10px] leading-4 text-white/36">{t("upload.fileHint")}</span>
              <input
                type="file"
                disabled={importMutation.isPending}
                accept=".md,.zip,text/markdown,application/zip"
                className="sr-only"
                aria-required="true"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  if (file && file.size > 1_048_576) {
                    toast.error(t("upload.fileTooLarge"));
                    event.target.value = "";
                    setUploadFile(null);
                    return;
                  }
                  setUploadFile(file);
                }}
              />
            </label>
            <p className="flex items-start gap-1.5 text-[10px] leading-4 text-white/36">
              <IconShieldCheck
                className="mt-0.5 size-3 shrink-0 text-[var(--skill-accent,#facc15)]"
                stroke={1.8}
              />
              <span>{t("upload.zipSafety")}</span>
            </p>
          </Field>

          <Field label={t("upload.scopeLabel")} required>
            <div className="grid grid-cols-2 gap-2">
              {(["project", "workspace"] as const).map((scope) => {
                const disabled =
                  importMutation.isPending ||
                  (scope === "workspace" && !catalog.data?.canManageWorkspace);
                return (
                  <button
                    key={scope}
                    type="button"
                    disabled={disabled}
                    aria-pressed={uploadScope === scope}
                    onClick={() => setUploadScope(scope)}
                    className={cn(
                      "rounded-xl px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35",
                      uploadScope === scope
                        ? "bg-white text-black"
                        : "bg-white/[0.055] text-white/68 hover:bg-white/[0.09]"
                    )}
                  >
                    <span className="block text-xs font-semibold">
                      {t(`upload.scopes.${scope}`)}
                    </span>
                    <span
                      className={cn(
                        "mt-1 block text-[10px] leading-4",
                        uploadScope === scope ? "text-black/58" : "text-white/36"
                      )}
                    >
                      {t(`upload.scopeDescriptions.${scope}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label={t("upload.kindLabel")} required>
            <div className="grid grid-cols-3 gap-2">
              {(["general", "image", "video"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={importMutation.isPending}
                  aria-pressed={uploadKind === kind}
                  onClick={() => setUploadKind(kind)}
                  className={cn(
                    "h-9 rounded-xl text-xs font-medium transition-colors",
                    uploadKind === kind
                      ? "bg-white text-black"
                      : "bg-white/[0.055] text-white/58 hover:bg-white/[0.09] hover:text-white/82"
                  )}
                >
                  {t(`filters.${kind}`)}
                </button>
              ))}
            </div>
          </Field>

          <DialogFooter>
            <Button
              variant="ghost"
              disabled={importMutation.isPending}
              onClick={() => setUploadOpen(false)}
            >
              {t("upload.cancel")}
            </Button>
            <Button
              loading={importMutation.isPending}
              disabled={!uploadFile}
              onClick={() => importMutation.mutate()}
            >
              {t("upload.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function translationKeyOf(skill: ProjectSkillCatalogItem): string | null {
  if (!skill.localizedMetadata || typeof skill.localizedMetadata !== "object") return null;
  const key = (skill.localizedMetadata as { translationKey?: unknown }).translationKey;
  return typeof key === "string" && key ? key : null;
}
