"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  IconArrowLeft,
  IconBook2,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconExternalLink,
  IconFileDescription,
  IconFocusCentered,
  IconMovie,
  IconPlayerPlay,
  IconRoute,
  IconSearch,
  IconSparkles,
  IconVolume,
  IconX,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { useSiteRegion } from "@/app/_components/region-provider";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { getWebBaseUrl } from "@/lib/web-base";
import {
  JINLING_INTERACTIVE_FILM_ASSETS,
  JINLING_INTERACTIVE_FILM_DRAFT,
  type InteractiveFilmAsset,
  type InteractiveFilmCreatorDraft,
} from "./jinling-example";

type FilmNodeKind = "entry" | "scene" | "choice" | "ending";
type AssetFilter = "all" | "video" | "audio";

type FilmNodeData = {
  kind: FilmNodeKind;
  label: string;
  eyebrow: string;
  summary?: string;
  sceneId?: string;
  choiceId?: string;
  endingId?: string;
  assetId?: string;
  sequenceAssetIds?: string[];
  targetLabel?: string;
  durationSeconds?: number;
  fallback?: boolean;
};

type FilmCanvasNode = Node<FilmNodeData, "filmNode">;
type FilmCanvasEdge = Edge & {
  pathOptions?: {
    curvature?: number;
  };
};
type CanvasPosition = { x: number; y: number };
type ValidationCheck = { id: string; passed: boolean };

const NODE_TYPES = { filmNode: FilmNode };
const DEFAULT_EDGE_OPTIONS = {
  type: "default",
  pathOptions: { curvature: 0.42 },
  interactionWidth: 28,
  style: {
    stroke: "rgba(255,255,255,0.24)",
    strokeLinecap: "round",
    strokeWidth: 1.5,
  },
  markerEnd: { type: MarkerType.ArrowClosed, color: "rgba(255,255,255,0.32)" },
} satisfies Partial<FilmCanvasEdge>;

const assetsById = new Map(JINLING_INTERACTIVE_FILM_ASSETS.map((asset) => [asset.assetId, asset]));

function sceneNodeId(sceneId: string) {
  return `scene:${sceneId}`;
}

function choiceNodeId(sceneId: string, choiceId: string) {
  return `choice:${sceneId}:${choiceId}`;
}

function endingNodeId(endingId: string) {
  return `ending:${endingId}`;
}

function buildCanvasNodes(
  draft: InteractiveFilmCreatorDraft,
  positions: Record<string, CanvasPosition> = {}
): FilmCanvasNode[] {
  const nodes: FilmCanvasNode[] = [];
  const entryId = "entry:ledger";
  nodes.push({
    id: entryId,
    type: "filmNode",
    position: positions[entryId] ?? { x: 0, y: 250 },
    data: {
      kind: "entry",
      label: "无字命册",
      eyebrow: "P00 · Prologue",
      summary: "玩家身份建立、命册落印，并由水面与车厢转场进入第一章。",
      sequenceAssetIds: JINLING_INTERACTIVE_FILM_ASSETS.filter(
        (asset) => asset.role === "prologue"
      ).map((asset) => asset.assetId),
    },
  });

  draft.scenes.forEach((scene, sceneIndex) => {
    const id = sceneNodeId(scene.sceneId);
    const master = assetsById.get(scene.masterAssetId);
    nodes.push({
      id,
      type: "filmNode",
      position: positions[id] ?? { x: 520 + sceneIndex * 680, y: 90 },
      data: {
        kind: "scene",
        label: scene.title,
        eyebrow: `${String(scene.number).padStart(2, "0")} · ${scene.eyebrow}`,
        summary: scene.summary,
        sceneId: scene.sceneId,
        assetId: scene.masterAssetId,
        sequenceAssetIds: scene.sequenceAssetIds,
        durationSeconds: master?.durationSeconds,
      },
    });

    scene.choices.forEach((choice, choiceIndex) => {
      const choiceId = choiceNodeId(scene.sceneId, choice.choiceId);
      const targetScene = choice.targetSceneId
        ? draft.scenes.find((candidate) => candidate.sceneId === choice.targetSceneId)
        : undefined;
      const targetEnding = choice.endingId
        ? draft.endings.find((candidate) => candidate.endingId === choice.endingId)
        : undefined;
      nodes.push({
        id: choiceId,
        type: "filmNode",
        position:
          positions[choiceId] ??
          ({
            x: 590 + sceneIndex * 680,
            y: 650 + choiceIndex * 155,
          } satisfies CanvasPosition),
        data: {
          kind: "choice",
          label: choice.label,
          eyebrow: `Choice ${choiceIndex + 1}`,
          sceneId: scene.sceneId,
          choiceId: choice.choiceId,
          assetId: choice.reactionAssetId,
          targetLabel: targetScene?.title ?? targetEnding?.title ?? "—",
        },
      });
    });
  });

  draft.endings.forEach((ending, index) => {
    const id = endingNodeId(ending.endingId);
    nodes.push({
      id,
      type: "filmNode",
      position: positions[id] ?? { x: 3260, y: 400 + index * 190 },
      data: {
        kind: "ending",
        label: ending.title,
        eyebrow: `Ending ${String(index + 1).padStart(2, "0")}`,
        endingId: ending.endingId,
        assetId: ending.assetId,
        fallback: ending.fallback,
      },
    });
  });
  return nodes;
}

function buildCanvasEdges(draft: InteractiveFilmCreatorDraft): FilmCanvasEdge[] {
  const edges: FilmCanvasEdge[] = [
    {
      id: "entry-to-c1",
      source: "entry:ledger",
      target: sceneNodeId(draft.entrySceneId),
      ...DEFAULT_EDGE_OPTIONS,
    },
  ];

  draft.scenes.forEach((scene) => {
    scene.choices.forEach((choice) => {
      const choiceId = choiceNodeId(scene.sceneId, choice.choiceId);
      edges.push({
        id: `${scene.sceneId}-to-${choice.choiceId}`,
        source: sceneNodeId(scene.sceneId),
        target: choiceId,
        ...DEFAULT_EDGE_OPTIONS,
        style: { stroke: "rgba(229,34,39,0.5)", strokeWidth: 1.7 },
      });
      const target = choice.targetSceneId
        ? sceneNodeId(choice.targetSceneId)
        : choice.endingId
          ? endingNodeId(choice.endingId)
          : null;
      if (target) {
        edges.push({
          id: `${choiceId}-to-${target}`,
          source: choiceId,
          target,
          ...DEFAULT_EDGE_OPTIONS,
        });
      }
    });
  });
  const fallbackEnding = draft.endings.find((ending) => ending.fallback);
  const finalScene = draft.scenes.at(-1);
  if (fallbackEnding && finalScene) {
    edges.push({
      id: `${finalScene.sceneId}-fallback-${fallbackEnding.endingId}`,
      source: sceneNodeId(finalScene.sceneId),
      target: endingNodeId(fallbackEnding.endingId),
      ...DEFAULT_EDGE_OPTIONS,
      style: {
        stroke: "rgba(255,255,255,0.18)",
        strokeWidth: 1.4,
        strokeDasharray: "5 7",
      },
    });
  }
  return edges;
}

function FilmNode({ data, selected }: NodeProps<FilmCanvasNode>) {
  const t = useTranslations("interactiveFilmStudio");
  const asset = data.assetId ? assetsById.get(data.assetId) : undefined;
  const isScene = data.kind === "scene";
  const isChoice = data.kind === "choice";
  const isEnding = data.kind === "ending";
  const width = isScene ? "w-[460px]" : isChoice ? "w-[310px]" : "w-[360px]";

  return (
    <article
      aria-label={`${data.eyebrow}: ${data.label}`}
      className={cn(
        "group relative overflow-hidden rounded-[24px] bg-[oklch(0.18_0_0)] shadow-[0_24px_80px_rgba(0,0,0,0.38)] transition duration-200",
        width,
        selected && "bg-[oklch(0.22_0_0)] shadow-[0_28px_100px_rgba(0,0,0,0.54)]"
      )}
    >
      <Handle
        id="node-in"
        type="target"
        position={Position.Left}
        className="-left-1.5! z-20! size-3! border-0! bg-white/45!"
      />
      <Handle
        id="node-out"
        type="source"
        position={Position.Right}
        className="-right-1.5! z-20! size-3! border-0! bg-white/58!"
      />

      {isScene && asset ? (
        <div className="relative aspect-video overflow-hidden bg-black">
          <video
            src={asset.url}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover opacity-72"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_30%,rgba(0,0,0,0.75)_100%)]" />
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10px] text-white/64 backdrop-blur-lg">
            <IconClock className="size-3" />
            {data.durationSeconds ? formatDuration(data.durationSeconds) : "—"}
          </span>
          <span className="absolute bottom-3 left-3 grid size-9 place-items-center rounded-full bg-white text-black shadow-lg">
            <IconPlayerPlay className="size-4 fill-black" />
          </span>
        </div>
      ) : null}

      <div className={cn("p-4", isChoice && "p-3.5")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-white/36 uppercase">
              {data.eyebrow}
            </p>
            <h3
              className={cn(
                "mt-1 font-semibold tracking-[-0.015em] text-white/92",
                isScene ? "text-lg" : "text-[14px] leading-5"
              )}
            >
              {data.label}
            </h3>
          </div>
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/56",
              isChoice && "bg-[#E52227]/12 text-[#ff8b8e]"
            )}
          >
            {data.kind === "entry" ? <IconBook2 className="size-4" /> : null}
            {isScene ? <IconMovie className="size-4" /> : null}
            {isChoice ? <IconRoute className="size-4" /> : null}
            {isEnding ? <IconSparkles className="size-4" /> : null}
          </span>
        </div>

        {data.summary ? (
          <p className="mt-2 line-clamp-3 text-[11px] leading-[18px] text-white/44">
            {data.summary}
          </p>
        ) : null}

        {data.sequenceAssetIds?.length ? (
          <div className="mt-3 flex gap-1 overflow-hidden">
            {data.sequenceAssetIds.slice(0, isScene ? 8 : 6).map((assetId, index) => (
              <span
                key={assetId}
                title={assetsById.get(assetId)?.label}
                className="grid h-7 min-w-7 flex-1 place-items-center rounded-lg bg-white/[0.055] text-[9px] font-semibold text-white/36"
              >
                {index + 1}
              </span>
            ))}
            {data.sequenceAssetIds.length > (isScene ? 8 : 6) ? (
              <span className="grid h-7 min-w-8 place-items-center rounded-lg bg-white/[0.055] text-[9px] text-white/36">
                +{data.sequenceAssetIds.length - 8}
              </span>
            ) : null}
          </div>
        ) : null}

        {isChoice ? (
          <div className="mt-3 flex items-center justify-between gap-2 text-[10px]">
            <span className="truncate text-white/32">{asset?.label}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-white/48">
              {data.targetLabel}
              <IconChevronRight className="size-3" />
            </span>
          </div>
        ) : null}

        {isEnding ? (
          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[9px] text-white/42">
              {data.fallback ? t("canvas.fallbackEnding") : t("canvas.authoredEnding")}
            </span>
            <span className="truncate text-[9px] text-white/28">{asset?.label}</span>
          </div>
        ) : null}
      </div>
      {selected ? <div className="absolute inset-x-4 bottom-0 h-0.5 bg-[#E52227]" /> : null}
    </article>
  );
}

function InteractiveFilmCanvasInner() {
  const t = useTranslations("interactiveFilmStudio");
  const locale = useLocale();
  const siteRegion = useSiteRegion();
  const { fitView } = useReactFlow<FilmCanvasNode, FilmCanvasEdge>();
  const draft = JINLING_INTERACTIVE_FILM_DRAFT;
  const [nodes, , applyNodeChanges] = useNodesState<FilmCanvasNode>(
    buildCanvasNodes(JINLING_INTERACTIVE_FILM_DRAFT)
  );
  const [edges] = useState<FilmCanvasEdge[]>(() =>
    buildCanvasEdges(JINLING_INTERACTIVE_FILM_DRAFT)
  );
  const [selectedNodeId, setSelectedNodeId] = useState(sceneNodeId(draft.entrySceneId));
  const [assetLibraryOpen, setAssetLibraryOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState(draft.scenes[0]!.masterAssetId);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [assetQuery, setAssetQuery] = useState("");
  const [playerHref, setPlayerHref] = useState(
    `${getWebBaseUrl(siteRegion)}/${locale}/play/jinling`
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (window.location.hostname === "localhost") {
        setPlayerHref(`http://localhost:9527/${locale}/play/jinling`);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [locale]);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const validationChecks = useMemo(() => validateDraft(draft), [draft]);
  const filteredAssets = useMemo(() => {
    const query = assetQuery.trim().toLowerCase();
    return JINLING_INTERACTIVE_FILM_ASSETS.filter((asset) => {
      if (assetFilter !== "all" && asset.kind !== assetFilter) return false;
      return !query || `${asset.label} ${asset.role}`.toLowerCase().includes(query);
    });
  }, [assetFilter, assetQuery]);

  const selectNode = (node: FilmCanvasNode) => {
    setSelectedNodeId(node.id);
    if (node.data.assetId) setSelectedAssetId(node.data.assetId);
  };

  return (
    <main className="relative h-screen min-w-[1180px] overflow-hidden bg-[oklch(0.105_0_0)] text-white">
      <header className="absolute inset-x-0 top-0 z-40 flex h-16 items-center justify-between bg-[oklch(0.14_0_0)/0.94] px-4 shadow-[0_14px_50px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/story-studio"
            aria-label={t("back")}
            className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.07] text-white/68 transition hover:bg-white/[0.12] hover:text-white"
          >
            <IconArrowLeft className="size-5" />
          </Link>
          <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.08] text-white/78">
            <IconBook2 className="size-5" stroke={1.7} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
                {draft.title}
              </h1>
              <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-white/52 uppercase">
                {t("canvas.mode")}
              </span>
              <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[10px] font-semibold text-white/58">
                {t("previewNotice")}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-white/42">{draft.subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAssetLibraryOpen((current) => !current)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition",
              assetLibraryOpen
                ? "bg-white text-black"
                : "bg-white/[0.07] text-white/66 hover:bg-white/[0.12] hover:text-white"
            )}
          >
            <IconMovie className="size-4" />
            {t("assets.title")}
          </button>
          <button
            type="button"
            onClick={() => void fitView({ padding: 0.16, duration: 450 })}
            className="grid size-9 place-items-center rounded-xl bg-white/[0.07] text-white/66 transition hover:bg-white/[0.12] hover:text-white"
            aria-label={t("canvas.fit")}
            title={t("canvas.fit")}
          >
            <IconFocusCentered className="size-4" />
          </button>
          <a
            href={playerHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#E52227] px-3.5 text-xs font-semibold text-white shadow-[0_10px_28px_rgba(229,34,39,0.22)] transition hover:bg-[#f02e33]"
          >
            <IconExternalLink className="size-4" />
            {t("openPlayer")}
          </a>
        </div>
      </header>

      <section className="absolute inset-x-0 top-16 bottom-0 right-[360px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={applyNodeChanges}
          onNodeClick={(_event, node) => selectNode(node)}
          onSelectionChange={({ nodes: selected }) => {
            const latest = selected.at(-1);
            if (latest) selectNode(latest);
          }}
          nodeTypes={NODE_TYPES}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
          minZoom={0.16}
          maxZoom={1.5}
          defaultViewport={{ x: 70, y: 200, zoom: 0.32 }}
          snapToGrid
          snapGrid={[20, 20]}
          panOnScroll
          nodesDraggable={false}
          selectNodesOnDrag={false}
          zoomOnDoubleClick={false}
          style={{ backgroundColor: "oklch(0.105 0 0)" }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={18}
            size={1.2}
            color="rgb(255 255 255 / 0.11)"
            bgColor="oklch(0.105 0 0)"
          />
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            className="bottom-5! left-20! m-0! overflow-hidden rounded-[18px] bg-[oklch(0.18_0_0)]! shadow-[0_18px_60px_rgba(0,0,0,0.4)]"
            bgColor="oklch(0.18 0 0)"
            maskColor="rgba(0,0,0,0.46)"
            nodeColor="rgba(255,255,255,0.42)"
            nodeStrokeWidth={0}
          />
          <Controls
            position="bottom-left"
            className="bottom-5! left-5! overflow-hidden rounded-full bg-[oklch(0.18_0_0)]! p-1! shadow-[0_18px_60px_rgba(0,0,0,0.35)] [&_button]:size-9! [&_button]:border-0! [&_button]:bg-transparent! [&_button]:text-white/70! [&_button:hover]:bg-white/10! [&_svg]:fill-white/70!"
            showInteractive={false}
          />
        </ReactFlow>
        <div className="pointer-events-none absolute top-4 left-5 rounded-full bg-black/30 px-3 py-1.5 text-[10px] text-white/35 backdrop-blur-lg">
          {t("canvas.hint")}
        </div>
      </section>

      {assetLibraryOpen ? (
        <AssetLibrary
          assets={filteredAssets}
          filter={assetFilter}
          query={assetQuery}
          selectedAssetId={selectedAssetId}
          onClose={() => setAssetLibraryOpen(false)}
          onFilterChange={setAssetFilter}
          onQueryChange={setAssetQuery}
          onSelect={setSelectedAssetId}
        />
      ) : null}

      <NodeInspector
        draft={draft}
        node={selectedNode}
        selectedAssetId={selectedAssetId}
        checks={validationChecks}
        onSelectAsset={setSelectedAssetId}
      />
    </main>
  );
}

function AssetLibrary({
  assets,
  filter,
  query,
  selectedAssetId,
  onClose,
  onFilterChange,
  onQueryChange,
  onSelect,
}: {
  assets: InteractiveFilmAsset[];
  filter: AssetFilter;
  query: string;
  selectedAssetId: string;
  onClose: () => void;
  onFilterChange: (filter: AssetFilter) => void;
  onQueryChange: (query: string) => void;
  onSelect: (assetId: string) => void;
}) {
  const t = useTranslations("interactiveFilmStudio");
  return (
    <aside className="absolute top-16 bottom-0 left-0 z-30 flex w-[310px] flex-col bg-[oklch(0.145_0_0)/0.98] px-3 py-4 shadow-[24px_0_80px_rgba(0,0,0,0.42)] backdrop-blur-xl">
      <div className="flex items-center justify-between px-2">
        <div>
          <h2 className="text-sm font-semibold">{t("assets.title")}</h2>
          <p className="mt-0.5 text-[11px] text-white/38">{t("assets.azureRelease")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-8 place-items-center rounded-xl bg-white/[0.06] text-white/48 hover:bg-white/[0.1] hover:text-white"
          aria-label={t("assets.close")}
        >
          <IconX className="size-4" />
        </button>
      </div>
      <label className="mt-4 flex h-9 items-center gap-2 rounded-xl bg-white/[0.06] px-3">
        <IconSearch className="size-4 text-white/32" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("assets.search")}
          className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/28"
        />
      </label>
      <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-black/18 p-1">
        {(["all", "video", "audio"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilterChange(key)}
            className={cn(
              "h-7 rounded-lg text-[10px] font-semibold transition",
              filter === key ? "bg-white/[0.12] text-white" : "text-white/38 hover:text-white/68"
            )}
          >
            {t(`assets.filters.${key}`)}
          </button>
        ))}
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {assets.map((asset) => (
          <button
            key={asset.assetId}
            type="button"
            onClick={() => onSelect(asset.assetId)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition",
              asset.assetId === selectedAssetId ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-black/24 text-white/58">
              {asset.kind === "video" ? (
                <IconMovie className="size-4" />
              ) : (
                <IconVolume className="size-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold text-white/78">
                {asset.label}
              </span>
              <span className="mt-0.5 text-[9px] font-semibold tracking-[0.08em] text-white/32 uppercase">
                {asset.role}
                {asset.durationSeconds ? ` · ${formatDuration(asset.durationSeconds)}` : ""}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function NodeInspector({
  draft,
  node,
  selectedAssetId,
  checks,
  onSelectAsset,
}: {
  draft: InteractiveFilmCreatorDraft;
  node: FilmCanvasNode | null;
  selectedAssetId: string;
  checks: ValidationCheck[];
  onSelectAsset: (assetId: string) => void;
}) {
  const t = useTranslations("interactiveFilmStudio");
  const scene = node?.data.sceneId
    ? draft.scenes.find((candidate) => candidate.sceneId === node.data.sceneId)
    : undefined;
  const choice =
    scene && node?.data.choiceId
      ? scene.choices.find((candidate) => candidate.choiceId === node.data.choiceId)
      : undefined;
  const selectedAsset = assetsById.get(selectedAssetId);
  const nodeAsset = node?.data.assetId ? assetsById.get(node.data.assetId) : undefined;
  const previewAsset = selectedAsset ?? nodeAsset;

  return (
    <aside className="absolute top-16 right-0 bottom-0 z-30 w-[360px] overflow-y-auto bg-[oklch(0.15_0_0)] px-5 py-5 shadow-[-18px_0_60px_rgba(0,0,0,0.24)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.12em] text-white/34 uppercase">
            {node ? t(`canvas.nodeTypes.${node.data.kind}`) : t("canvas.noSelection")}
          </p>
          <h2 className="mt-1 text-base font-semibold">
            {node?.data.label ?? t("inspector.title")}
          </h2>
        </div>
        <span className="grid size-9 place-items-center rounded-xl bg-white/[0.06] text-white/48">
          <IconFileDescription className="size-4" />
        </span>
      </div>

      {node?.data.kind === "scene" && scene ? (
        <>
          <div className="mt-6">
            <span className="text-[10px] font-semibold text-white/42">{t("inspector.name")}</span>
            <p className="mt-2 rounded-xl bg-white/[0.045] px-3 py-3 text-xs text-white/72">
              {scene.title}
            </p>
          </div>
          <div className="mt-4">
            <span className="text-[10px] font-semibold text-white/42">
              {t("inspector.summary")}
            </span>
            <p className="mt-2 rounded-xl bg-white/[0.045] px-3 py-3 text-xs leading-5 text-white/58">
              {scene.summary}
            </p>
          </div>
        </>
      ) : null}

      {node?.data.kind === "choice" && scene && choice ? (
        <div className="mt-6">
          <span className="text-[10px] font-semibold text-white/42">
            {t("inspector.choiceLabel")}
          </span>
          <p className="mt-2 rounded-xl bg-white/[0.045] px-3 py-3 text-xs leading-5 text-white/68">
            {choice.label}
          </p>
          <span className="mt-2 flex items-center justify-between text-[10px] text-white/32">
            <span>{t("inspector.routeTarget")}</span>
            <span>{node.data.targetLabel}</span>
          </span>
        </div>
      ) : null}

      {node?.data.sequenceAssetIds?.length ? (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold">{t("inspector.sequence")}</h3>
            <span className="text-[10px] text-white/32">{node.data.sequenceAssetIds.length}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {node.data.sequenceAssetIds.map((assetId, index) => {
              const asset = assetsById.get(assetId);
              return (
                <button
                  key={assetId}
                  type="button"
                  onClick={() => onSelectAsset(assetId)}
                  className={cn(
                    "flex min-w-0 items-center gap-2 rounded-xl p-2 text-left transition",
                    selectedAssetId === assetId
                      ? "bg-white/[0.12]"
                      : "bg-white/[0.04] hover:bg-white/[0.08]"
                  )}
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-black/22 text-[9px] text-white/42">
                    {index + 1}
                  </span>
                  <span className="truncate text-[9px] text-white/52">{asset?.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {nodeAsset ? (
        <button
          type="button"
          onClick={() => onSelectAsset(nodeAsset.assetId)}
          className="mt-5 flex w-full items-center gap-3 rounded-xl bg-white/[0.05] p-3 text-left transition hover:bg-white/[0.09]"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-black/22 text-white/52">
            <IconMovie className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[9px] font-semibold tracking-[0.1em] text-white/30 uppercase">
              {node?.data.kind === "choice"
                ? t("inspector.reaction")
                : t("inspector.chapterMaster")}
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-white/58">
              {nodeAsset.label}
            </span>
          </span>
        </button>
      ) : null}

      {previewAsset ? (
        <div className="mt-4 overflow-hidden rounded-[18px] bg-black">
          {previewAsset.kind === "video" ? (
            <video
              key={previewAsset.url}
              src={previewAsset.url}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full"
            />
          ) : (
            <div className="p-4">
              <audio key={previewAsset.url} src={previewAsset.url} controls className="w-full" />
            </div>
          )}
        </div>
      ) : null}

      <div className="my-6 h-px bg-white/[0.06]" />
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">{t("validation.title")}</h3>
        <span className="inline-flex items-center gap-1 text-[10px] text-white/38">
          <IconSparkles className="size-3.5" />
          {t("validation.count", {
            passed: checks.filter((check) => check.passed).length,
            total: checks.length,
          })}
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        {checks.map((check) => (
          <div
            key={check.id}
            className="flex items-center gap-2 rounded-xl bg-white/[0.035] px-3 py-2"
          >
            <span
              className={cn(
                "grid size-5 place-items-center rounded-full",
                check.passed ? "bg-white/[0.1] text-white/70" : "bg-[#E52227]/16 text-[#ff8b8e]"
              )}
            >
              <IconCheck className="size-3" />
            </span>
            <span className="text-[10px] text-white/55">{t(`validation.checks.${check.id}`)}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function validateDraft(draft: InteractiveFilmCreatorDraft): ValidationCheck[] {
  const sceneIds = new Set(draft.scenes.map((scene) => scene.sceneId));
  const endingIds = new Set(draft.endings.map((ending) => ending.endingId));
  const allChoices = draft.scenes.flatMap((scene) => scene.choices);
  return [
    { id: "entry", passed: sceneIds.has(draft.entrySceneId) },
    {
      id: "masters",
      passed: draft.scenes.every((scene) => assetsById.has(scene.masterAssetId)),
    },
    {
      id: "sequences",
      passed: draft.scenes.every((scene) =>
        scene.sequenceAssetIds.every((assetId) => assetsById.has(assetId))
      ),
    },
    {
      id: "reactions",
      passed: allChoices.every((choice) => assetsById.has(choice.reactionAssetId)),
    },
    {
      id: "targets",
      passed: allChoices.every(
        (choice) =>
          (choice.targetSceneId ? sceneIds.has(choice.targetSceneId) : false) ||
          (choice.endingId ? endingIds.has(choice.endingId) : false)
      ),
    },
    {
      id: "endings",
      passed:
        draft.endings.length === 5 &&
        draft.endings.every((ending) => assetsById.has(ending.assetId)),
    },
    {
      id: "delivery",
      passed:
        draft.orientation === "landscape-only" &&
        JINLING_INTERACTIVE_FILM_ASSETS.every((asset) => asset.url.startsWith("https://")),
    },
  ];
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

export function InteractiveFilmCanvas() {
  return (
    <ReactFlowProvider>
      <InteractiveFilmCanvasInner />
    </ReactFlowProvider>
  );
}
