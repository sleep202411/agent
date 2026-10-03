"use client";

import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Icon360View,
  Icon3dCubeSphere,
  IconAdjustmentsHorizontal,
  IconCamera,
  IconChevronDown,
  IconDownload,
  IconExternalLink,
  IconGridDots,
  IconLoader2,
  IconPhoto,
  IconPlus,
  IconSend,
  IconSparkles,
  IconTag,
} from "@tabler/icons-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { downloadMediaFile, inferDownloadFilename } from "@/src/lib/media-download";
import type { CanvasAssetNode, MediaItem } from "../../_data/storyboard-schema";
import {
  MIN_CANVAS_ZOOM,
  NODE_COMPOSER_GAP,
  NODE_COMPOSER_WIDTH,
  MOCK_PANORAMA_IMAGE_URL,
  PANORAMA_NODE_HEIGHT,
  PANORAMA_NODE_WIDTH,
} from "./canvas-constants";
import type { NodeComposerLayout } from "./shot-node";

type PanoramaRelation = "selected" | "incoming" | "outgoing" | "neutral";
type PanoramaMenu = "format" | "model" | "output" | "settings" | null;
type PanoramaTool = "marker" | "style" | null;

type PanoramaPose = {
  fov: number;
  pitch: number;
  yaw: number;
};

export interface PanoramaNodeData {
  composerLayout: NodeComposerLayout;
  composerVisible: boolean;
  index: number;
  inspectorSelected: boolean;
  node: CanvasAssetNode;
  onNodeChange?: (nodeId: string, patch: Partial<Omit<CanvasAssetNode, "id" | "kind">>) => void;
  onOpenPreview?: (mediaId: string) => void;
  onSubmitGeneration?: (node: CanvasAssetNode, request: PanoramaGenerationRequest) => Promise<void>;
  referenceLabel?: string;
  referenceMedia?: MediaItem;
  relation: PanoramaRelation;
  sourceHandleActive: boolean;
  targetHandleActive: boolean;
  viewportZoom: number;
  [key: string]: unknown;
}

export type PanoramaGenerationRequest = {
  modelLabel: (typeof PANORAMA_MODELS)[number];
  outputCount: number;
  prompt: string;
  quality: (typeof PANORAMA_QUALITIES)[number];
  referenceUrl?: string;
  resolution: (typeof PANORAMA_RESOLUTIONS)[number];
};

const PANORAMA_MODELS = ["Fizz Image 2.0", "Fizz Image Pro", "Lib Image"] as const;
const PANORAMA_OUTPUT_COUNTS = [1, 2, 4] as const;
const PANORAMA_QUALITIES = ["standard", "high"] as const;
const PANORAMA_RESOLUTIONS = ["2K", "4K"] as const;
const DEFAULT_POSE: PanoramaPose = { fov: 60, pitch: 0, yaw: 0 };

function asPanoramaModel(value: string | undefined): (typeof PANORAMA_MODELS)[number] {
  return PANORAMA_MODELS.includes(value as (typeof PANORAMA_MODELS)[number])
    ? (value as (typeof PANORAMA_MODELS)[number])
    : PANORAMA_MODELS[0];
}

function resolvePanoramaMedia(node: CanvasAssetNode): MediaItem | undefined {
  const media = (node.media ?? []).filter((item) => item.url !== MOCK_PANORAMA_IMAGE_URL);
  return media.find((item) => item.preferred) ?? media[0];
}

function resolveNodeTone(relation: PanoramaRelation) {
  if (relation === "selected") {
    return {
      accent: "#d7dbe2",
      border: "rgba(215,219,226,0.74)",
      glow: "rgba(215,219,226,0.22)",
    };
  }
  if (relation === "incoming" || relation === "outgoing") {
    return {
      accent: "#c3ccd8",
      border: "rgba(195,204,216,0.46)",
      glow: "rgba(195,204,216,0.16)",
    };
  }
  return {
    accent: "#9ba1aa",
    border: "rgba(255,255,255,0.12)",
    glow: "rgba(0,0,0,0.76)",
  };
}

function PanoramaThreeViewport({
  imageUrl,
  onPoseChange,
}: {
  imageUrl: string;
  onPoseChange: (pose: PanoramaPose) => void;
}) {
  const t = useTranslations("fizzStudio");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mountRef = useRef<HTMLDivElement>(null);
  const poseTickRef = useRef(0);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let animationFrame = 0;
    let currentTexture: THREE.Texture | null = null;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.position.set(0, 0, 0.1);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "block size-full";
    renderer.domElement.setAttribute("data-engine", "three.js");
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.rotateSpeed = -0.35;
    controls.minDistance = 0.05;
    controls.maxDistance = 3;

    const geometry = new THREE.SphereGeometry(500, 64, 32);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: "#1f2937" });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };

    const applyTexture = (texture: THREE.Texture) => {
      if (currentTexture && currentTexture !== texture) currentTexture.dispose();
      currentTexture = texture;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      material.map = texture;
      material.color.set("#ffffff");
      material.needsUpdate = true;
    };

    if (imageUrl) {
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        imageUrl,
        (texture) => {
          if (disposed) {
            texture.dispose();
            return;
          }
          applyTexture(texture);
        },
        undefined,
        () => {
          if (!disposed) setFailed(true);
        }
      );
    }

    const emitPose = () => {
      const now = performance.now();
      if (now - poseTickRef.current < 120) return;
      poseTickRef.current = now;
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      const yaw = THREE.MathUtils.radToDeg(Math.atan2(direction.x, direction.z));
      const pitch = THREE.MathUtils.radToDeg(Math.asin(direction.y));
      onPoseChange({
        fov: Math.round(camera.fov),
        pitch: Math.round(pitch),
        yaw: Math.round(yaw),
      });
    };

    const render = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      emitPose();
      animationFrame = window.requestAnimationFrame(render);
    };

    resize();
    render();

    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    return () => {
      disposed = true;
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      controls.dispose();
      geometry.dispose();
      material.dispose();
      currentTexture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [imageUrl, onPoseChange, attempt]);

  return (
    <>
      <div
        ref={mountRef}
        className="nodrag nopan nowheel absolute inset-0 cursor-grab overflow-hidden rounded-[inherit] active:cursor-grabbing"
        data-fizz-panorama-canvas="true"
      />
      {failed ? (
        <div
          role="alert"
          className="nodrag nopan absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[#242426] px-6 text-center text-sm text-white/80"
        >
          <p>{t("sbPanoramaLoadFailed")}</p>
          <button
            type="button"
            className="rounded-lg bg-white/10 px-3 py-2 hover:bg-white/15"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            {t("retry")}
          </button>
        </div>
      ) : null}
    </>
  );
}

function PanoramaHud({ pose }: { pose: PanoramaPose }) {
  const yawRotation = `rotate(${pose.yaw}deg)`;

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex w-[78px] flex-col items-stretch rounded-lg border border-white/[0.12] bg-black/50 p-1 shadow-2xl shadow-black/40 backdrop-blur-md">
      <div className="relative mx-auto size-11">
        <div
          className="absolute left-1/2 top-1/2 h-px w-8 origin-left bg-cyan-300/80"
          style={{ transform: yawRotation }}
        />
        <div className="absolute left-1/2 top-1/2 h-px w-7 origin-left -rotate-45 bg-blue-300/65" />
        <div className="absolute left-1/2 top-1/2 h-px w-7 origin-left -rotate-90 bg-emerald-300/75" />
        <span className="absolute -right-0.5 top-1/2 -translate-y-1/2 text-[8px] font-medium text-cyan-200">
          Z
        </span>
        <span className="absolute left-1/2 -top-0.5 -translate-x-1/2 text-[8px] font-medium text-emerald-200">
          Y
        </span>
        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[8px] font-medium text-red-200">
          X
        </span>
        <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-200" />
      </div>
      <div className="grid grid-cols-2 gap-x-1 text-[7px] leading-3 text-white/62">
        <span>{pose.yaw}°</span>
        <span className="text-right">{pose.pitch}°</span>
        <span className="col-span-2 text-center">FOV {pose.fov}</span>
      </div>
    </div>
  );
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

function readPanoramaPromptText(root: HTMLElement, textElement: HTMLElement | null) {
  let text = "";
  for (const node of root.childNodes) {
    if (node instanceof HTMLElement) {
      if (
        node.dataset.fizzPanoramaPromptChip === "true" ||
        node.dataset.fizzPanoramaPromptPlaceholder === "true"
      ) {
        continue;
      }
    }
    text += node === textElement ? (textElement?.textContent ?? "") : (node.textContent ?? "");
  }

  return text.replace(/\u00a0/g, " ");
}

function normalizePanoramaPromptDom(
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
        node.dataset.fizzPanoramaPromptChip === "true" ||
        node.dataset.fizzPanoramaPromptPlaceholder === "true"
      ) {
        continue;
      }
    }
    root.removeChild(node);
  }
}

function PanoramaPromptEditor({
  ariaLabel,
  onFocusInput,
  onValueChange,
  placeholder,
  referenceLabel,
  value,
}: {
  ariaLabel: string;
  onFocusInput: () => void;
  onValueChange: (value: string) => void;
  placeholder: string;
  referenceLabel: string;
  value: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!textRef.current || textRef.current.textContent === value) return;
    textRef.current.textContent = value;
  }, [value]);

  const focusPromptEnd = () => {
    rootRef.current?.focus();
    placeCaretAtEnd(textRef.current);
  };

  const syncValueFromDom = () => {
    const root = rootRef.current;
    const textElement = textRef.current;
    if (!root) return;

    const nextText = readPanoramaPromptText(root, textElement).slice(0, 500);
    if (nextText !== readPanoramaPromptText(root, textElement)) {
      normalizePanoramaPromptDom(root, textElement, nextText);
      placeCaretAtEnd(textElement);
    }
    onValueChange(nextText);
  };

  return (
    <div
      ref={rootRef}
      data-fizz-panorama-prompt-input="true"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest("[data-fizz-panorama-prompt-text='true']")) focusPromptEnd();
      }}
      onFocus={onFocusInput}
      onInput={syncValueFromDom}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") event.currentTarget.blur();
      }}
      onPaste={(event) => {
        event.preventDefault();
        const root = rootRef.current;
        const textElement = textRef.current;
        if (!root || !textElement) return;

        const currentText = readPanoramaPromptText(root, textElement);
        const pasteText = event.clipboardData.getData("text/plain");
        const allowedText = pasteText.slice(0, Math.max(0, 500 - currentText.length));
        document.execCommand("insertText", false, allowedText);
      }}
      className="nodrag nowheel min-h-[58px] w-full cursor-text whitespace-pre-wrap break-words bg-transparent pb-5 pr-2 text-[15px] font-normal leading-7 text-white/88 outline-none"
      aria-label={ariaLabel}
    >
      <span
        data-fizz-panorama-prompt-chip="true"
        contentEditable={false}
        className="mention-badge mr-1 inline-flex h-7 select-none items-center gap-1 whitespace-nowrap rounded-lg border border-white/[0.11] bg-white/[0.07] px-1.5 align-[-0.18em] text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
      >
        <Icon360View className="size-4 text-indigo-300" />
        {referenceLabel}
      </span>
      <span ref={textRef} data-fizz-panorama-prompt-text="true" className="outline-none" />
      {value ? null : (
        <span
          data-fizz-panorama-prompt-placeholder="true"
          contentEditable={false}
          className="pointer-events-none select-none text-white/28"
        >
          {placeholder}
        </span>
      )}
    </div>
  );
}

function PanoramaComposer({
  node,
  onNodeChange,
  onSubmitGeneration,
  referenceMedia,
  referenceLabel,
  layout,
  zoom,
}: {
  layout: NodeComposerLayout;
  node: CanvasAssetNode;
  onNodeChange?: PanoramaNodeData["onNodeChange"];
  onSubmitGeneration?: PanoramaNodeData["onSubmitGeneration"];
  referenceLabel?: string;
  referenceMedia?: MediaItem;
  zoom: number;
}) {
  const t = useTranslations("fizzStudio");
  const safeZoom = Math.max(zoom, MIN_CANVAS_ZOOM);
  const inverseScale = 1 / safeZoom;
  const [activeMenu, setActiveMenu] = useState<PanoramaMenu>(null);
  const [activeTool, setActiveTool] = useState<PanoramaTool>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(node.prompt ?? "");
  const settings = node.settings ?? {};
  const model = asPanoramaModel(settings.model);
  const resolution = settings.resolution ?? "2K";
  const quality = settings.quality ?? "standard";
  const outputCount = settings.outputCount ?? 1;
  const status = node.status ?? "idle";
  const busy = submitting || status === "queued" || status === "generating";
  const canGenerate = prompt.trim().length > 0 && !busy;

  const updateNode = (patch: Partial<Omit<CanvasAssetNode, "id" | "kind">>) => {
    onNodeChange?.(node.id, patch);
  };

  const updateSettings = (patch: NonNullable<CanvasAssetNode["settings"]>) => {
    updateNode({ settings: { ...settings, ...patch } });
  };

  const appendToken = (token: string) => {
    const next = prompt ? `${prompt}，${token}` : token;
    setPrompt(next);
    updateNode({ prompt: next });
  };

  const renderMenu = (menu: Exclude<PanoramaMenu, null>) => {
    if (menu === "model") {
      return (
        <PanoramaMenuGroup label={t("sbPanoramaModel")}>
          {PANORAMA_MODELS.map((option) => (
            <PanoramaMenuItem
              key={option}
              active={option === model}
              label={option}
              onClick={() => updateSettings({ model: option })}
            />
          ))}
        </PanoramaMenuGroup>
      );
    }

    if (menu === "format") {
      return (
        <>
          <PanoramaMenuGroup label={t("sbPanoramaAspect")}>
            <PanoramaPill active label="2:1" />
          </PanoramaMenuGroup>
          <PanoramaMenuGroup label={t("sbPanoramaResolution")}>
            <div className="flex gap-1">
              {PANORAMA_RESOLUTIONS.map((option) => (
                <PanoramaPill
                  key={option}
                  active={option === resolution}
                  label={option}
                  onClick={() => updateSettings({ resolution: option })}
                />
              ))}
            </div>
          </PanoramaMenuGroup>
          <PanoramaMenuGroup label={t("sbPanoramaQuality")}>
            <div className="flex gap-1">
              {PANORAMA_QUALITIES.map((option) => (
                <PanoramaPill
                  key={option}
                  active={option === quality}
                  label={
                    option === "high" ? t("sbPanoramaQualityHigh") : t("sbPanoramaQualityStandard")
                  }
                  onClick={() => updateSettings({ quality: option })}
                />
              ))}
            </div>
          </PanoramaMenuGroup>
        </>
      );
    }

    if (menu === "output") {
      return (
        <PanoramaMenuGroup label={t("sbPanoramaOutput")}>
          <div className="flex gap-1">
            {PANORAMA_OUTPUT_COUNTS.map((option) => (
              <PanoramaPill
                key={option}
                active={option === outputCount}
                label={String(option)}
                onClick={() => updateSettings({ outputCount: option })}
              />
            ))}
          </div>
        </PanoramaMenuGroup>
      );
    }

    return (
      <PanoramaMenuGroup label={t("sbPanoramaSettings")}>
        <PanoramaMenuItem active label={t("sbPanoramaAutoSeam")} onClick={() => undefined} />
        <PanoramaMenuItem active label={t("sbPanoramaHorizonLock")} onClick={() => undefined} />
      </PanoramaMenuGroup>
    );
  };

  const toolOptions =
    activeTool === "style"
      ? [t("sbPanoramaStyleCinematic"), t("sbPanoramaStyleRealistic"), t("sbPanoramaStyleConcept")]
      : activeTool === "marker"
        ? [t("sbPanoramaMarkerLighting"), t("sbPanoramaMarkerScale"), t("sbPanoramaMarkerWeather")]
        : [];

  return (
    <div
      data-fizz-panorama-composer="true"
      className={cn(
        "node-floating-ui nodrag nowheel nopan absolute left-1/2 z-30 transition-[margin,opacity] duration-150 ease-out",
        layout.placement === "bottom" ? "top-full" : "bottom-full"
      )}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      style={{
        marginBottom: layout.placement === "top" ? NODE_COMPOSER_GAP / safeZoom : undefined,
        marginLeft: -NODE_COMPOSER_WIDTH / 2 + layout.offsetX / safeZoom,
        marginTop: layout.placement === "bottom" ? NODE_COMPOSER_GAP / safeZoom : undefined,
        transform: `scale(${inverseScale})`,
        transformOrigin: layout.placement === "bottom" ? "top center" : "bottom center",
        width: NODE_COMPOSER_WIDTH,
      }}
    >
      <div
        className="relative isolate flex min-h-[218px] w-full flex-col overflow-hidden rounded-xl border border-white/[0.12] p-2 text-white"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(42,42,44,0.76) 28%, rgba(30,30,32,0.84) 100%)",
          boxShadow:
            "0 24px 70px -42px rgba(0,0,0,0.98), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(255,255,255,0.05)",
          WebkitBackdropFilter: "blur(24px) saturate(140%)",
          backdropFilter: "blur(24px) saturate(140%)",
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit]"
          style={{
            background:
              "radial-gradient(110% 86% at 12% 0%, rgba(255,255,255,0.15), rgba(255,255,255,0.035) 40%, transparent 66%), linear-gradient(90deg, rgba(255,255,255,0.045), transparent 48%, rgba(255,255,255,0.025))",
          }}
        />

        <button
          type="button"
          className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-lg bg-[#262628]/72 text-white/52 transition-colors hover:bg-white/[0.08] hover:text-white/82"
          aria-label={t("sbComposerExpand")}
          title={t("sbComposerExpand")}
        >
          <IconExternalLink className="size-3.5" />
        </button>

        <div className="flex h-12 items-center gap-2 pr-9">
          <PanoramaToolButton
            active={activeTool === "style"}
            icon={<Icon3dCubeSphere className="size-4" />}
            label={t("sbPanoramaStyle")}
            onClick={() => {
              setActiveMenu(null);
              setActiveTool((current) => (current === "style" ? null : "style"));
            }}
          />
          <PanoramaToolButton
            active={activeTool === "marker"}
            icon={<IconTag className="size-4" />}
            label={t("sbPanoramaMarker")}
            onClick={() => {
              setActiveMenu(null);
              setActiveTool((current) => (current === "marker" ? null : "marker"));
            }}
          />
          <div
            className="relative size-12 overflow-hidden rounded-lg bg-[#1e1e22]/78 ring-1 ring-inset ring-white/[0.12]"
            title={referenceLabel}
          >
            {referenceMedia?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={referenceMedia.url}
                alt=""
                className="size-full object-cover"
                draggable={false}
              />
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

        {toolOptions.length > 0 ? (
          <div className="mt-2 flex h-8 items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.035] px-1">
            {toolOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => appendToken(option)}
                className="h-6 rounded-md px-2 text-[11px] font-normal text-white/62 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}

        <div className="relative mt-2 min-h-[74px] rounded-xl border border-white/[0.1] bg-white/[0.035] p-2">
          <PanoramaPromptEditor
            ariaLabel={t("sbPanoramaPromptInput")}
            placeholder={t("sbPanoramaPromptPlaceholder")}
            referenceLabel={t("sbPanoramaReferenceChip")}
            value={prompt}
            onFocusInput={() => setActiveMenu(null)}
            onValueChange={(next) => {
              setPrompt(next);
              setSubmitError(null);
              updateNode({ prompt: next });
            }}
          />
          <span className="pointer-events-none absolute bottom-1.5 right-2 text-[10px] tabular-nums text-white/28">
            {prompt.length}/500
          </span>
          {submitError ? (
            <span className="pointer-events-none absolute bottom-1.5 left-2 max-w-[360px] truncate text-[10px] font-normal text-white/44">
              {submitError}
            </span>
          ) : null}
        </div>

        <div className="mt-auto flex h-9 w-full items-end gap-1 pt-2">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <PanoramaMenuAnchor
              panel={activeMenu === "model" ? renderMenu("model") : null}
              widthClassName="w-[188px]"
            >
              <PanoramaMetaButton
                active={activeMenu === "model"}
                icon={<IconSparkles className="size-3.5" />}
                label={model}
                onClick={() => setActiveMenu((current) => (current === "model" ? null : "model"))}
              />
            </PanoramaMenuAnchor>
            <PanoramaMenuAnchor
              panel={activeMenu === "format" ? renderMenu("format") : null}
              widthClassName="w-[226px]"
            >
              <PanoramaMetaButton
                active={activeMenu === "format"}
                icon={<IconGridDots className="size-3.5" />}
                label={`2:1 · ${resolution}`}
                onClick={() => setActiveMenu((current) => (current === "format" ? null : "format"))}
              />
            </PanoramaMenuAnchor>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <PanoramaMetaButton
              disabled
              icon={<IconCamera className="size-3.5" />}
              label={t("sbPanoramaCamera")}
            />
            <PanoramaMenuAnchor
              align="right"
              panel={activeMenu === "settings" ? renderMenu("settings") : null}
              widthClassName="w-[210px]"
            >
              <PanoramaIconButton
                active={activeMenu === "settings"}
                label={t("sbPanoramaSettings")}
                onClick={() =>
                  setActiveMenu((current) => (current === "settings" ? null : "settings"))
                }
              >
                <IconAdjustmentsHorizontal className="size-4" />
              </PanoramaIconButton>
            </PanoramaMenuAnchor>
            <PanoramaMenuAnchor
              align="right"
              panel={activeMenu === "output" ? renderMenu("output") : null}
              widthClassName="w-[140px]"
            >
              <PanoramaMetaButton
                active={activeMenu === "output"}
                icon={<IconPlus className="size-3.5" />}
                label={
                  outputCount === 1
                    ? t("sbPanoramaOutputOne")
                    : t("sbPanoramaOutputMany").replace("{count}", String(outputCount))
                }
                onClick={() => setActiveMenu((current) => (current === "output" ? null : "output"))}
              />
            </PanoramaMenuAnchor>
            <span className="inline-flex h-8 items-center gap-1 px-1.5 text-[13px] font-normal text-white/35">
              <IconSparkles className="size-3.5" />
              22
            </span>
            <button
              type="button"
              disabled={!canGenerate}
              onClick={async () => {
                if (!canGenerate) return;
                setActiveMenu(null);
                setSubmitError(null);
                setSubmitting(true);
                try {
                  await onSubmitGeneration?.(node, {
                    modelLabel: model,
                    outputCount,
                    prompt: prompt.trim(),
                    quality,
                    referenceUrl: referenceMedia?.url,
                    resolution,
                  });
                } catch (error) {
                  setSubmitError(
                    error instanceof Error ? error.message : t("sbGenerationSubmitFailed")
                  );
                } finally {
                  setSubmitting(false);
                }
              }}
              className="flex size-8 items-center justify-center rounded-lg bg-white text-black transition-colors hover:bg-white/88 disabled:pointer-events-none disabled:bg-white/35 disabled:text-black/45"
              aria-label={t("sbPanoramaGenerate")}
              title={t("sbPanoramaGenerate")}
            >
              {busy ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconSend className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PanoramaToolButton({
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
        "flex size-12 flex-col items-center justify-center rounded-lg border text-[11px] font-normal transition-colors",
        active
          ? "border-white/[0.22] bg-white/[0.12] text-white"
          : "border-white/[0.1] bg-white/[0.035] text-white/52 hover:border-white/[0.16] hover:text-white/78"
      )}
      aria-pressed={active}
      title={label}
    >
      {icon}
      <span className="mt-0.5 leading-none">{label}</span>
    </button>
  );
}

function PanoramaMetaButton({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 min-w-0 items-center gap-1 rounded-lg px-2 text-[13px] font-normal leading-none transition-colors",
        active
          ? "bg-white/[0.12] text-white"
          : "text-white/78 hover:bg-white/[0.07] hover:text-white",
        disabled && "pointer-events-none text-white/28"
      )}
      title={label}
    >
      {icon}
      <span className="truncate">{label}</span>
      {!disabled ? <IconChevronDown className="size-3.5 shrink-0 text-white/38" /> : null}
    </button>
  );
}

function PanoramaIconButton({
  active,
  children,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-white/[0.13] text-white"
          : "text-white/66 hover:bg-white/[0.08] hover:text-white"
      )}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function PanoramaMenuAnchor({
  align,
  children,
  panel,
  widthClassName,
}: {
  align?: "left" | "right";
  children: ReactNode;
  panel: ReactNode;
  widthClassName: string;
}) {
  return (
    <div className="relative min-w-0 shrink-0">
      {children}
      {panel ? (
        <div
          data-fizz-panorama-menu-panel="true"
          className={cn(
            "absolute bottom-[calc(100%+8px)] z-40 rounded-xl border border-white/[0.12] bg-[#27272a]/84 p-2 text-white shadow-[0_18px_54px_-28px_rgba(0,0,0,0.98),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl",
            widthClassName,
            align === "right" ? "right-0" : "left-0"
          )}
          style={{
            WebkitBackdropFilter: "blur(22px) saturate(145%)",
            backdropFilter: "blur(22px) saturate(145%)",
          }}
        >
          <div className="space-y-2">{panel}</div>
        </div>
      ) : null}
    </div>
  );
}

function PanoramaMenuGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[10px] font-normal leading-4 text-white/38">{label}</div>
      {children}
    </div>
  );
}

function PanoramaMenuItem({
  active,
  label,
  onClick,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-[13px] font-normal transition-colors",
        active
          ? "bg-white/[0.1] text-white"
          : "text-white/62 hover:bg-white/[0.06] hover:text-white"
      )}
    >
      <span>{label}</span>
      {active ? <span className="size-1.5 rounded-full bg-white/80" /> : null}
    </button>
  );
}

function PanoramaPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick?: () => void;
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

function PanoramaNodeImpl({ data, selected }: NodeProps) {
  const d = data as PanoramaNodeData;
  const t = useTranslations("fizzStudio");
  const [pose, setPose] = useState<PanoramaPose>(DEFAULT_POSE);
  const media = resolvePanoramaMedia(d.node);
  const active = selected || d.inspectorSelected;
  const visualRelation = active ? "selected" : d.relation;
  const relationActive = visualRelation !== "neutral";
  const tone = resolveNodeTone(visualRelation);
  const sourceHandleHighlighted = active || d.sourceHandleActive;
  const targetHandleHighlighted = active || d.targetHandleActive;
  const title = d.node.title || t("sbPanoramaTitle");
  const mediaUrl = media?.url;
  const reference =
    d.referenceMedia?.url !== MOCK_PANORAMA_IMAGE_URL ? d.referenceMedia : undefined;
  const previewUrl = mediaUrl ?? reference?.url;
  const previewMedia = mediaUrl ? media : reference;
  const dimensionLabel =
    previewMedia?.width && previewMedia?.height
      ? `${previewMedia.width} x ${previewMedia.height}`
      : "";
  const status = d.node.status ?? "idle";
  const failed = status === "failed" || status === "cancelled";
  const statusMessage = d.node.generation?.error || media?.error || t("sbGenerationFailed");

  const handleClassName = cn(
    "!flex !items-center !justify-center !border-2 !border-[#09090b] !opacity-95 transition-[background-color,box-shadow,width,height]"
  );

  return (
    <div
      className={cn(
        "group relative overflow-visible rounded-xl border bg-[#222226] transition-[border-color,box-shadow]",
        relationActive
          ? "shadow-[0_18px_58px_-28px_var(--node-glow)]"
          : "shadow-[0_18px_52px_-34px_rgba(0,0,0,0.95)]"
      )}
      data-fizz-panorama-node="true"
      style={
        {
          "--node-glow": tone.glow,
          borderColor: tone.border,
          height: PANORAMA_NODE_HEIGHT,
          width: PANORAMA_NODE_WIDTH,
        } as CSSProperties
      }
    >
      <div className="pointer-events-none absolute -top-6 left-0 right-0 flex items-center justify-between text-[13px] font-normal leading-5 text-white/50">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon360View className="size-4 shrink-0 text-white/58" />
          <span className="truncate">{title}</span>
        </span>
        <span className="tabular-nums text-white/34">{dimensionLabel}</span>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          handleClassName,
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
          handleClassName,
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

      <div className="relative size-full overflow-hidden rounded-[11px] bg-[#242426]">
        {previewUrl ? (
          <PanoramaThreeViewport key={previewUrl} imageUrl={previewUrl} onPoseChange={setPose} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white/65">
            <Icon360View className="size-8 text-white/40" aria-hidden />
            <p>{t("sbPanoramaEmpty")}</p>
          </div>
        )}
        {!mediaUrl && previewUrl ? (
          <p className="absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-xs text-white/80">
            {t("sbPanoramaReferencePreview")}
          </p>
        ) : null}
        <div
          aria-hidden="true"
          className="canvas-node-drag-handle pointer-events-none absolute inset-0 z-10 rounded-[inherit]"
          data-fizz-panorama-drag-rail="true"
        >
          <div className="canvas-node-drag-handle pointer-events-auto absolute left-4 right-16 top-0 h-5 cursor-grab active:cursor-grabbing" />
          <div className="canvas-node-drag-handle pointer-events-auto absolute bottom-0 left-4 right-4 h-5 cursor-grab active:cursor-grabbing" />
          <div className="canvas-node-drag-handle pointer-events-auto absolute left-0 top-5 h-[calc(50%-32px)] w-5 cursor-grab active:cursor-grabbing" />
          <div className="canvas-node-drag-handle pointer-events-auto absolute bottom-5 left-0 h-[calc(50%-32px)] w-5 cursor-grab active:cursor-grabbing" />
          <div className="canvas-node-drag-handle pointer-events-auto absolute right-0 top-14 h-[calc(50%-42px)] w-5 cursor-grab active:cursor-grabbing" />
          <div className="canvas-node-drag-handle pointer-events-auto absolute bottom-5 right-0 h-[calc(50%-32px)] w-5 cursor-grab active:cursor-grabbing" />
        </div>
        <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/[0.06]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_0%,rgba(255,255,255,0.16),transparent_56%)] opacity-70" />
        <div className="nodrag nopan absolute right-3 top-3 z-20 flex items-center gap-2">
          {mediaUrl ? (
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const saved = await downloadMediaFile(mediaUrl, {
                    filename: inferDownloadFilename(mediaUrl, media?.mimeType, title),
                  });
                  if (!saved) toast.error(t("sbDownloadFailed"));
                })();
              }}
              className="flex size-10 items-center justify-center rounded-lg border border-white/[0.08] bg-black/45 text-white/76 shadow-xl shadow-black/35 backdrop-blur-md transition-colors hover:bg-black/58 hover:text-white"
              aria-label={t("sbNodeDownload")}
              title={t("sbNodeDownload")}
            >
              <IconDownload className="size-5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (media?.id) d.onOpenPreview?.(media.id);
            }}
            disabled={!media?.id || !mediaUrl}
            className="flex size-10 items-center justify-center rounded-lg border border-white/[0.08] bg-black/45 text-white/76 shadow-xl shadow-black/35 backdrop-blur-md transition-colors hover:bg-black/58 hover:text-white disabled:pointer-events-none disabled:opacity-40"
            aria-label={t("sbPanoramaOpenViewer")}
            title={t("sbPanoramaOpenViewer")}
          >
            <IconExternalLink className="size-5" />
          </button>
        </div>
        {previewUrl ? <PanoramaHud pose={pose} /> : null}
        {status === "queued" || status === "generating" ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/18 backdrop-blur-[1px]">
            <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.16] bg-black/56 px-3 text-[13px] font-semibold text-white shadow-2xl shadow-black/35">
              <IconLoader2 className="size-4 animate-spin" />
              {t("sbPanoramaGenerating")}
            </div>
          </div>
        ) : failed ? (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center">
            <div className="max-w-[80%] truncate rounded-lg border border-white/[0.12] bg-black/60 px-3 py-2 text-[12px] font-normal text-white/62 shadow-2xl shadow-black/35 backdrop-blur-md">
              {statusMessage}
            </div>
          </div>
        ) : null}
      </div>

      {d.composerVisible ? (
        <PanoramaComposer
          layout={d.composerLayout}
          node={d.node}
          onNodeChange={d.onNodeChange}
          onSubmitGeneration={d.onSubmitGeneration}
          referenceLabel={d.referenceLabel}
          referenceMedia={d.referenceMedia}
          zoom={d.viewportZoom}
        />
      ) : null}
    </div>
  );
}

export const PanoramaNode = memo(PanoramaNodeImpl);
