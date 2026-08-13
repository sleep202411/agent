"use client";

import { useTranslations } from "next-intl";
import {
  IconAlertTriangle,
  IconCheck,
  IconLoader2,
  IconPhoto,
  IconPuzzle,
  IconVideo,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { SkillPreviewImage } from "@/components/project-skills/skill-preview-image";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectSkillCatalogItem, ProjectSkillScope } from "@/lib/project-skills-api";
import { cn } from "@/lib/utils";

const KIND_ICONS = { general: IconPuzzle, image: IconPhoto, video: IconVideo } as const;
const VISIBLE_DEFAULT_SCOPES: readonly ProjectSkillScope[] = [
  "image_generation",
  "video_generation",
  "agent_prompt",
];

function translationKeyOf(skill: ProjectSkillCatalogItem): string | null {
  if (!skill.localizedMetadata || typeof skill.localizedMetadata !== "object") return null;
  const key = (skill.localizedMetadata as { translationKey?: unknown }).translationKey;
  return typeof key === "string" && key ? key : null;
}

function DetailFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-4 py-2.5">
      <dt className="text-[11px] leading-5 text-white/38">{label}</dt>
      <dd className="text-xs leading-5 text-white/76">{value}</dd>
    </div>
  );
}

export function ProjectSkillDetailDialog({
  open,
  skill,
  loading = false,
  error = false,
  activeForGeneration = false,
  actionPending = false,
  canInstall = false,
  onManage,
  onUse,
  onOpenChange,
  onRetry,
}: {
  open: boolean;
  skill: ProjectSkillCatalogItem | null;
  loading?: boolean;
  error?: boolean;
  activeForGeneration?: boolean;
  actionPending?: boolean;
  canInstall?: boolean;
  onManage?: (skillId: string) => void;
  onUse?: (skill: ProjectSkillCatalogItem) => void;
  onOpenChange: (open: boolean) => void;
  onRetry?: () => void;
}) {
  const t = useTranslations("project.skills");
  const tc = useTranslations("common");

  if (!skill) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(480px,calc(100vw-2rem))] max-w-none rounded-3xl bg-[#151515] p-6 sm:max-w-[480px]">
          <DialogHeader>
            <span className="text-brand-yellow ring-brand-yellow/25 inline-flex size-8 items-center justify-center rounded-xl ring-1 ring-inset">
              <IconPuzzle className="size-4" stroke={1.8} />
            </span>
            <DialogTitle className="mt-3 text-lg font-semibold text-white/92">
              {t("detail.dialogTitle")}
            </DialogTitle>
            <DialogDescription className="text-white/42">
              {error ? t("detail.loadFailed") : t("detail.loading")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-28 place-items-center">
            {error ? (
              <IconAlertTriangle className="size-7 text-destructive" stroke={1.6} />
            ) : (
              <IconLoader2 className={cn("size-7 text-white/42", loading && "animate-spin")} />
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{tc("close")}</Button>
            </DialogClose>
            {error && onRetry ? (
              <Button variant="secondary" onClick={onRetry}>
                {tc("retry")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const translationKey = translationKeyOf(skill);
  const name = translationKey ? t(`items.${translationKey}.name`) : skill.name;
  const description = translationKey ? t(`items.${translationKey}.description`) : skill.description;
  const KindIcon = KIND_ICONS[skill.kind];
  const installedDefaults = VISIBLE_DEFAULT_SCOPES.filter((scope) =>
    skill.installation?.defaults.some(
      (activation) =>
        activation.scope === scope && !activation.workbenchMode && !activation.sourceSurface
    )
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[min(860px,calc(100vw-2rem))] max-w-none grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-3xl bg-[#151515] p-0 shadow-[0_28px_96px_rgba(0,0,0,0.62)] sm:max-w-[860px]">
        <div className="min-h-0 overflow-y-auto">
          <DialogHeader className="px-6 pt-6 pr-16 pb-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-brand-yellow ring-brand-yellow/25 inline-flex size-8 items-center justify-center rounded-xl bg-transparent ring-1 ring-inset">
                <KindIcon className="size-4" stroke={1.8} />
              </span>
              {activeForGeneration ? (
                <span className="bg-brand-yellow/10 text-brand-yellow inline-flex h-6 items-center gap-1 rounded-lg px-2 text-[10px] font-medium">
                  <IconCheck className="size-3" stroke={2} />
                  {t("detail.activeForGeneration")}
                </span>
              ) : null}
            </div>
            <DialogTitle className="mt-3 text-xl leading-tight font-semibold text-white/94">
              {name}
            </DialogTitle>
            <DialogDescription className="text-xs text-white/42">
              {skill.publisherName} · {t(`filters.${skill.kind}`)}
            </DialogDescription>
          </DialogHeader>

          <div className="px-6">
            <div className="relative aspect-[16/7] overflow-hidden rounded-2xl bg-white/[0.05]">
              {skill.previewVideoUrl ? (
                <video
                  src={skill.previewVideoUrl}
                  poster={skill.previewUrl ?? undefined}
                  controls
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-label={name}
                  className="size-full object-cover"
                />
              ) : (
                <SkillPreviewImage
                  src={skill.previewUrl}
                  alt={name}
                  sizes="(max-width: 768px) calc(100vw - 80px), 812px"
                  className="object-cover"
                  fallbackIconClassName="size-12"
                />
              )}
              <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-lg bg-black/68 px-2 py-1 text-[10px] font-medium text-white/78 backdrop-blur-md">
                <KindIcon
                  className={cn("size-3.5", skill.kind === "general" && "text-brand-yellow")}
                  stroke={1.8}
                />
                {t("detail.effectPreview")}
              </span>
            </div>
          </div>

          <div className="grid gap-6 px-6 py-6 md:grid-cols-[minmax(0,1fr)_240px]">
            <section aria-labelledby="inline-skill-about">
              <h3 id="inline-skill-about" className="text-sm font-semibold text-white/90">
                {t("detail.about")}
              </h3>
              <dl className="mt-2">
                <DetailFact label={t("detail.introduction")} value={description} />
                <DetailFact
                  label={t("detail.appliesToLabel")}
                  value={t(`detail.appliesTo.${skill.kind}`)}
                />
                <DetailFact
                  label={t("detail.howToUseLabel")}
                  value={t(`detail.howToUse.${skill.kind}`)}
                />
                <DetailFact
                  label={t("detail.outputLabel")}
                  value={t(`detail.output.${skill.kind}`)}
                />
              </dl>
            </section>

            <section aria-labelledby="inline-skill-defaults">
              <h3 id="inline-skill-defaults" className="text-sm font-semibold text-white/90">
                {t("detail.projectDefaults")}
              </h3>
              {!skill.installation ? (
                <p className="mt-2 text-xs leading-5 text-white/38">{t("detail.installToUse")}</p>
              ) : installedDefaults.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {installedDefaults.map((scope) => (
                    <span
                      key={scope}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-white/[0.07] px-2.5 text-[11px] font-medium text-white/66"
                    >
                      <IconCheck className="text-brand-yellow size-3.5" stroke={2} />
                      {t(`scopes.${scope}`)}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs leading-5 text-white/38">
                  {t("detail.noProjectDefaults")}
                </p>
              )}
            </section>
          </div>
        </div>

        <DialogFooter className="shrink-0 px-6 pb-6">
          <DialogClose asChild>
            <Button variant="ghost">{tc("close")}</Button>
          </DialogClose>
          {onUse ? (
            <div className="flex flex-col items-end gap-1.5">
              <Button
                disabled={actionPending || (!skill.installation && !canInstall)}
                onClick={() => onUse(skill)}
              >
                {actionPending ? (
                  <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
                ) : null}
                {skill.installation ? t("detail.useSkill") : t("detail.installAndUse")}
              </Button>
              {!skill.installation && !canInstall ? (
                <p className="text-[10px] leading-4 text-white/34">
                  {t("detail.managePermission")}
                </p>
              ) : null}
            </div>
          ) : onManage ? (
            <Button variant="secondary" onClick={() => onManage(skill.id)}>
              {t("detail.manageSkill")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
