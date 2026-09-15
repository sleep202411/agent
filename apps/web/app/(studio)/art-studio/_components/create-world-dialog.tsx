"use client";

import { useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useRouter } from "next/navigation";
import {
  IconArrowRight,
  IconBox,
  IconCamera,
  IconClock,
  IconCloudUpload,
  IconFileText,
  IconLanguage,
  IconLoader2,
  IconMovie,
  IconSparkles,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { AiSuggestedChip } from "@/components/ui/ai-suggested-chip";
import { cn } from "@/lib/utils";
import { backendApi } from "@/src/lib/api";
import {
  uploadWorkspaceFile,
  type UploadedWorkspaceFile,
} from "@/src/lib/uploads/workspace-upload";
import { useTranslations } from "@/src/i18n/i18n";
import { localizedProjectWorkspaceHref } from "@/src/lib/studio-routes";
import { worldKeys } from "@/src/hooks/use-worlds";
import { useSparkAnalyze } from "@/app/(site)/ips/_hooks/use-spark";

/** Payload returned by `/api/user/world/create/quick/worldproduct`. */
type CreateQuickWorldResult = {
  worldId: string;
  projectId: string;
};

const SOURCE_MAX_SIZE_MB = 25;
const SOURCE_MAX_SIZE_BYTES = SOURCE_MAX_SIZE_MB * 1024 * 1024;
const SOURCE_ACCEPT = ".pdf,.doc,.docx,.txt,.md";
const CREATE_WORLD_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

type FormErrors = {
  name?: string;
};

type SourceFileState = Pick<UploadedWorkspaceFile, "path" | "url" | "name" | "size" | "mimeType">;

type StoryOsInsights = {
  episodeCount?: number;
  runtimeMinutes?: number;
  language?: string;
  roleCount?: number;
  sceneCount?: number;
  propCount?: number;
  textRef?: string;
  sourceChars?: number;
  sourceExcerpt?: string;
};

type CreateWorldDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called on success with the new (worldId, projectId). */
  onCreated?: (result: CreateQuickWorldResult) => void;
};
export function CreateWorldDialog(props: CreateWorldDialogProps) {
  const { user } = useCurrentUser();
  return <CreateWorldForm key={user?.id ?? "guest"} {...props} />;
}
function CreateWorldForm({ open, onOpenChange, onCreated }: CreateWorldDialogProps) {
  const tw = useTranslations("workspace");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [insights, setInsights] = useState<StoryOsInsights>({});
  const [sourceUploading, setSourceUploading] = useState(false);
  const [sourceFile, setSourceFile] = useState<SourceFileState | null>(null);
  const [sourceDragOver, setSourceDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [aiFilledFields, setAiFilledFields] = useState<Set<"name" | "description">>(new Set());
  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  const sparkAnalyze = useSparkAnalyze();
  const [openScope, setOpenScope] = useState({ open });
  const active = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const nameDraft = useRef("");
  const descriptionDraft = useRef("");
  useLayoutEffect(() => {
    active.current = openScope.open;
    nameDraft.current = "";
    descriptionDraft.current = "";
    return () => {
      active.current = false;
      operation.current?.abort();
      operation.current = null;
    };
  }, [openScope]);
  const owns = (run: AbortController) =>
    active.current && operation.current === run && !run.signal.aborted;

  const markAi = (field: "name" | "description") => {
    setAiFilledFields((prev) => {
      if (prev.has(field)) return prev;
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  };
  const clearAi = (field: "name" | "description") => {
    setAiFilledFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  const resetFields = () => {
    setName("");
    setDescription("");
    setTags([]);
    setInsights({});
    setSourceUploading(false);
    setSourceFile(null);
    setSourceDragOver(false);
    setSubmitting(false);
    setErrors({});
    setAiFilledFields(new Set());
  };
  const reset = () => {
    resetFields();
    if (sourceInputRef.current) sourceInputRef.current.value = "";
  };
  if (openScope.open !== open) {
    setOpenScope({ open });
    resetFields();
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      active.current = false;
      operation.current?.abort();
      operation.current = null;
      reset();
    }
    onOpenChange(next);
  };

  const handleSourceFile = async (file: File) => {
    if (!active.current || operation.current) return;
    const run = new AbortController();
    operation.current = run;
    setSourceUploading(true);
    try {
      const uploaded = await uploadWorkspaceFile(file, {
        signal: run.signal,
        uploadType: "WORLD",
        sourceType: "LOCAL",
        accept: SOURCE_ACCEPT,
        maxSize: SOURCE_MAX_SIZE_BYTES,
      });
      if (!owns(run)) return;
      setSourceFile(uploaded);

      // Auto-fill name + description from the uploaded brief, mirroring
      // create-ip-dialog. Same /aurora/spark/analyze endpoint — it
      // returns { name?, description? } and we only apply fields the
      // user hasn't already typed. Failure is non-fatal: the upload
      // succeeded, the user can fill the form manually.
      try {
        const draft = await sparkAnalyze.mutateAsync({ file, signal: run.signal });
        if (!owns(run)) return;
        if (draft.name && !nameDraft.current.trim()) {
          nameDraft.current = draft.name;
          setName(draft.name);
          markAi("name");
        }
        if (draft.description && !descriptionDraft.current.trim()) {
          descriptionDraft.current = draft.description;
          setDescription(draft.description);
          markAi("description");
        }
        if (draft.tags?.length) setTags(draft.tags);
        setInsights({
          episodeCount: draft.episodeCount,
          runtimeMinutes: draft.runtimeMinutes,
          language: draft.language,
          roleCount: draft.roleCount,
          sceneCount: draft.sceneCount,
          propCount: draft.propCount,
          textRef: draft.textRef,
          sourceChars: draft.sourceChars,
          sourceExcerpt: draft.sourceExcerpt,
        });
      } catch (analyzeErr) {
        if (!owns(run)) return;
        console.warn("[CreateWorldDialog] spark analyze failed:", analyzeErr);
      }
    } catch (err) {
      if (!owns(run)) return;
      console.error("[CreateWorldDialog] 上传故事素材失败:", err);
      const message = err instanceof Error ? err.message : "";
      if (message === "unsupportedFileType") {
        toast.error(tw("createWorldSourceUnsupported"));
      } else if (message === "fileSizeExceedMb") {
        toast.error(tw("createWorldSourceTooLarge", { size: SOURCE_MAX_SIZE_MB }));
      } else {
        toast.error(tw("createWorldSourceUploadFailed"));
      }
    } finally {
      if (owns(run)) {
        operation.current = null;
        setSourceUploading(false);
        setSourceDragOver(false);
        if (sourceInputRef.current) sourceInputRef.current.value = "";
      }
    }
  };

  const handleSourceDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (sourceUploading) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void handleSourceFile(file);
  };

  const validate = (): boolean => {
    const next: FormErrors = {};
    const trimmedName = name.trim();
    if (!trimmedName) next.name = tw("createWorldNameRequired");
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!active.current || operation.current) return;
    if (!validate()) return;

    const run = new AbortController();
    operation.current = run;
    setSubmitting(true);
    try {
      // Mirrors the legacy `createQuickWorldProduct` call: Java's
      // `/quick/worldproduct` endpoint creates a world + its first
      // project in one shot. We pass name + description (and the
      // uploaded source brief if present); cover/banner is handled
      // later inside the studio. Response is `{ worldId, projectId }`
      // — used to jump straight into the new project detail.
      const result = await backendApi.post<CreateQuickWorldResult>(
        "/api/user/world/create/quick/worldproduct",
        {
          signal: run.signal,
          data: {
            name: name.trim(),
            description: description.trim() || undefined,
            sourceMaterial: sourceFile
              ? {
                  path: sourceFile.path,
                  url: sourceFile.url,
                  name: sourceFile.name,
                  size: sourceFile.size,
                  mimeType: sourceFile.mimeType,
                }
              : undefined,
          },
        }
      );

      if (!owns(run)) return;
      await queryClient.invalidateQueries({ queryKey: worldKeys.all });
      if (!owns(run)) return;
      toast.success(tw("createWorldSuccess"));
      reset();
      onOpenChange(false);

      if (result?.projectId && result?.worldId) {
        // Always land in the studio chat, regardless
        // of whether the user attached source material. The 一键成片
        // pipeline (`/produce`) is intentionally **not reachable from
        // this entry point right now** — even with a file uploaded, we
        // keep the user in the freeform chat surface where they can
        // describe what they want and let the supervisor route from
        // there. Re-enable the `/produce` branch once that pipeline is
        // ready for end-users again.
        router.push(
          localizedProjectWorkspaceHref(result.projectId, {
            worldId: result.worldId,
          })
        );
        onCreated?.(result);
      }
    } catch (err) {
      if (!owns(run)) return;
      console.error("[CreateWorldDialog] 创建世界失败:", err);
      toast.error(err instanceof Error ? err.message : tw("createWorldFailed"));
    } finally {
      if (owns(run)) {
        operation.current = null;
        setSubmitting(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={CREATE_WORLD_HERO_URL}
          eyebrow={tw("createWorldHeroEyebrow")}
          title={tw("createWorldDialogTitle")}
          description={tw("createWorldHeroSubtitle")}
        />

        <DialogBody className="px-4 py-4">
          <input
            ref={sourceInputRef}
            type="file"
            accept={SOURCE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleSourceFile(file);
            }}
          />

          <FieldGroup>
            {sourceFile ? (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  {sparkAnalyze.isPending ? (
                    <IconLoader2 className="size-5 animate-spin" />
                  ) : (
                    <IconFileText className="size-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {sourceFile.name}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {sparkAnalyze.isPending ? (
                      <>
                        <IconSparkles className="size-3 text-violet-300" />
                        <span className="text-violet-300">{tw("createWorldSourceAnalyzing")}</span>
                      </>
                    ) : (
                      <span>{formatFileSize(sourceFile.size)}</span>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  color="muted"
                  onClick={() => sourceInputRef.current?.click()}
                  disabled={submitting || sourceUploading || sparkAnalyze.isPending}
                >
                  {tw("createWorldSourceReplace")}
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  color="muted"
                  onClick={() => {
                    if (operation.current || !active.current) return;
                    setSourceFile(null);
                    // The chips reflect "values came from this brief".
                    // Once the brief is gone, the chip claim is no
                    // longer meaningful — leave the typed values but
                    // drop the AI provenance.
                    if (aiFilledFields.has("name")) clearAi("name");
                    if (aiFilledFields.has("description")) clearAi("description");
                  }}
                  aria-label={tw("createWorldSourceRemove")}
                  disabled={submitting || sourceUploading || sparkAnalyze.isPending}
                >
                  <IconX className="size-3.5" />
                </Button>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!sourceUploading) sourceInputRef.current?.click();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!sourceUploading) sourceInputRef.current?.click();
                  }
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!sourceUploading) setSourceDragOver(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (!sourceUploading) setSourceDragOver(true);
                }}
                onDragLeave={() => setSourceDragOver(false)}
                onDrop={handleSourceDrop}
                className={cn(
                  "group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center transition-colors",
                  sourceDragOver
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/35",
                  sourceUploading && "cursor-wait opacity-70"
                )}
              >
                <div
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full transition-colors",
                    sourceDragOver
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                  )}
                >
                  {sourceUploading ? (
                    <IconLoader2 className="size-5 animate-spin" />
                  ) : sourceDragOver ? (
                    <IconCloudUpload className="size-5" />
                  ) : (
                    <IconFileText className="size-5" />
                  )}
                </div>
                <div className="text-sm font-semibold text-foreground">
                  {sourceUploading
                    ? tw("createWorldSourceUploading")
                    : tw("createWorldSourceIdleTitle")}
                </div>
                <p className="max-w-[360px] text-xs leading-relaxed text-muted-foreground">
                  {tw("createWorldSourceIdleHint", { size: SOURCE_MAX_SIZE_MB })}
                </p>
              </div>
            )}

            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="create-world-name" required>
                {tw("createWorldNameLabel")}
                {aiFilledFields.has("name") && <AiSuggestedChip label={tw("aiSuggested")} />}
              </FieldLabel>
              <Input
                id="create-world-name"
                value={name}
                disabled={submitting}
                onChange={(event) => {
                  nameDraft.current = event.target.value;
                  setName(event.target.value);
                  clearAi("name");
                  if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
                }}
                placeholder={tw("createWorldNamePlaceholder")}
                aria-invalid={Boolean(errors.name)}
              />
              {errors.name && <FieldError>{errors.name}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="create-world-description">
                {tw("createWorldDescriptionLabel")}
                {aiFilledFields.has("description") && <AiSuggestedChip label={tw("aiSuggested")} />}
              </FieldLabel>
              <Textarea
                id="create-world-description"
                // Cap height + scroll so a long brief doesn't push the
                // dialog footer out — same fix used in create-ip-dialog.
                className="max-h-40 overflow-y-auto"
                value={description}
                disabled={submitting}
                rows={3}
                onChange={(event) => {
                  descriptionDraft.current = event.target.value;
                  setDescription(event.target.value);
                  clearAi("description");
                }}
                placeholder={tw("createWorldDescriptionPlaceholder")}
              />
            </Field>

            {/* StoryOS breakdown — only rendered while spark is
                analyzing so the user sees a skeleton during the wait.
                Once analysis finishes, the AI-suggested chips on the
                Name / Description fields already signal the AI ran;
                the bulky stat grid + theme chips would otherwise push
                the dialog footer (with the one-click CTA) below the
                fold. The footer button is what now carries the "一键成
                片 / Start Creating" intent — see DialogFooter below. */}
            {sparkAnalyze.isPending && (
              <StoryOsBreakdownCard
                analyzing
                tags={tags}
                insights={insights}
                heading={tw("createWorldStoryOsHeading")}
                analyzingHint={tw("createWorldStoryOsAnalyzing")}
                emptyHint={tw("createWorldStoryOsEmpty")}
                tagsLabel={tw("createWorldStoryOsTags")}
                ctaLine={tw("createWorldStoryOsCta")}
                statLabels={{
                  episodes: tw("createWorldStoryOsEpisodes"),
                  runtime: tw("createWorldStoryOsRuntime"),
                  language: tw("createWorldStoryOsLanguage"),
                  roles: tw("createWorldStoryOsRoles"),
                  scenes: tw("createWorldStoryOsScenes"),
                  props: tw("createWorldStoryOsProps"),
                  runtimeUnit: tw("createWorldStoryOsRuntimeUnit"),
                }}
              />
            )}
          </FieldGroup>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            color="muted"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {tc("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || sourceUploading || sparkAnalyze.isPending}
          >
            {submitting ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {/* Always the generic Studio entry label — the file-aware
                "一键成片" variant is suppressed for now because the
                `/produce` pipeline isn't reachable from this dialog
                (see handleSubmit above). Reinstate the conditional
                when /produce is wired back in. */}
            {tw("createWorldSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function StoryOsBreakdownCard({
  analyzing,
  tags,
  insights,
  heading,
  analyzingHint,
  emptyHint,
  tagsLabel,
  ctaLine,
  statLabels,
}: {
  analyzing: boolean;
  tags: string[];
  insights: StoryOsInsights;
  heading: string;
  analyzingHint: string;
  emptyHint: string;
  tagsLabel: string;
  ctaLine: string;
  statLabels: {
    episodes: string;
    runtime: string;
    language: string;
    roles: string;
    scenes: string;
    props: string;
    runtimeUnit: string;
  };
}) {
  // Build the stat list once so we can hide cells with no value while
  // keeping the grid layout consistent. Order mirrors the production
  // pipeline: outline → episodes → runtime → language → roles →
  // scenes → props.
  const stats: Array<{
    key: string;
    label: string;
    value: string;
    Icon: typeof IconMovie;
  }> = [];
  if (insights.episodeCount != null) {
    stats.push({
      key: "episodes",
      label: statLabels.episodes,
      value: String(insights.episodeCount),
      Icon: IconMovie,
    });
  }
  if (insights.runtimeMinutes != null) {
    stats.push({
      key: "runtime",
      label: statLabels.runtime,
      value: `${insights.runtimeMinutes}${statLabels.runtimeUnit}`,
      Icon: IconClock,
    });
  }
  if (insights.language) {
    stats.push({
      key: "language",
      label: statLabels.language,
      value: insights.language,
      Icon: IconLanguage,
    });
  }
  if (insights.roleCount != null) {
    stats.push({
      key: "roles",
      label: statLabels.roles,
      value: String(insights.roleCount),
      Icon: IconUsers,
    });
  }
  if (insights.sceneCount != null) {
    stats.push({
      key: "scenes",
      label: statLabels.scenes,
      value: String(insights.sceneCount),
      Icon: IconCamera,
    });
  }
  if (insights.propCount != null) {
    stats.push({
      key: "props",
      label: statLabels.props,
      value: String(insights.propCount),
      Icon: IconBox,
    });
  }

  return (
    <div className="rounded-xl border border-violet-400/20 bg-gradient-to-br from-violet-500/[0.06] via-transparent to-violet-400/[0.03] p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-violet-500/15 text-violet-300">
          <IconSparkles className="size-3.5" />
        </span>
        <div className="text-sm font-semibold text-foreground">{heading}</div>
      </div>

      {analyzing ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <IconLoader2 className="size-3.5 animate-spin text-violet-300" />
          <span>{analyzingHint}</span>
        </div>
      ) : stats.length > 0 || tags.length > 0 ? (
        <div className="mt-3 space-y-3">
          {stats.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {stats.map(({ key, label, value, Icon }) => (
                <div
                  key={key}
                  className="rounded-lg border border-violet-400/15 bg-violet-400/[0.04] px-2.5 py-2"
                >
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <Icon className="size-3 text-violet-300" />
                    {label}
                  </div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-foreground">
                    {value}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tags.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {tagsLabel}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full border border-violet-400/25 bg-violet-400/10 px-2 py-0.5 text-xs text-violet-200"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{emptyHint}</p>
      )}

      <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{ctaLine}</span>
        <IconArrowRight className="size-3.5 text-violet-300" />
      </div>
    </div>
  );
}
