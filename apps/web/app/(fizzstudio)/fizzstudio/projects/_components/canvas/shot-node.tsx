"use client";

import {
  forwardRef,
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ForwardedRef,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  IconAdjustmentsHorizontal,
  IconArrowsMaximize,
  IconAspectRatio,
  IconBolt,
  IconCamera,
  IconChevronDown,
  IconDownload,
  IconExternalLink,
  IconLanguage,
  IconLoader2,
  IconMicrophone,
  IconPhoto,
  IconPhotoPlus,
  IconPlus,
  IconSend,
  IconShieldCheck,
  IconSparkles,
  IconStackPush,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { downloadMediaFile, inferDownloadFilename } from "@/src/lib/media-download";
import type { MediaItem, Shot } from "../../_data/storyboard-schema";
import {
  MIN_CANVAS_ZOOM,
  NODE_COMPOSER_GAP,
  NODE_COMPOSER_HEIGHT,
  NODE_COMPOSER_WIDTH,
  SHOT_NODE_WIDTH,
} from "./canvas-constants";

export type NodeComposerLayout = {
  offsetX: number;
  placement: "top" | "bottom";
};

export interface ShotNodeData {
  shot: Shot;
  index: number;
  columnIds: {
    image: string;
    video: string;
    description: string;
  };
  sourceHandleActive: boolean;
  targetHandleActive: boolean;
  inspectorSelected: boolean;
  relation: "selected" | "incoming" | "outgoing" | "neutral";
  composerVisible: boolean;
  composerLayout: NodeComposerLayout;
  composerState?: ShotComposerState;
  onComposerStateChange?: ShotComposerStateUpdater;
  onSubmitGeneration?: (shot: Shot, request: ShotGenerationRequest) => Promise<void>;
  onOpenPreview?: (mediaId: string) => void;
  viewportZoom: number;
  [key: string]: unknown;
}

type NodeMedia = {
  kind: "image" | "video";
  item: MediaItem;
};

type NodeTone = {
  accent: string;
  border: string;
  glow: string;
};

type ComposerMenu = "audio" | "format" | "model" | "output" | "settings" | null;
export type ComposerMode =
  | "all-reference"
  | "first-last"
  | "image-reference"
  | "image-to-video"
  | "text-to-video";
type ComposerTool = "camera" | "characters" | "marker" | null;
type PromptEditorHandle = HTMLDivElement;

const NEUTRAL_TONE: NodeTone = {
  accent: "#9ba1aa",
  border: "rgba(255,255,255,0.12)",
  glow: "rgba(0,0,0,0.76)",
};

const SELECTED_TONE: NodeTone = {
  accent: "#d7dbe2",
  border: "rgba(215,219,226,0.72)",
  glow: "rgba(215,219,226,0.2)",
};

const INCOMING_TONE: NodeTone = {
  accent: "#aab6c5",
  border: "rgba(170,182,197,0.46)",
  glow: "rgba(157,170,188,0.16)",
};

const OUTGOING_TONE: NodeTone = {
  accent: "#d8dde5",
  border: "rgba(216,221,229,0.44)",
  glow: "rgba(222,227,234,0.16)",
};

const MAX_PROMPT_LENGTH = 500;
const MODEL_OPTIONS = ["Seedance 2.0", "Seedance 2.0 Fast", "Seedance 2.0 Pro"] as const;
const ASPECT_RATIO_OPTIONS = ["16:9", "9:16", "1:1"] as const;
const RESOLUTION_OPTIONS = ["720P", "1080P"] as const;
const DURATION_OPTIONS = ["5s", "10s"] as const;

export type ShotComposerState = {
  activeTool: ComposerTool;
  aspectRatio: (typeof ASPECT_RATIO_OPTIONS)[number];
  autoValidate: boolean;
  duration: (typeof DURATION_OPTIONS)[number];
  expanded: boolean;
  mode: ComposerMode;
  model: (typeof MODEL_OPTIONS)[number];
  outputCount: number;
  promptDraft: string;
  resolution: (typeof RESOLUTION_OPTIONS)[number];
  translateEnabled: boolean;
  webSearch: boolean;
  withAudio: boolean;
};

export type ShotComposerStateUpdater = (shotId: string, state: ShotComposerState) => void;

export type ShotGenerationRequest = {
  aspectRatio: (typeof ASPECT_RATIO_OPTIONS)[number];
  autoValidate: boolean;
  durationSeconds: number;
  mode: ComposerMode;
  modelLabel: (typeof MODEL_OPTIONS)[number];
  outputCount: number;
  prompt: string;
  referenceUrl?: string;
  resolution: (typeof RESOLUTION_OPTIONS)[number];
  translateEnabled: boolean;
  webSearch: boolean;
  withAudio: boolean;
};

export function createDefaultShotComposerState(promptDraft: string): ShotComposerState {
  return {
    activeTool: null,
    aspectRatio: "16:9",
    autoValidate: true,
    duration: "5s",
    expanded: false,
    mode: "all-reference",
    model: "Seedance 2.0",
    outputCount: 1,
    promptDraft,
    resolution: "720P",
    translateEnabled: false,
    webSearch: false,
    withAudio: true,
  };
}

function preferredMedia(shot: Shot, columnId: string): MediaItem | undefined {
  const media = shot.cells[columnId]?.media ?? [];
  return media.find((item) => item.preferred) ?? media[0];
}

function resolveNodeMedia(shot: Shot, columnIds: ShotNodeData["columnIds"]): NodeMedia | null {
  const video = preferredMedia(shot, columnIds.video);
  if (video) return { kind: "video", item: video };

  const image = preferredMedia(shot, columnIds.image);
  if (image) return { kind: "image", item: image };

  return null;
}

function getCellText(shot: Shot, columnId: string): string {
  const cell = shot.cells[columnId] ?? {};
  return cell.richText ?? cell.text ?? "";
}

function hasMedia(shot: Shot, columnId: string): boolean {
  const media = shot.cells[columnId]?.media ?? [];
  return media.some((item) => Boolean(item.url));
}

function resolveNodeTone(relation: ShotNodeData["relation"]) {
  if (relation === "selected") return SELECTED_TONE;
  if (relation === "incoming") return INCOMING_TONE;
  if (relation === "outgoing") return OUTGOING_TONE;
  return NEUTRAL_TONE;
}

function placeCaretAtEnd(element: HTMLElement | null) {
  if (!element) return;

  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function readInlinePromptText(root: HTMLElement, textElement: HTMLElement | null) {
  let text = "";
  for (const node of root.childNodes) {
    if (node instanceof HTMLElement) {
      if (
        node.dataset.fizzReferenceChip === "true" ||
        node.dataset.fizzPromptPlaceholder === "true"
      ) {
        continue;
      }
    }
    text += node === textElement ? (textElement?.textContent ?? "") : (node.textContent ?? "");
  }

  return text.replace(/\u00a0/g, " ");
}

function normalizeInlinePromptDom(
  root: HTMLElement,
  textElement: HTMLElement | null,
  text: string
) {
  if (!textElement) return;

  textElement.textContent = text;
  for (const node of [...root.childNodes]) {
    if (node === textElement) continue;
    if (node instanceof HTMLElement) {
      if (
        node.dataset.fizzReferenceChip === "true" ||
        node.dataset.fizzPromptPlaceholder === "true"
      ) {
        continue;
      }
    }
    root.removeChild(node);
  }
}

function assignForwardedRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) ref.current = value;
}

function NodeComposer({
  columnIds,
  index,
  layout,
  media,
  onComposerStateChange,
  onSubmitGeneration,
  shot,
  state: restoredState,
  zoom,
}: {
  columnIds: ShotNodeData["columnIds"];
  index: number;
  layout: NodeComposerLayout;
  media: NodeMedia | null;
  onComposerStateChange?: ShotComposerStateUpdater;
  onSubmitGeneration?: ShotNodeData["onSubmitGeneration"];
  shot: Shot;
  state?: ShotComposerState;
  zoom: number;
}) {
  const t = useTranslations("fizzStudio");
  const [activeMenu, setActiveMenu] = useState<ComposerMenu>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const promptEditorRef = useRef<PromptEditorHandle | null>(null);
  const safeZoom = Math.max(zoom || 1, MIN_CANVAS_ZOOM);
  const inverseScale = 1 / safeZoom;
  const placement = layout.placement;
  const referenceUrl = media?.item.url;
  const sourcePrompt = getCellText(shot, columnIds.description).trim();
  const initialComposerState = restoredState ?? createDefaultShotComposerState(sourcePrompt);
  const [mode, setMode] = useState<ComposerMode>(initialComposerState.mode);
  const [activeTool, setActiveTool] = useState<ComposerTool>(initialComposerState.activeTool);
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIO_OPTIONS)[number]>(
    initialComposerState.aspectRatio
  );
  const [autoValidate, setAutoValidate] = useState(initialComposerState.autoValidate);
  const [duration, setDuration] = useState<(typeof DURATION_OPTIONS)[number]>(
    initialComposerState.duration
  );
  const [expanded, setExpanded] = useState(initialComposerState.expanded);
  const [model, setModel] = useState<(typeof MODEL_OPTIONS)[number]>(initialComposerState.model);
  const [outputCount, setOutputCount] = useState(initialComposerState.outputCount);
  const [resolution, setResolution] = useState<(typeof RESOLUTION_OPTIONS)[number]>(
    initialComposerState.resolution
  );
  const [translateEnabled, setTranslateEnabled] = useState(initialComposerState.translateEnabled);
  const [webSearch, setWebSearch] = useState(initialComposerState.webSearch);
  const [withAudio, setWithAudio] = useState(initialComposerState.withAudio);
  const [promptDraft, setPromptDraft] = useState(initialComposerState.promptDraft);
  const [promptFocused, setPromptFocused] = useState(false);
  const referenceLabel = (
    hasMedia(shot, columnIds.image) ? t("sbComposerImageRef") : t("sbComposerVideoRef")
  ).replace("{index}", String(Math.max(index + 1, 1)));
  const outputLabel = (
    outputCount === 1 ? t("sbComposerOutputCountOne") : t("sbComposerOutputCountMany")
  ).replace("{count}", String(outputCount));
  const durationLabel = duration === "5s" ? t("sbComposerDuration5") : t("sbComposerDuration10");
  const formatLabel = `${aspectRatio} · ${resolution} · ${durationLabel}`;
  const audioLabel = withAudio ? t("sbComposerAudio") : t("sbComposerAudioOff");
  const promptValue = promptDraft.trim();
  const promptLength = promptDraft.trimEnd().length;
  const canSubmit = promptValue.length > 0 && !submitting;
  const stopCanvasEvent = (event: SyntheticEvent) => event.stopPropagation();
  const toggleMenu = (menu: Exclude<ComposerMenu, null>) =>
    setActiveMenu((current) => (current === menu ? null : menu));
  const submitPrompt = async () => {
    if (!canSubmit) return;
    setActiveMenu(null);
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onSubmitGeneration?.(shot, {
        aspectRatio,
        autoValidate,
        durationSeconds: duration === "10s" ? 10 : 5,
        mode,
        modelLabel: model,
        outputCount,
        prompt: promptValue,
        referenceUrl,
        resolution,
        translateEnabled,
        webSearch,
        withAudio,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("sbGenerationSubmitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const appendPromptToken = (text: string) => {
    setPromptDraft((current) => {
      const normalized = current.trimEnd();
      if (normalized.includes(text)) return normalized;
      return normalized ? `${normalized} ${text}` : text;
    });
    window.requestAnimationFrame(() => {
      const root = promptEditorRef.current;
      const textElement =
        root?.querySelector<HTMLElement>("[data-fizz-prompt-text='true']") ?? null;
      root?.focus();
      placeCaretAtEnd(textElement);
    });
  };

  const toolPanel =
    activeTool === "marker"
      ? {
          title: t("sbComposerMarkerPanel"),
          options: [
            t("sbComposerMarkerSubject"),
            t("sbComposerMarkerAction"),
            t("sbComposerMarkerMood"),
            t("sbComposerMarkerDetail"),
          ],
        }
      : activeTool === "camera"
        ? {
            title: t("sbComposerCameraPanel"),
            options: [t("sbMoveTracking"), t("sbMoveDolly"), t("sbMoveZoom"), t("sbMovePan")],
          }
        : activeTool === "characters"
          ? {
              title: t("sbComposerCharactersPanel"),
              options: [
                t("sbComposerCharacterHero"),
                t("sbComposerCharacterSide"),
                t("sbComposerCharacterCrowd"),
              ],
            }
          : null;

  const modes: { disabled?: boolean; id: ComposerMode; label: string }[] = [
    { id: "text-to-video", label: t("sbComposerTextToVideo"), disabled: true },
    { id: "all-reference", label: t("sbComposerAllReference") },
    { id: "image-to-video", label: t("sbComposerImageToVideo") },
    { id: "first-last", label: t("sbComposerFirstLastFrame") },
    { id: "image-reference", label: t("sbComposerImageReference") },
  ];

  const renderMenuContent = (menu: Exclude<ComposerMenu, null>) => {
    if (menu === "model") {
      return (
        <ComposerMenuGroup label={t("sbComposerModel")}>
          {MODEL_OPTIONS.map((option) => (
            <ComposerMenuItem
              key={option}
              active={model === option}
              label={option}
              onClick={() => {
                setModel(option);
                setActiveMenu(null);
              }}
            />
          ))}
        </ComposerMenuGroup>
      );
    }

    if (menu === "format") {
      return (
        <>
          <ComposerMenuGroup label={t("sbComposerAspectRatio")}>
            <div className="flex flex-wrap gap-1">
              {ASPECT_RATIO_OPTIONS.map((option) => (
                <ComposerPillOption
                  key={option}
                  active={aspectRatio === option}
                  label={option}
                  onClick={() => setAspectRatio(option)}
                />
              ))}
            </div>
          </ComposerMenuGroup>
          <ComposerMenuGroup label={t("sbComposerResolution")}>
            <div className="flex flex-wrap gap-1">
              {RESOLUTION_OPTIONS.map((option) => (
                <ComposerPillOption
                  key={option}
                  active={resolution === option}
                  label={option}
                  onClick={() => setResolution(option)}
                />
              ))}
            </div>
          </ComposerMenuGroup>
          <ComposerMenuGroup label={t("sbComposerDuration")}>
            <div className="flex flex-wrap gap-1">
              {DURATION_OPTIONS.map((option) => (
                <ComposerPillOption
                  key={option}
                  active={duration === option}
                  label={option === "5s" ? t("sbComposerDuration5") : t("sbComposerDuration10")}
                  onClick={() => setDuration(option)}
                />
              ))}
            </div>
          </ComposerMenuGroup>
        </>
      );
    }

    if (menu === "audio") {
      return (
        <ComposerMenuGroup label={t("sbComposerAudio")}>
          <ComposerMenuItem
            active={withAudio}
            label={t("sbComposerAudioOn")}
            onClick={() => {
              setWithAudio(true);
              setActiveMenu(null);
            }}
          />
          <ComposerMenuItem
            active={!withAudio}
            label={t("sbComposerAudioOff")}
            onClick={() => {
              setWithAudio(false);
              setActiveMenu(null);
            }}
          />
        </ComposerMenuGroup>
      );
    }

    if (menu === "settings") {
      return (
        <div className="space-y-1">
          <ComposerSwitch
            checked={webSearch}
            label={t("sbComposerWebSearch")}
            onChange={() => setWebSearch((current) => !current)}
          />
          <ComposerSwitch
            checked={autoValidate}
            label={t("sbComposerAutoValidate")}
            onChange={() => setAutoValidate((current) => !current)}
          />
        </div>
      );
    }

    return (
      <ComposerMenuGroup label={t("sbComposerOutput")}>
        <div className="grid grid-cols-4 gap-1">
          {[1, 2, 3, 4].map((count) => (
            <ComposerPillOption
              key={count}
              active={outputCount === count}
              label={
                count === 1
                  ? t("sbComposerOutputCountOne").replace("{count}", String(count))
                  : t("sbComposerOutputCountMany").replace("{count}", String(count))
              }
              onClick={() => {
                setOutputCount(count);
                setActiveMenu(null);
              }}
            />
          ))}
        </div>
      </ComposerMenuGroup>
    );
  };

  useEffect(() => {
    onComposerStateChange?.(shot.id, {
      activeTool,
      aspectRatio,
      autoValidate,
      duration,
      expanded,
      mode,
      model,
      outputCount,
      promptDraft,
      resolution,
      translateEnabled,
      webSearch,
      withAudio,
    });
  }, [
    activeTool,
    aspectRatio,
    autoValidate,
    duration,
    expanded,
    mode,
    model,
    onComposerStateChange,
    outputCount,
    promptDraft,
    resolution,
    shot.id,
    translateEnabled,
    webSearch,
    withAudio,
  ]);

  return (
    <div
      data-fizz-canvas-composer="true"
      className={cn(
        "node-floating-ui nodrag nowheel nopan absolute left-1/2 z-30 transition-[margin,opacity] duration-150 ease-out",
        placement === "bottom" ? "top-full" : "bottom-full"
      )}
      onClick={stopCanvasEvent}
      onDoubleClick={stopCanvasEvent}
      onKeyDown={stopCanvasEvent}
      onMouseDown={stopCanvasEvent}
      onPointerDown={stopCanvasEvent}
      onPointerMove={stopCanvasEvent}
      onPointerUp={stopCanvasEvent}
      onWheel={stopCanvasEvent}
      style={{
        marginBottom: placement === "top" ? NODE_COMPOSER_GAP / safeZoom : undefined,
        marginLeft: -NODE_COMPOSER_WIDTH / 2 + layout.offsetX / safeZoom,
        marginTop: placement === "bottom" ? NODE_COMPOSER_GAP / safeZoom : undefined,
        width: NODE_COMPOSER_WIDTH,
        transform: `scale(${inverseScale})`,
        transformOrigin: placement === "bottom" ? "top center" : "bottom center",
      }}
    >
      <div
        className="relative isolate flex w-full flex-col overflow-hidden rounded-xl border border-white/[0.12] p-2 text-white"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.115), rgba(38,38,40,0.76) 30%, rgba(31,31,33,0.82) 100%)",
          boxShadow:
            "0 24px 70px -42px rgba(0,0,0,0.98), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(255,255,255,0.05)",
          WebkitBackdropFilter: "blur(24px) saturate(140%)",
          backdropFilter: "blur(24px) saturate(140%)",
          minHeight: NODE_COMPOSER_HEIGHT,
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
          style={{
            background:
              "radial-gradient(120% 90% at 8% 0%, rgba(255,255,255,0.13), rgba(255,255,255,0.035) 38%, transparent 64%), linear-gradient(90deg, rgba(255,255,255,0.04), transparent 45%, rgba(255,255,255,0.025))",
          }}
        />
        <button
          type="button"
          onClick={() => {
            setActiveMenu(null);
            setExpanded((current) => !current);
          }}
          className={cn(
            "absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-lg text-white/48 transition-colors hover:bg-white/[0.08] hover:text-white/78",
            expanded ? "bg-white/[0.1] text-white/82" : "bg-[#262628]/70"
          )}
          aria-pressed={expanded}
          aria-label={expanded ? t("sbComposerCollapse") : t("sbComposerExpand")}
          title={expanded ? t("sbComposerCollapse") : t("sbComposerExpand")}
        >
          <IconExternalLink className="size-3.5" />
        </button>

        <div className="flex h-[30px] items-start gap-2 overflow-x-auto pr-9">
          {modes.map((item) => (
            <ComposerModeButton
              key={item.id}
              active={mode === item.id}
              disabled={item.disabled}
              label={item.label}
              onClick={() => {
                setActiveMenu(null);
                setMode(item.id);
              }}
            />
          ))}
        </div>

        <div
          className={cn(
            "mt-2 flex h-12 items-center gap-2 px-1 transition-[height,opacity,margin] duration-150",
            expanded && "pointer-events-none mt-0 h-0 opacity-0"
          )}
          aria-hidden={expanded}
        >
          <ComposerToolButton
            active={activeTool === "marker"}
            icon={<IconPhotoPlus className="size-4" />}
            label={t("sbComposerMarker")}
            onClick={() => {
              setActiveMenu(null);
              setActiveTool((current) => (current === "marker" ? null : "marker"));
            }}
          />
          <ComposerToolButton
            active={activeTool === "camera"}
            icon={<IconCamera className="size-4" />}
            label={t("sbComposerCamera")}
            onClick={() => {
              setActiveMenu(null);
              setActiveTool((current) => (current === "camera" ? null : "camera"));
            }}
          />
          <ComposerToolButton
            active={activeTool === "characters"}
            icon={<IconShieldCheck className="size-4" />}
            label={t("sbComposerCharacters")}
            onClick={() => {
              setActiveMenu(null);
              setActiveTool((current) => (current === "characters" ? null : "characters"));
            }}
          />
          <div className="relative size-12 overflow-hidden rounded-lg bg-[#1e1e22]/78 ring-1 ring-inset ring-white/[0.12]">
            {referenceUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={referenceUrl} alt="" className="size-full object-cover" draggable={false} />
            ) : (
              <div className="flex size-full items-center justify-center">
                <IconPhoto className="size-4 text-white/28" />
              </div>
            )}
            <span className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[8px] leading-[10px] text-white/86">
              1
            </span>
          </div>
        </div>

        {toolPanel && !expanded ? (
          <ComposerInlinePanel title={toolPanel.title}>
            {toolPanel.options.map((option) => (
              <ComposerInlineOption
                key={option}
                label={option}
                onClick={() => appendPromptToken(option)}
              />
            ))}
          </ComposerInlinePanel>
        ) : null}

        <div
          className={cn(
            "relative mt-2 flex flex-1 gap-1 overflow-hidden rounded-xl border p-1 transition-[min-height,max-height,border-color,background-color]",
            expanded
              ? "min-h-[132px] max-h-[172px]"
              : toolPanel
                ? "min-h-12 max-h-20"
                : "min-h-20 max-h-28",
            promptFocused ? "border-white/[0.16] bg-white/[0.035]" : "border-transparent"
          )}
        >
          <ComposerPromptEditor
            ref={promptEditorRef}
            ariaLabel={t("sbComposerPromptInput")}
            canSubmit={canSubmit}
            expanded={expanded}
            placeholder={t("sbComposerPromptPlaceholder")}
            referenceLabel={referenceLabel}
            referenceUrl={referenceUrl}
            toolPanelOpen={Boolean(toolPanel)}
            value={promptDraft}
            onCloseMenu={() => setActiveMenu(null)}
            onPromptFocusedChange={setPromptFocused}
            onSubmit={submitPrompt}
            onValueChange={setPromptDraft}
          />
          <span
            className={cn(
              "pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums",
              promptLength > MAX_PROMPT_LENGTH - 60 ? "text-white/48" : "text-white/24"
            )}
          >
            {promptLength}/{MAX_PROMPT_LENGTH}
          </span>
          {submitError ? (
            <span className="pointer-events-none absolute bottom-1.5 left-2 max-w-[360px] truncate text-[10px] font-normal text-white/44">
              {submitError}
            </span>
          ) : null}
        </div>

        <div className="mt-auto flex h-8 w-full items-start gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <ComposerMenuAnchor
              panel={activeMenu === "model" ? renderMenuContent("model") : null}
              widthClassName="w-[212px]"
            >
              <ComposerMetaButton
                active={activeMenu === "model"}
                icon={<IconSparkles className="size-3.5" />}
                label={model}
                onClick={() => toggleMenu("model")}
              />
            </ComposerMenuAnchor>
            <ComposerMenuAnchor
              className="min-w-0"
              panel={activeMenu === "format" ? renderMenuContent("format") : null}
              widthClassName="w-[236px]"
            >
              <ComposerMetaButton
                active={activeMenu === "format"}
                icon={<IconAspectRatio className="size-3.5" />}
                label={formatLabel}
                onClick={() => toggleMenu("format")}
              />
            </ComposerMenuAnchor>
            <ComposerMenuAnchor
              align="center"
              panel={activeMenu === "audio" ? renderMenuContent("audio") : null}
              widthClassName="w-[176px]"
            >
              <ComposerMetaButton
                active={activeMenu === "audio"}
                icon={<IconMicrophone className="size-3.5" />}
                label={audioLabel}
                onClick={() => toggleMenu("audio")}
              />
            </ComposerMenuAnchor>
          </div>
          <div className="flex shrink-0 items-start gap-1">
            <ComposerIconButton
              active={translateEnabled}
              label={t("sbComposerTranslate")}
              onClick={() => {
                setActiveMenu(null);
                setTranslateEnabled((current) => !current);
              }}
            >
              <IconLanguage className="size-4" />
            </ComposerIconButton>
            <ComposerMenuAnchor
              align="right"
              panel={activeMenu === "settings" ? renderMenuContent("settings") : null}
              widthClassName="w-[210px]"
            >
              <ComposerIconButton
                active={activeMenu === "settings"}
                label={t("sbComposerSettings")}
                onClick={() => toggleMenu("settings")}
              >
                <IconAdjustmentsHorizontal className="size-4" />
              </ComposerIconButton>
            </ComposerMenuAnchor>
            <ComposerMenuAnchor
              align="right"
              panel={activeMenu === "output" ? renderMenuContent("output") : null}
              widthClassName="w-[188px]"
            >
              <ComposerMetaButton
                active={activeMenu === "output"}
                icon={<IconStackPush className="size-3.5" />}
                label={outputLabel}
                onClick={() => toggleMenu("output")}
              />
            </ComposerMenuAnchor>
            <span className="flex h-8 items-center gap-1.5 text-white/34">
              <IconBolt className="size-3.5" />
              <span className="min-w-5 text-center text-[12px] font-normal leading-[15px] tabular-nums">
                135
              </span>
            </span>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submitPrompt}
              className="flex size-7 items-center justify-center rounded-lg bg-white text-black transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
              aria-busy={submitting}
              aria-label={t("sbComposerSubmit")}
              title={t("sbComposerSubmit")}
            >
              {submitting ? (
                <IconLoader2 className="size-3.5 animate-spin" />
              ) : (
                <IconSend className="size-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposerModeButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 min-w-10 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border px-2 py-1 text-[13px] font-normal leading-normal transition-colors",
        active
          ? "border-white/[0.16] bg-white/[0.1] text-white"
          : "border-white/[0.11] bg-transparent text-white/52 hover:bg-white/[0.07] hover:text-white/82",
        disabled && "cursor-not-allowed text-white/28 hover:bg-transparent hover:text-white/28"
      )}
    >
      {label}
    </button>
  );
}

const ComposerPromptEditor = forwardRef<
  PromptEditorHandle,
  {
    ariaLabel: string;
    canSubmit: boolean;
    expanded: boolean;
    placeholder: string;
    referenceLabel: string;
    referenceUrl?: string;
    toolPanelOpen: boolean;
    value: string;
    onCloseMenu: () => void;
    onPromptFocusedChange: (focused: boolean) => void;
    onSubmit: () => void;
    onValueChange: (value: string) => void;
  }
>(function ComposerPromptEditor(
  {
    ariaLabel,
    canSubmit,
    expanded,
    placeholder,
    referenceLabel,
    referenceUrl,
    toolPanelOpen,
    value,
    onCloseMenu,
    onPromptFocusedChange,
    onSubmit,
    onValueChange,
  },
  forwardedRef
) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const textElement = textRef.current;
    if (!textElement) return;
    if ((textElement.textContent ?? "") !== value) textElement.textContent = value;
  }, [value]);

  const setRootRef = (element: HTMLDivElement | null) => {
    rootRef.current = element;
    assignForwardedRef(forwardedRef, element);
  };

  const focusPromptEnd = () => {
    rootRef.current?.focus();
    placeCaretAtEnd(textRef.current);
  };

  const syncValueFromDom = () => {
    const root = rootRef.current;
    const textElement = textRef.current;
    if (!root || !textElement) return;

    const rawText = readInlinePromptText(root, textElement);
    const nextText = rawText.slice(0, MAX_PROMPT_LENGTH);
    const needsNormalize =
      rawText !== nextText ||
      [...root.childNodes].some((node) => {
        if (node === textElement) return false;
        if (node instanceof HTMLElement) {
          return (
            node.dataset.fizzReferenceChip !== "true" &&
            node.dataset.fizzPromptPlaceholder !== "true"
          );
        }
        return (node.textContent ?? "").length > 0;
      });

    if (needsNormalize) {
      normalizeInlinePromptDom(root, textElement, nextText);
      placeCaretAtEnd(textElement);
    }

    onValueChange(nextText);
  };

  return (
    <div
      ref={setRootRef}
      data-fizz-prompt-input="true"
      data-fizz-prompt-shell="true"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      onBlur={() => onPromptFocusedChange(false)}
      onClick={(event) => {
        onCloseMenu();
        const target = event.target as HTMLElement;
        if (!target.closest("[data-fizz-prompt-text='true']")) focusPromptEnd();
      }}
      onFocus={() => {
        onCloseMenu();
        onPromptFocusedChange(true);
      }}
      onInput={syncValueFromDom}
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
          event.preventDefault();
          onSubmit();
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          onCloseMenu();
          event.currentTarget.blur();
        }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const root = rootRef.current;
        const textElement = textRef.current;
        if (!root || !textElement) return;

        const currentText = readInlinePromptText(root, textElement);
        const pasteText = event.clipboardData.getData("text/plain");
        const allowedText = pasteText.slice(0, Math.max(0, MAX_PROMPT_LENGTH - currentText.length));
        document.execCommand("insertText", false, allowedText);
      }}
      className={cn(
        "tiny-scrollbar nodrag nowheel min-h-0 w-full cursor-text overflow-y-auto whitespace-pre-wrap break-words bg-transparent pb-5 pl-1 pr-2 pt-1 text-[15px] font-normal leading-8 text-white/88 outline-none",
        expanded
          ? "min-h-[132px] max-h-[164px]"
          : toolPanelOpen
            ? "min-h-12 max-h-[72px]"
            : "min-h-20 max-h-[104px]"
      )}
      aria-label={ariaLabel}
    >
      <span
        data-fizz-reference-chip="true"
        contentEditable={false}
        className="mention-badge mr-1 inline-flex h-7 max-w-[156px] select-none items-center gap-1 whitespace-nowrap rounded-lg border border-white/[0.11] bg-white/[0.07] px-1.5 align-[-0.18em] text-[15px] leading-none text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
      >
        {referenceUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={referenceUrl}
            alt=""
            className="size-5 rounded-md object-cover"
            draggable={false}
          />
        ) : (
          <span className="flex size-5 items-center justify-center rounded-md bg-black/20 text-white/45">
            <IconPhoto className="size-4" />
          </span>
        )}
        <span className="min-w-0 truncate">{referenceLabel}</span>
        <IconShieldCheck className="size-3.5 shrink-0 text-cyan-300" />
      </span>
      <span ref={textRef} data-fizz-prompt-text="true" className="outline-none" />
      {value ? null : (
        <span
          data-fizz-prompt-placeholder="true"
          contentEditable={false}
          className="pointer-events-none select-none text-white/28"
        >
          {placeholder}
        </span>
      )}
    </div>
  );
});

function ComposerToolButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex size-12 flex-col items-center justify-center gap-0.5 rounded-lg border p-1 text-center text-[10px] font-normal leading-3 transition-colors",
        active
          ? "border-white/[0.18] bg-white/[0.1] text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
          : "border-white/[0.1] bg-transparent text-white/48 hover:bg-white/[0.06] hover:text-white/74"
      )}
      aria-pressed={active}
    >
      <span className={active ? "text-white/82" : "text-white/42"}>{icon}</span>
      {label}
    </button>
  );
}

function ComposerInlinePanel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="mt-2 flex h-8 items-center gap-1 overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.035] px-1.5">
      <span className="shrink-0 px-1 text-[10px] font-normal leading-none text-white/38">
        {title}
      </span>
      <div className="tiny-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {children}
      </div>
    </div>
  );
}

function ComposerInlineOption({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-6 shrink-0 items-center rounded-md border border-white/[0.08] bg-black/10 px-2 text-[11px] font-normal leading-none text-white/58 transition-colors hover:border-white/[0.15] hover:bg-white/[0.07] hover:text-white/86"
    >
      {label}
    </button>
  );
}

function ComposerMetaButton({
  active,
  highlight,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  highlight?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-normal leading-[20px] text-white/82 transition-colors hover:bg-white/[0.06]",
        active && "bg-white/[0.1] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
      )}
      aria-pressed={active}
    >
      <span className={highlight ? "text-white" : "text-white/62"}>{icon}</span>
      <span className="truncate">{label}</span>
      <IconChevronDown
        className={cn(
          "size-3 text-white/34 transition-transform",
          active && "rotate-180 text-white/62"
        )}
      />
    </button>
  );
}

function ComposerIconButton({
  active,
  children,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-white/[0.07] hover:text-white",
        active ? "bg-white/[0.1] text-white" : "text-white/68"
      )}
      aria-pressed={active}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function ComposerSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex h-9 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-xs text-white/74 transition-colors hover:bg-white/[0.06]"
      aria-pressed={checked}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "relative h-[18px] w-8 shrink-0 rounded-full border transition-colors",
          checked ? "border-white/[0.22] bg-white/[0.22]" : "border-white/[0.14] bg-black/20"
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-white transition-transform",
            checked ? "translate-x-[13px]" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}

function ComposerMenuAnchor({
  align,
  children,
  className,
  panel,
  widthClassName,
}: {
  align?: "center" | "left" | "right";
  children: ReactNode;
  className?: string;
  panel: ReactNode;
  widthClassName: string;
}) {
  return (
    <div className={cn("relative min-w-0 shrink-0", className)}>
      {children}
      {panel ? (
        <ComposerOptionPanel align={align ?? "left"} widthClassName={widthClassName}>
          {panel}
        </ComposerOptionPanel>
      ) : null}
    </div>
  );
}

function ComposerOptionPanel({
  align,
  children,
  widthClassName,
}: {
  align: "center" | "left" | "right";
  children: ReactNode;
  widthClassName: string;
}) {
  return (
    <div
      data-fizz-composer-menu-panel="true"
      className={cn(
        "absolute bottom-[calc(100%+8px)] z-30 rounded-xl border border-white/[0.12] bg-[#27272a]/82 p-2 text-white shadow-[0_18px_54px_-28px_rgba(0,0,0,0.98),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl",
        widthClassName,
        align === "left" && "left-0",
        align === "center" && "left-1/2 -translate-x-1/2",
        align === "right" && "right-0"
      )}
      style={{
        WebkitBackdropFilter: "blur(22px) saturate(145%)",
        backdropFilter: "blur(22px) saturate(145%)",
      }}
    >
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ComposerMenuGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[10px] font-normal leading-4 text-white/38">{label}</div>
      {children}
    </div>
  );
}

function ComposerMenuItem({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-xs font-normal text-white/74 transition-colors hover:bg-white/[0.06] hover:text-white",
        active && "bg-white/[0.1] text-white"
      )}
      aria-pressed={active}
    >
      <span className="truncate">{label}</span>
      <span
        className={cn(
          "size-1.5 rounded-full transition-colors",
          active ? "bg-white/80" : "bg-transparent"
        )}
      />
    </button>
  );
}

function ComposerPillOption({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 min-w-12 items-center justify-center rounded-lg border px-2 text-[11px] font-normal leading-none transition-colors",
        active
          ? "border-white/[0.18] bg-white/[0.12] text-white"
          : "border-white/[0.1] bg-black/10 text-white/58 hover:bg-white/[0.06] hover:text-white/82"
      )}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function ShotNodeImpl({ data, selected }: NodeProps) {
  const d = data as ShotNodeData;
  const t = useTranslations("fizzStudio");
  const {
    shot,
    columnIds,
    composerVisible,
    inspectorSelected,
    relation,
    sourceHandleActive,
    targetHandleActive,
  } = d;
  const active = selected || inspectorSelected;
  const media = resolveNodeMedia(shot, columnIds);
  const visualRelation = active ? "selected" : relation;
  const relationActive = visualRelation !== "neutral";
  const tone = resolveNodeTone(visualRelation);
  const sourceHandleHighlighted = active || sourceHandleActive;
  const targetHandleHighlighted = active || targetHandleActive;
  const mediaStatus = media?.item.status;
  const mediaError = media?.item.error;
  const generating = mediaStatus === "pending" || mediaStatus === "generating";
  const failed = mediaStatus === "failed" || mediaStatus === "cancelled";
  const statusLabel =
    mediaStatus === "pending"
      ? t("sbGenerationQueued")
      : mediaStatus === "generating"
        ? t("sbGenerationRunning")
        : failed
          ? mediaError || t("sbGenerationFailed")
          : t("sbNoFrame");

  const mediaUrl = media?.item.url;

  return (
    <div
      className={cn(
        "group relative aspect-video overflow-visible rounded-md border bg-[#222226] transition-[border-color,box-shadow]",
        relationActive
          ? "shadow-[0_18px_48px_-26px_var(--node-glow)]"
          : "shadow-[0_16px_42px_-30px_rgba(0,0,0,0.95)]"
      )}
      style={
        {
          "--node-glow": tone.glow,
          borderColor: tone.border,
          width: SHOT_NODE_WIDTH,
        } as CSSProperties
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          "!flex !items-center !justify-center !border-2 !border-[#09090b] !opacity-95 transition-[background-color,box-shadow,width,height]",
          targetHandleHighlighted ? "!size-4" : "!size-3 group-hover:!bg-white"
        )}
        style={{
          backgroundColor: targetHandleHighlighted ? tone.accent : "rgba(155,161,170,0.88)",
          boxShadow: targetHandleHighlighted
            ? `0 0 0 4px ${tone.glow}`
            : "0 0 0 3px rgba(255,255,255,0.03)",
        }}
      >
        <IconPlus
          className={cn(
            "size-2.5 text-[#09090b] transition-opacity",
            active ? "opacity-85" : "opacity-0"
          )}
        />
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          "!flex !items-center !justify-center !border-2 !border-[#09090b] !opacity-95 transition-[background-color,box-shadow,width,height]",
          sourceHandleHighlighted ? "!size-4" : "!size-3 group-hover:!bg-white"
        )}
        style={{
          backgroundColor: sourceHandleHighlighted ? tone.accent : "rgba(155,161,170,0.88)",
          boxShadow: sourceHandleHighlighted
            ? `0 0 0 4px ${tone.glow}`
            : "0 0 0 3px rgba(255,255,255,0.03)",
        }}
      >
        <IconPlus
          className={cn(
            "size-2.5 text-[#09090b] transition-opacity",
            active ? "opacity-85" : "opacity-0"
          )}
        />
      </Handle>

      {mediaUrl ? (
        <div className="nodrag nopan absolute right-2 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => d.onOpenPreview?.(media.item.id)}
            aria-label={t("sbNodePreview")}
            title={t("sbNodePreview")}
            className="grid size-7 place-items-center rounded-lg bg-black/52 text-white backdrop-blur-md transition-colors hover:bg-black/72"
          >
            <IconArrowsMaximize className="size-3.5" stroke={1.8} />
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const saved = await downloadMediaFile(mediaUrl, {
                  filename: inferDownloadFilename(
                    mediaUrl,
                    media.item.mimeType,
                    `shot-${d.index + 1}`
                  ),
                });
                if (!saved) toast.error(t("sbDownloadFailed"));
              })();
            }}
            aria-label={t("sbNodeDownload")}
            title={t("sbNodeDownload")}
            className="grid size-7 place-items-center rounded-lg bg-black/52 text-white backdrop-blur-md transition-colors hover:bg-black/72"
          >
            <IconDownload className="size-3.5" stroke={1.8} />
          </button>
        </div>
      ) : null}

      {media?.kind === "image" && media.item.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.item.url}
          alt=""
          className="size-full rounded-[5px] object-cover"
          draggable={false}
        />
      ) : media?.kind === "video" && media.item.url ? (
        <video
          src={media.item.url}
          className="size-full rounded-[5px] object-cover"
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center rounded-[5px] bg-[#242426] text-white/24">
          {generating ? (
            <IconLoader2 className="size-6 animate-spin text-white/42" />
          ) : (
            <IconPhoto className={cn("size-6", failed ? "text-white/34" : "text-white/22")} />
          )}
          <span
            className={cn(
              "mt-2 max-w-[80%] truncate text-[12px] font-normal leading-4",
              failed ? "text-white/45" : generating ? "text-white/46" : "text-white/28"
            )}
          >
            {statusLabel}
          </span>
        </div>
      )}

      {generating && media?.item.url ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[5px] bg-black/18">
          <div className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.13] bg-black/55 px-2 text-[11px] font-normal text-white/74 shadow-xl shadow-black/35">
            <IconLoader2 className="size-3 animate-spin" />
            {statusLabel}
          </div>
        </div>
      ) : null}

      {composerVisible ? (
        <NodeComposer
          key={shot.id}
          columnIds={columnIds}
          layout={d.composerLayout}
          index={d.index}
          media={media}
          onComposerStateChange={d.onComposerStateChange}
          onSubmitGeneration={d.onSubmitGeneration}
          shot={shot}
          state={d.composerState}
          zoom={d.viewportZoom}
        />
      ) : null}
    </div>
  );
}

export const ShotNode = memo(ShotNodeImpl);
