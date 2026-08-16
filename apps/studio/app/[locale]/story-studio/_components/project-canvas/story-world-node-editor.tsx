"use client";

import { useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconInfoCircle,
  IconLoader2,
  IconPhoto,
  IconPlayerPlay,
  IconRefresh,
  IconTrash,
  IconWorld,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StoryWorldGraphNode } from "@/lib/story-projects-api";
import type { WorldModelWorld } from "@repo/shared/world-model-protocol";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { storyApiErrorMessage, type StoryCandidateAsset } from "@/lib/story-projects-api";
import {
  createWorld,
  getWorld,
  listWorldModelProviders,
  worldModelQueryKeys,
} from "@/lib/world-model-api";
import { cn } from "@/lib/utils";
import {
  buildStoryWorldCreateRequest,
  buildStoryWorldCreateIdempotencyKey,
  INITIAL_STORY_WORLD_CREATION_DRAFT,
  type StoryWorldCreationDraft,
} from "./story-world-creation";
import {
  StoryCandidateAssetPickerDialog,
  type StoryCandidateAssetUploadState,
} from "./story-candidate-asset-picker-dialog";

const WORLD_READY_POLL_INTERVAL_MS = 2_000;
const WORLD_READY_TIMEOUT_MS = 10 * 60_000;

export function StoryWorldNodeEditor({
  projectId,
  node,
  world,
  canEdit,
  canGenerate,
  candidateAssets,
  candidateAssetsLoading,
  candidateAssetsError,
  onRetryCandidateAssets,
  onUploadCandidateAsset,
  onUpdate,
  onRun,
}: {
  projectId: string;
  node: StoryWorldGraphNode;
  world: WorldModelWorld | null;
  canEdit: boolean;
  canGenerate: boolean;
  candidateAssets: StoryCandidateAsset[];
  candidateAssetsLoading: boolean;
  candidateAssetsError: string | null;
  onRetryCandidateAssets: () => void;
  onUploadCandidateAsset: (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => Promise<StoryCandidateAsset>;
  onUpdate: (
    nodeId: string,
    patch: Partial<
      Pick<StoryWorldGraphNode, "worldId" | "entryInstruction" | "maxExperienceSeconds">
    >
  ) => void;
  onRun: (worldId: string) => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => draftForWorld(world));
  const [definitionDirty, setDefinitionDirty] = useState(!world);

  const providersQuery = useQuery({
    queryKey: worldModelQueryKeys.providers(projectId),
    queryFn: () => listWorldModelProviders(projectId),
    staleTime: 60_000,
  });
  const availableProvider = providersQuery.data?.find((provider) => provider.available) ?? null;

  const cacheWorld = (nextWorld: WorldModelWorld) => {
    queryClient.setQueryData<WorldModelWorld[]>(
      worldModelQueryKeys.worlds(projectId),
      (current = []) => [nextWorld, ...current.filter((world) => world.id !== nextWorld.id)]
    );
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!availableProvider) throw new Error(t("worldNode.providerUnavailable"));
      const input = buildStoryWorldCreateRequest(availableProvider.providerKey, draft);
      const idempotencyKey = await buildStoryWorldCreateIdempotencyKey(
        projectId,
        node.nodeId,
        input
      );
      const created = await createWorld(projectId, input, idempotencyKey);
      cacheWorld(created);
      return waitForReadyWorld(projectId, created, {
        onProgress: cacheWorld,
        timeoutMessage: t("worldNode.buildTimeout"),
        failedMessage: t("worldNode.buildFailed"),
      });
    },
    onSuccess: (created) => {
      cacheWorld(created);
      onUpdate(node.nodeId, { worldId: created.id });
      setDraft(draftForWorld(created));
      setDefinitionDirty(false);
      onRun(created.id);
    },
    onError: (cause) => toast.error(storyApiErrorMessage(cause, t("worldNode.createError"))),
  });

  const instructionFieldId = `story-world-instruction-${node.nodeId}`;
  const providerError = providersQuery.isError
    ? storyApiErrorMessage(providersQuery.error, t("worldNode.providerLoadError"))
    : null;
  const requiresBuild = !world || definitionDirty;
  const runDisabled = requiresBuild
    ? !canEdit || !canGenerate || !availableProvider || !draft.prompt.trim()
    : world.status !== "ready";

  const run = () => {
    if (world && !definitionDirty) {
      onRun(world.id);
      return;
    }
    createMutation.mutate();
  };

  return (
    <div className="relative space-y-4">
      <WorldCreationForm
        draft={draft}
        onChange={(nextDraft) => {
          setDraft(nextDraft);
          setDefinitionDirty(true);
        }}
        providerAvailable={Boolean(availableProvider)}
        providerLoading={providersQuery.isPending}
        providerError={providerError}
        pending={createMutation.isPending}
        disabled={!canEdit}
        candidateAssets={candidateAssets}
        candidateAssetsLoading={candidateAssetsLoading}
        candidateAssetsError={candidateAssetsError}
        onRetryCandidateAssets={onRetryCandidateAssets}
        onUploadCandidateAsset={onUploadCandidateAsset}
        onRetryProvider={() => void providersQuery.refetch()}
      />

      <label className="block" htmlFor={instructionFieldId}>
        <FieldLabel
          label={t("worldNode.entryInstruction")}
          tooltip={t("worldNode.entryInstructionTooltip")}
        />
        <textarea
          id={instructionFieldId}
          value={node.entryInstruction ?? ""}
          disabled={!canEdit}
          maxLength={4_000}
          placeholder={t("worldNode.entryInstructionPlaceholder")}
          onChange={(event) => onUpdate(node.nodeId, { entryInstruction: event.target.value })}
          className="mt-2 min-h-24 w-full resize-y rounded-xl border border-transparent bg-white/[0.05] px-3 py-2.5 text-xs leading-5 text-white/84 outline-none transition placeholder:text-white/24 focus:border-white/18"
        />
      </label>

      <FormSelect
        label={t("worldNode.maxDuration")}
        tooltip={t("worldNode.maxDurationTooltip")}
        value={String(node.maxExperienceSeconds)}
        options={["60", "90", "120"]}
        labelFor={(value) => t("worldNode.duration", { seconds: Number(value) })}
        onChange={(value) =>
          onUpdate(node.nodeId, { maxExperienceSeconds: Number(value) as 60 | 90 | 120 })
        }
        disabled={!canEdit}
      />

      {requiresBuild && !canGenerate && !providersQuery.isPending && !providerError ? (
        <p className="text-xs leading-4 text-white/28">{t("worldNode.generationUnavailable")}</p>
      ) : null}

      <Button
        type="button"
        variant="primary-cta"
        className="h-11 w-full text-xs"
        loading={createMutation.isPending}
        disabled={runDisabled}
        onClick={run}
      >
        <IconPlayerPlay className="size-4" />
        {t("worldNode.run")}
      </Button>
    </div>
  );
}

async function waitForReadyWorld(
  projectId: string,
  initialWorld: WorldModelWorld,
  {
    onProgress,
    timeoutMessage,
    failedMessage,
  }: {
    onProgress: (world: WorldModelWorld) => void;
    timeoutMessage: string;
    failedMessage: string;
  }
): Promise<WorldModelWorld> {
  const deadline = Date.now() + WORLD_READY_TIMEOUT_MS;
  let world = initialWorld;

  while (world.status === "generating") {
    if (Date.now() >= deadline) throw new Error(timeoutMessage);
    await new Promise((resolve) => window.setTimeout(resolve, WORLD_READY_POLL_INTERVAL_MS));
    world = await getWorld(projectId, world.id);
    onProgress(world);
  }

  if (world.status === "failed") {
    throw new Error(world.error?.message?.trim() || failedMessage);
  }
  return world;
}

export function StoryWorldBindingControl({
  node,
  worlds,
  loading,
  error,
  canEdit,
  compact,
  onRetry,
  onUpdate,
}: {
  node: StoryWorldGraphNode;
  worlds: WorldModelWorld[];
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  compact: boolean;
  onRetry: () => void;
  onUpdate: (worldId: string) => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  const readyWorlds = worlds.filter((world) => world.status === "ready");
  const selected = node.worldId
    ? (worlds.find((candidate) => candidate.id === node.worldId) ?? null)
    : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={!canEdit || loading}
          className={cn(
            "nodrag nopan nowheel inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-white/[0.1] bg-black/65 px-3 text-xs font-semibold text-white/72 shadow-lg backdrop-blur-xl transition hover:border-white/20 hover:bg-black/75 hover:text-white disabled:pointer-events-none disabled:opacity-45",
            compact &&
              "opacity-0 group-hover/world:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          aria-label={selected ? t("worldNode.change") : t("worldNode.select")}
        >
          {loading ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : (
            <IconWorld className="size-3.5" />
          )}
          {selected ? t("worldNode.change") : t("worldNode.select")}
          <IconChevronDown className="size-3.5 text-white/42" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact ? "end" : "center"}
        className="min-w-60 rounded-xl bg-[oklch(0.22_0_0/0.98)] p-1.5 text-white/78 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {error ? (
          <DropdownMenuItem onSelect={onRetry} className="min-h-10 text-red-200/78">
            <IconRefresh className="size-4" />
            {t("worldNode.retry")}
          </DropdownMenuItem>
        ) : readyWorlds.length > 0 ? (
          readyWorlds.map((world) => (
            <DropdownMenuItem
              key={world.id}
              onSelect={() => onUpdate(world.id)}
              className="min-h-10"
            >
              <IconWorld className="size-4 text-white/40" />
              <span className="min-w-0 flex-1 truncate">{world.name?.trim() || world.prompt}</span>
              {world.id === node.worldId ? (
                <IconCheck className="size-4 text-emerald-300/75" />
              ) : null}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled className="min-h-10 text-white/38">
            {t("worldNode.noWorlds")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function draftForWorld(world: WorldModelWorld | null): StoryWorldCreationDraft {
  if (!world) return INITIAL_STORY_WORLD_CREATION_DRAFT;
  return {
    prompt: world.prompt,
    firstFrameUrl: world.firstFrameUrl ?? "",
    perspective: "third_person",
  };
}

function WorldCreationForm({
  draft,
  onChange,
  providerAvailable,
  providerLoading,
  providerError,
  pending,
  disabled,
  candidateAssets,
  candidateAssetsLoading,
  candidateAssetsError,
  onRetryCandidateAssets,
  onUploadCandidateAsset,
  onRetryProvider,
}: {
  draft: StoryWorldCreationDraft;
  onChange: (draft: StoryWorldCreationDraft) => void;
  providerAvailable: boolean;
  providerLoading: boolean;
  providerError: string | null;
  pending: boolean;
  disabled: boolean;
  candidateAssets: StoryCandidateAsset[];
  candidateAssetsLoading: boolean;
  candidateAssetsError: string | null;
  onRetryCandidateAssets: () => void;
  onUploadCandidateAsset: (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => Promise<StoryCandidateAsset>;
  onRetryProvider: () => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  const [candidatePickerOpen, setCandidatePickerOpen] = useState(false);
  const imageCandidates = useMemo(
    () => candidateAssets.filter((candidate) => candidate.asset.kind === "image"),
    [candidateAssets]
  );
  const selectedCandidate = useMemo(
    () =>
      imageCandidates.find(
        (candidate) =>
          Boolean(candidate.asset.previewUrl) &&
          candidate.asset.previewUrl === draft.firstFrameUrl.trim()
      ) ?? null,
    [draft.firstFrameUrl, imageCandidates]
  );
  const firstFrameUrl = draft.firstFrameUrl.trim();
  const firstFrameDisabled = disabled || pending;

  const selectFirstFrame = async (candidate: StoryCandidateAsset) => {
    const previewUrl = candidate.asset.previewUrl?.trim();
    if (!previewUrl || candidate.asset.kind !== "image") {
      throw new Error(t("worldNode.firstFrameUnavailable"));
    }
    onChange({ ...draft, firstFrameUrl: previewUrl });
  };

  const clearFirstFrame = async () => {
    onChange({ ...draft, firstFrameUrl: "" });
  };

  const uploadFirstFrame = async (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => {
    const candidate = await onUploadCandidateAsset(file, onState, signal);
    await selectFirstFrame(candidate);
  };

  return (
    <div className="space-y-3">
      {providerError ? (
        <InlineError
          message={providerError}
          action={t("worldNode.retry")}
          onAction={onRetryProvider}
        />
      ) : null}

      <label className="block">
        <FieldLabel
          label={t("worldNode.worldPrompt")}
          tooltip={t("worldNode.worldPromptTooltip")}
        />
        <Textarea
          value={draft.prompt}
          disabled={disabled || pending}
          maxLength={20_000}
          placeholder={t("worldNode.worldPromptPlaceholder")}
          onChange={(event) => onChange({ ...draft, prompt: event.target.value })}
          className="mt-1.5 min-h-28 rounded-xl bg-white/[0.055] px-3 py-2.5 text-xs leading-5"
        />
      </label>

      <div className="block">
        <FieldLabel label={t("worldNode.firstFrame")} tooltip={t("worldNode.firstFrameTooltip")} />
        <div className="mt-1.5 flex items-stretch gap-2">
          <button
            type="button"
            disabled={firstFrameDisabled}
            onClick={() => setCandidatePickerOpen(true)}
            className="group relative flex min-h-20 min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-xl bg-white/[0.055] p-2.5 text-left outline-none transition hover:bg-white/[0.085] focus-visible:ring-2 focus-visible:ring-white/25 disabled:pointer-events-none disabled:opacity-45"
          >
            {firstFrameUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={firstFrameUrl}
                alt={t("worldNode.firstFramePreviewAlt")}
                className="h-16 w-24 shrink-0 rounded-lg bg-black/30 object-cover"
              />
            ) : (
              <span className="grid h-16 w-24 shrink-0 place-items-center rounded-lg bg-black/24 text-white/28">
                <IconPhoto className="size-5" stroke={1.6} />
              </span>
            )}
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-white/74">
                {firstFrameUrl ? t("worldNode.replaceFirstFrame") : t("worldNode.chooseFirstFrame")}
              </span>
              <span className="mt-1 block text-xs leading-4 text-white/30">
                {t("worldNode.firstFrameHint")}
              </span>
            </span>
          </button>
          {firstFrameUrl ? (
            <button
              type="button"
              disabled={firstFrameDisabled}
              onClick={() => void clearFirstFrame()}
              aria-label={t("worldNode.clearFirstFrame")}
              title={t("worldNode.clearFirstFrame")}
              className="grid w-10 shrink-0 place-items-center rounded-xl bg-white/[0.055] text-white/34 outline-none transition hover:bg-red-500/10 hover:text-red-200/76 focus-visible:ring-2 focus-visible:ring-white/25 disabled:pointer-events-none disabled:opacity-45"
            >
              <IconTrash className="size-4" stroke={1.7} />
            </button>
          ) : null}
        </div>
        {candidateAssetsError ? (
          <span className="mt-1 block text-xs leading-4 text-red-200/72">
            {candidateAssetsError}
          </span>
        ) : null}
        <StoryCandidateAssetPickerDialog
          open={candidatePickerOpen}
          onOpenChange={setCandidatePickerOpen}
          items={imageCandidates}
          allowedKinds={["image"]}
          currentAssetId={selectedCandidate?.asset.id ?? null}
          loading={candidateAssetsLoading}
          error={candidateAssetsError}
          canSelect={!firstFrameDisabled}
          disabledReason={firstFrameDisabled ? t("worldNode.firstFrameDisabled") : null}
          onRetry={onRetryCandidateAssets}
          isSelectable={(candidate) => Boolean(candidate.asset.previewUrl)}
          unavailableReason={() => t("worldNode.firstFrameUnavailable")}
          onSelect={selectFirstFrame}
          onClearSelection={clearFirstFrame}
          uploadAccept="image/*"
          onUpload={uploadFirstFrame}
        />
      </div>

      <FormSelect
        label={t("worldNode.perspective")}
        tooltip={t("worldNode.perspectiveTooltip")}
        value={draft.perspective}
        options={["first_person", "third_person"]}
        labelFor={(value) => t(`worldNode.perspectiveValue.${value}`)}
        onChange={(perspective) =>
          onChange({
            ...draft,
            perspective: perspective as StoryWorldCreationDraft["perspective"],
          })
        }
        disabled={disabled || pending}
      />

      {!providerAvailable && !providerLoading && !providerError ? (
        <p className="text-xs leading-4 text-white/28">{t("worldNode.providerUnavailable")}</p>
      ) : null}
    </div>
  );
}

function FormSelect({
  label,
  tooltip,
  value,
  options,
  labelFor,
  onChange,
  disabled,
}: {
  label: string;
  tooltip: string;
  value: string;
  options: readonly string[];
  labelFor: (value: string) => string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="block">
      <FieldLabel label={label} tooltip={tooltip} />
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger className="mt-1.5 h-10 w-full rounded-xl bg-white/[0.055] px-3 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {labelFor(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function FieldLabel({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/42">
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={tooltip}
            className="inline-flex text-white/28 outline-none transition hover:text-white/56 focus-visible:text-white/72"
          >
            <IconInfoCircle className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={7} className="max-w-72 leading-5">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

function InlineError({
  message,
  action,
  onAction,
}: {
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl bg-red-500/10 p-3 text-xs leading-4 text-red-200/80">
      <div className="flex gap-2">
        <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <p>{message}</p>
      </div>
      <button
        type="button"
        className="mt-2 inline-flex items-center gap-1 font-semibold text-white/72"
        onClick={onAction}
      >
        <IconRefresh className="size-3" /> {action}
      </button>
    </div>
  );
}
