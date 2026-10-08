"use client";

import { STORY_AUTHORING_DESCRIPTION_MAX } from "@repo/shared/story-production";

import { IconArrowRight, IconFlag, IconFocusCentered, IconTrash, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type {
  InteractiveStoryDraftContent,
  StoryClipGraphNode,
  StoryGraphNode,
  StoryBibleEnding,
} from "@/lib/story-projects-api";
import type { StoryCanvasNode } from "./story-project-canvas-model";
import {
  storyAutoFallbackNodeId,
  type StoryExitRoute,
  type StoryStateEffect,
  storyRouteNodeId,
} from "@repo/shared/story-stats";
import { StoryNodeStoryboardPanel } from "./story-node-storyboard-panel";
import { StoryCanvasTextInput } from "./story-canvas-text-input";
import { StorySourceReviewNotes } from "../story-source-review-notes";
import { endingsInUse } from "./story-project-canvas-mutations";
import {
  StoryAutoRoutesEditor,
  StoryEffectsEditor,
  storyGraphNodePickerItems,
  storyGraphNodePickerTitles,
} from "./story-stats-editors";

type StoryChapterTarget = {
  id: string;
  title: string;
  entryNodeId: string | null;
};

/**
 * The docked editor for the selected scene: its name, description, storyboard,
 * and the actions that need the canvas's draft (interactions, chapter links,
 * delete), which it raises to the canvas rather than authoring itself.
 */
interface StoryNodeInspectorProps {
  projectId: string;
  content: InteractiveStoryDraftContent;
  selectedNode: StoryCanvasNode | null;
  canEdit: boolean;
  onCloseNode: () => void;
  chapterTargets?: StoryChapterTarget[];
  onConnectChapter?: (nodeId: string, targetNodeId: string, title: string) => void;
  onDeleteSelected: () => void;
  onUpdateClipMeta: (nodeId: string, patch: { name?: string; description?: string }) => void;
  onSetChapterStart: (nodeId: string) => void;
  onEditInteractions: (nodeId: string) => void;
  locale: string;
  onSetOnEnterEffects: (nodeId: string, effects: StoryStateEffect[] | null) => void;
  onSetAutoRoutes: (nodeId: string, routes: StoryExitRoute[]) => void;
  onCreateEndingForRoute: (nodeId: string, routeIndex: number) => void;
  onUpdateEnding: (endingId: string, patch: Pick<StoryBibleEnding, "title">) => void;
  onDeleteEnding: (endingId: string) => void;
}
export function StoryNodeInspector({
  projectId,
  content,
  selectedNode,
  canEdit,
  onCloseNode,
  chapterTargets = [],
  onConnectChapter = () => undefined,
  onDeleteSelected,
  onUpdateClipMeta,
  onSetChapterStart,
  onEditInteractions,
  locale,
  onSetOnEnterEffects,
  onSetAutoRoutes,
  onCreateEndingForRoute,
  onUpdateEnding,
  onDeleteEnding,
}: StoryNodeInspectorProps) {
  const t = useTranslations("storyStudio.canvas");
  const canvasData = selectedNode?.data;
  const canonicalNodeId = canvasData?.nodeId;
  const graphNode =
    content.graph.nodes.find((candidate) => candidate.nodeId === canonicalNodeId) ?? null;

  const editableGraphNode = graphNode?.kind === "clip" ? graphNode : null;

  if (!graphNode || !canvasData) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-5 pb-1">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-white/34 uppercase">
            {t("inspector.eyebrow")}
          </p>
          <h2 className="mt-1 truncate text-base font-semibold">{canvasData.title}</h2>
          <p className="mt-1 text-[10px] text-white/34">{t(`nodeKinds.${canvasData.kind}`)}</p>
        </div>
        <button
          type="button"
          onClick={onCloseNode}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/48 transition hover:bg-white/[0.1] hover:text-white"
          aria-label={t("inspector.close")}
        >
          <IconX className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
        <StorySourceReviewNotes notes={content.productionNotes} />
        {editableGraphNode ? (
          <GraphNodeEditor
            projectId={projectId}
            node={editableGraphNode}
            canEdit={canEdit}
            chapterStart={canvasData.chapterStart === true}
            onSetChapterStart={() => onSetChapterStart(graphNode.nodeId)}
            onUpdateClipMeta={onUpdateClipMeta}
            chapterTargets={chapterTargets}
            onConnectChapter={onConnectChapter}
            onEditInteractions={onEditInteractions}
            content={content}
            locale={locale}
            onSetOnEnterEffects={onSetOnEnterEffects}
            onSetAutoRoutes={onSetAutoRoutes}
            onCreateEndingForRoute={onCreateEndingForRoute}
            onUpdateEnding={onUpdateEnding}
            onDeleteEnding={onDeleteEnding}
          />
        ) : (
          <ChapterStartControl
            active={canvasData.chapterStart === true}
            canEdit={canEdit}
            onSet={() => onSetChapterStart(graphNode.nodeId)}
          />
        )}
      </div>

      <div className="shrink-0 grid gap-2 border-t border-white/[0.06] px-4 py-4">
        <Button
          type="button"
          variant="destructive"
          disabled={!canEdit}
          onClick={onDeleteSelected}
          className="w-full"
        >
          <IconTrash className="size-4" />
          {t("inspector.delete")}
        </Button>
      </div>
    </div>
  );
}

function ChapterStartControl({
  active,
  canEdit,
  onSet,
}: {
  active: boolean;
  canEdit: boolean;
  onSet: () => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  const body = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#8f65ff]/10 text-[#8f65ff]">
        <IconFlag className="size-4" stroke={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={
            active
              ? "block text-[11px] font-semibold text-[#8f65ff]"
              : "block text-[11px] font-semibold text-white/82"
          }
        >
          {t(active ? "chapterStart.current" : "chapterStart.set")}
        </span>
        <span className="mt-0.5 block text-[9px] leading-4 text-white/34">
          {t("chapterStart.hint")}
        </span>
      </span>
    </>
  );
  if (active) {
    return (
      <div className="mt-4 flex w-full items-center gap-3 rounded-[18px] bg-white/[0.045] p-3">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={onSet}
      className="group mt-4 flex w-full items-center gap-3 rounded-[18px] bg-white/[0.045] p-3 text-left transition hover:bg-white/[0.075] disabled:pointer-events-none disabled:opacity-40"
    >
      {body}
      <IconArrowRight className="size-4 shrink-0 text-white/22 transition group-hover:translate-x-0.5 group-hover:text-white/48" />
    </button>
  );
}

function GraphNodeEditor({
  projectId,
  node,
  canEdit,
  chapterStart,
  onSetChapterStart,
  onUpdateClipMeta,
  chapterTargets,
  onConnectChapter,
  onEditInteractions,
  content,
  locale,
  onSetOnEnterEffects,
  onSetAutoRoutes,
  onCreateEndingForRoute,
  onUpdateEnding,
  onDeleteEnding,
}: {
  projectId: string;
  node: StoryClipGraphNode;
  canEdit: boolean;
  chapterStart: boolean;
  onSetChapterStart: () => void;
  onUpdateClipMeta: StoryNodeInspectorProps["onUpdateClipMeta"];
  chapterTargets: StoryChapterTarget[];
  onConnectChapter: NonNullable<StoryNodeInspectorProps["onConnectChapter"]>;
  onEditInteractions: NonNullable<StoryNodeInspectorProps["onEditInteractions"]>;
  content: InteractiveStoryDraftContent;
  locale: string;
  onSetOnEnterEffects: StoryNodeInspectorProps["onSetOnEnterEffects"];
  onSetAutoRoutes: StoryNodeInspectorProps["onSetAutoRoutes"];
  onCreateEndingForRoute: StoryNodeInspectorProps["onCreateEndingForRoute"];
  onUpdateEnding: StoryNodeInspectorProps["onUpdateEnding"];
  onDeleteEnding: StoryNodeInspectorProps["onDeleteEnding"];
}) {
  const t = useTranslations("storyStudio.canvas");
  const tStats = useTranslations("storyStudio.canvas.stats");
  const variables = content.storyBible.stateVariables ?? [];
  const endings = endingsInUse(content);
  const nodeTitles = storyGraphNodePickerTitles(
    content.graph.nodes,
    t("nodeKinds.clip"),
    t("nodeKinds.decision")
  );
  return (
    <>
      <label className="mt-6 block">
        <span className="text-[9px] font-semibold text-white/32">{t("inspector.nodeName")}</span>
        <StoryCanvasTextInput
          key={node.nodeId}
          value={node.name ?? ""}
          disabled={!canEdit}
          maxLength={120}
          aria-label={t("inspector.nodeName")}
          placeholder={node.clipKey}
          onValueChange={(name) => onUpdateClipMeta(node.nodeId, { name })}
          className="mt-1.5 h-9! w-full rounded-lg bg-white/[0.05] px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-xs font-medium text-muted-foreground">
          {t("inspector.nodeDescription")}
        </span>
        <StoryCanvasTextInput
          key={node.nodeId}
          multiline
          value={node.description ?? ""}
          disabled={!canEdit}
          maxLength={STORY_AUTHORING_DESCRIPTION_MAX}
          aria-label={t("inspector.nodeDescription")}
          placeholder={t("inspector.nodeDescriptionPlaceholder")}
          onValueChange={(description) => onUpdateClipMeta(node.nodeId, { description })}
          className="mt-1.5 min-h-36 w-full resize-y rounded-lg bg-input/30 px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>

      <StoryNodeStoryboardPanel projectId={projectId} nodeId={node.nodeId} canEdit={canEdit} />

      <ChapterStartControl active={chapterStart} canEdit={canEdit} onSet={onSetChapterStart} />

      <button
        type="button"
        disabled={!canEdit}
        onClick={() => onEditInteractions(node.nodeId)}
        className="group mt-4 flex w-full items-center gap-3 rounded-[18px] bg-white/[0.045] p-3 text-left transition hover:bg-white/[0.075] disabled:pointer-events-none disabled:opacity-40"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-blue/10 text-brand-blue transition group-hover:bg-brand-blue/15 group-hover:text-brand-blue">
          <IconFocusCentered className="size-4" stroke={1.7} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold text-white/82">
            {t("interactionEditor.entryTitle")}
          </span>
          <span className="mt-0.5 block text-[9px] leading-4 text-white/34">
            {t("interactionEditor.entryDescription")}
          </span>
        </span>
        <IconArrowRight className="size-4 shrink-0 text-white/22 transition group-hover:translate-x-0.5 group-hover:text-white/48" />
      </button>

      {variables.length > 0 || (node.onEnterEffects?.length ?? 0) > 0 ? (
        <section className="mt-6 rounded-[18px] bg-white/[0.04] p-3">
          <h3 className="text-xs font-semibold text-white/78">{tStats("onEnterTitle")}</h3>
          <p className="mt-0.5 text-xs leading-4 text-white/48">{tStats("onEnterHint")}</p>
          <div className="mt-3">
            <StoryEffectsEditor
              effects={node.onEnterEffects ?? []}
              variables={variables}
              canEdit={canEdit}
              onChange={(effects) => onSetOnEnterEffects(node.nodeId, effects)}
            />
          </div>
        </section>
      ) : null}

      {node.exit.kind === "auto" ? (
        <section className="mt-6 rounded-[18px] bg-white/[0.04] p-3">
          <h3 className="text-xs font-semibold text-white/78">{tStats("routesTitle")}</h3>
          <div className="mt-3">
            <StoryAutoRoutesEditor
              routes={node.exit.routes}
              variables={variables}
              endings={endings}
              nodes={storyGraphNodePickerItems(content.graph.nodes, node.nodeId, nodeTitles)}
              locale={locale}
              canEdit={canEdit}
              onChange={(routes) => onSetAutoRoutes(node.nodeId, routes)}
              onCreateEnding={(routeIndex) => onCreateEndingForRoute(node.nodeId, routeIndex)}
              onUpdateEnding={onUpdateEnding}
              onDeleteEnding={onDeleteEnding}
            />
          </div>
        </section>
      ) : null}

      <ChapterDestinationEditor
        node={node}
        targets={chapterTargets}
        canEdit={canEdit}
        onConnect={onConnectChapter}
      />
    </>
  );
}

/**
 * The one place a scene's next step can be re-shaped without drawing edges.
 *
 * The canvas can express every exit by dragging, but only awkwardly: `choice`
 * demands a drag onto blank canvas, so an existing continuation must be deleted
 * first. Re-shaping a scene's next step should not depend on remembering that.
 */
function ChapterDestinationEditor({
  node,
  targets,
  canEdit,
  onConnect,
}: {
  node: StoryGraphNode;
  targets: StoryChapterTarget[];
  canEdit: boolean;
  onConnect: NonNullable<StoryNodeInspectorProps["onConnectChapter"]>;
}) {
  const t = useTranslations("storyStudio.canvas");
  if (targets.length === 0 || (node.exit.kind !== "auto" && node.exit.kind !== "choice")) {
    return null;
  }
  const linkedTargets = new Set(
    node.exit.kind === "auto"
      ? storyAutoFallbackNodeId(node.exit)
        ? [storyAutoFallbackNodeId(node.exit)]
        : []
      : node.exit.choices.map((choice) => storyRouteNodeId(choice.target))
  );
  const choiceLimitReached = node.exit.kind === "choice" && node.exit.choices.length >= 6;

  return (
    <section className="mt-6 rounded-[18px] bg-white/[0.04] p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-[10px] bg-white/[0.07] text-white/62">
          <IconArrowRight className="size-3.5" />
        </span>
        <div>
          <h3 className="text-xs font-semibold text-white/78">
            {t("inspector.chapterTransitions.title")}
          </h3>
          <p className="mt-0.5 text-[9px] leading-4 text-white/34">
            {t(
              node.exit.kind === "choice"
                ? "inspector.chapterTransitions.choiceHint"
                : "inspector.chapterTransitions.continueHint"
            )}
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {targets.map((chapter) => {
          const targetNodeId = chapter.entryNodeId;
          if (!targetNodeId) return null;
          const linked = linkedTargets.has(targetNodeId);
          return (
            <button
              key={chapter.id}
              type="button"
              disabled={!canEdit || linked || choiceLimitReached}
              onClick={() => onConnect(node.nodeId, targetNodeId, chapter.title)}
              className="flex w-full items-center gap-2 rounded-xl bg-white/[0.045] px-3 py-2 text-left text-[10px] text-white/58 transition hover:bg-white/[0.09] hover:text-white disabled:cursor-default disabled:opacity-55"
            >
              <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
              <span className="shrink-0 text-[9px] text-white/32">
                {linked
                  ? t("inspector.chapterTransitions.linked")
                  : t("inspector.chapterTransitions.connect")}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
