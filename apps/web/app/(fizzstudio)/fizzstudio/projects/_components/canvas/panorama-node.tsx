"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Icon360View,
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { CanvasGenerationComposer } from "./canvas-generation-composer";
import type { CanvasGenerationRequest } from "./canvas-generation";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { downloadMediaFile, inferDownloadFilename } from "@/src/lib/media-download";
import type { CanvasAssetNode, MediaItem } from "../../_data/storyboard-schema";
import {
  MOCK_PANORAMA_IMAGE_URL,
  PANORAMA_NODE_HEIGHT,
  PANORAMA_NODE_WIDTH,
} from "./canvas-constants";
import type { NodeComposerLayout } from "./shot-node";

type PanoramaRelation = "selected" | "incoming" | "outgoing" | "neutral";

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

export type PanoramaGenerationRequest = CanvasGenerationRequest;
const DEFAULT_POSE: PanoramaPose = { fov: 60, pitch: 0, yaw: 0 };

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
        <CanvasGenerationComposer
          key={d.node.id}
          type="image"
          initial={{
            schemaVersion: d.node.settings?.schemaVersion,
            prompt: d.node.prompt ?? "",
            modelId: d.node.settings?.modelId ?? d.node.settings?.model ?? "",
            settings: d.node.settings?.input ?? {},
            referenceField: d.node.settings?.referenceField ?? "",
          }}
          layout={d.composerLayout}
          zoom={d.viewportZoom}
          busy={status === "queued" || status === "generating"}
          referenceUrl={
            d.referenceMedia?.url === MOCK_PANORAMA_IMAGE_URL ? undefined : d.referenceMedia?.url
          }
          onChange={(draft) =>
            d.onNodeChange?.(d.node.id, {
              prompt: draft.prompt,
              settings: {
                ...d.node.settings,
                modelId: draft.modelId,
                schemaVersion: draft.schemaVersion,
                input: draft.settings,
                referenceField: draft.referenceField,
              },
            })
          }
          onSubmit={
            d.onSubmitGeneration ? (request) => d.onSubmitGeneration!(d.node, request) : undefined
          }
        />
      ) : null}
    </div>
  );
}

export const PanoramaNode = memo(PanoramaNodeImpl);
