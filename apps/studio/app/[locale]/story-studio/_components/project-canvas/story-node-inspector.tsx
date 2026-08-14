"use client";

import { useState } from "react";
import { IconArrowRight, IconCheck, IconPlayerPlay, IconTrash, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { InteractiveStoryDraftContent, StoryGraphNode } from "@/lib/story-projects-api";
import type { StoryCanvasNode } from "./story-project-canvas-model";
import { StoryClipMediaPanel, type StoryClipMediaPanelProps } from "./story-clip-media-panel";
import {
  StoryFoundationLibrary,
  type StoryFoundationCoverMediaProps,
} from "./story-foundation-library";

type FoundationField = "logline" | "synopsis";
type StoryChapterTarget = {
  id: string;
  title: string;
  entryNodeId: string | null;
};

/**
 * What the creator asked a scene's next step to become. The inspector states the
 * intent; the canvas owns which mutation realizes it, because only the canvas
 * knows the surrounding draft and can mint a decision for a choice exit.
 */
export type SceneExitIntent = { kind: "auto"; nextNodeId: string | null } | { kind: "choice" };

type SceneExitKind = SceneExitIntent["kind"];

const SCENE_EXIT_KINDS: readonly SceneExitKind[] = ["auto", "choice"];

interface StoryNodeInspectorProps {
  content: InteractiveStoryDraftContent;
  selectedNode: StoryCanvasNode | null;
  showFoundation: boolean;
  canEdit: boolean;
  coverMedia: StoryFoundationCoverMediaProps;
  onUpdateFoundation: (field: FoundationField, value: string) => void;
  onCloseNode: () => void;
  chapterTargets?: StoryChapterTarget[];
  onConnectChapter?: (nodeId: string, targetNodeId: string, title: string) => void;
  onDeleteSelected: () => void;
  clipMedia?: StoryClipMediaPanelProps;
  onUpdateClipMeta: (nodeId: string, patch: { name?: string; description?: string }) => void;
  onSetSceneExit: (nodeId: string, intent: SceneExitIntent) => void;
  /**
   * Promotes a scene to the entry of the chapter being edited. Scoped, not
   * global: the server stores an entry per chapter and only mirrors the first
   * chapter's onto the story, so this is deliberately worded per chapter.
   */
  onSetEntryNode: (nodeId: string) => void;
}

export function StoryNodeInspector({
  content,
  selectedNode,
  showFoundation,
  canEdit,
  coverMedia,
  onUpdateFoundation,
  onCloseNode,
  chapterTargets = [],
  onConnectChapter = () => undefined,
  onDeleteSelected,
  clipMedia,
  onUpdateClipMeta,
  onSetSceneExit,
  onSetEntryNode,
}: StoryNodeInspectorProps) {
  const t = useTranslations("storyStudio.canvas");
  const canvasData = selectedNode?.data;
  const canonicalNodeId =
    canvasData?.kind === "decision" ? canvasData.sourceNodeId : canvasData?.nodeId;
  const graphNode =
    content.graph.nodes.find((candidate) => candidate.nodeId === canonicalNodeId) ?? null;

  if (
    !showFoundation &&
    (!canvasData || canvasData.kind === "decision" || canvasData.kind === "character")
  )
    return null;

  return (
    <aside className="absolute top-16 bottom-3 left-3 z-30 flex w-[368px] flex-col overflow-hidden rounded-[24px] bg-[oklch(0.205_0_0/0.72)] shadow-[18px_0_60px_rgba(0,0,0,0.32)] backdrop-blur-[60px] backdrop-saturate-150">
      <div className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]" />
      {showFoundation ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <StoryFoundationLibrary
            content={content}
            canEdit={canEdit}
            coverMedia={coverMedia}
            onUpdateFoundation={onUpdateFoundation}
            onClose={onCloseNode}
          />
        </div>
      ) : canvasData ? (
        <>
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-5 pb-1">
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

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {graphNode ? (
              <GraphNodeEditor
                content={content}
                node={graphNode}
                canEdit={canEdit}
                clipMedia={clipMedia}
                onUpdateClipMeta={onUpdateClipMeta}
                chapterTargets={chapterTargets}
                onConnectChapter={onConnectChapter}
                onSetSceneExit={onSetSceneExit}
                onSetEntryNode={onSetEntryNode}
              />
            ) : null}
          </div>

          <div className="shrink-0 grid gap-2 border-t border-white/[0.06] px-5 py-4">
            <Button
              type="button"
              variant="destructive"
              disabled={!canEdit}
              onClick={onDeleteSelected}
              className="w-full"
            >
              <IconTrash className="size-4" />
              {t(canvasData.kind === "decision" ? "inspector.removeDecision" : "inspector.delete")}
            </Button>
          </div>
        </>
      ) : null}
    </aside>
  );
}

function GraphNodeEditor({
  content,
  node,
  canEdit,
  clipMedia,
  onUpdateClipMeta,
  chapterTargets,
  onConnectChapter,
  onSetSceneExit,
  onSetEntryNode,
}: {
  content: InteractiveStoryDraftContent;
  node: StoryGraphNode;
  canEdit: boolean;
  clipMedia?: StoryClipMediaPanelProps;
  onUpdateClipMeta: StoryNodeInspectorProps["onUpdateClipMeta"];
  chapterTargets: StoryChapterTarget[];
  onConnectChapter: NonNullable<StoryNodeInspectorProps["onConnectChapter"]>;
  onSetSceneExit: StoryNodeInspectorProps["onSetSceneExit"];
  onSetEntryNode: StoryNodeInspectorProps["onSetEntryNode"];
}) {
  const t = useTranslations("storyStudio.canvas");
  const isEntry = content.graph.entryNodeId === node.nodeId;
  return (
    <>
      {/*
        The chapter's entry used to be reachable only by dragging off the story
        project foundation. It does not belong to a chapter
        anyway — the entry does.
      */}
      <button
        type="button"
        aria-current={isEntry ? "true" : undefined}
        disabled={!canEdit || isEntry}
        onClick={() => onSetEntryNode(node.nodeId)}
        className={cn(
          "mt-6 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[10px] transition",
          isEntry
            ? "bg-[#8f65ff]/[0.16] text-white disabled:opacity-100"
            : "bg-white/[0.045] text-white/58 hover:bg-white/[0.09] hover:text-white disabled:opacity-55"
        )}
      >
        <IconPlayerPlay className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">{t("inspector.entry")}</span>
        {isEntry ? <IconCheck className="size-3.5 shrink-0" /> : null}
      </button>

      <label className="mt-4 block" htmlFor="story-clip-name">
        <span className="text-[9px] font-semibold text-white/32">{t("inspector.nodeName")}</span>
        <Input
          id="story-clip-name"
          value={node.name ?? ""}
          disabled={!canEdit}
          maxLength={120}
          placeholder={node.clipKey}
          onChange={(event) => onUpdateClipMeta(node.nodeId, { name: event.target.value })}
          className="mt-1.5 h-9! rounded-lg bg-white/[0.05] px-3 text-xs"
        />
      </label>

      {clipMedia ? (
        <StoryClipMediaPanel key={clipMedia.clip?.graphNodeId ?? node.nodeId} {...clipMedia} />
      ) : null}

      <SceneExitEditor
        content={content}
        node={node}
        canEdit={canEdit}
        onSetSceneExit={onSetSceneExit}
      />

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
function SceneExitEditor({
  content,
  node,
  canEdit,
  onSetSceneExit,
}: {
  content: InteractiveStoryDraftContent;
  node: StoryGraphNode;
  canEdit: boolean;
  onSetSceneExit: StoryNodeInspectorProps["onSetSceneExit"];
}) {
  const t = useTranslations("storyStudio.canvas");
  const [pendingKind, setPendingKind] = useState<SceneExitKind | null>(null);

  const currentKind = node.exit.kind;
  const currentTarget = node.exit.kind === "auto" ? node.exit.nextNodeId : null;
  // Replacing a choice throws away every authored option and its branch link, so
  // that conversion — and only that one — asks first.
  const branchCount = node.exit.kind === "choice" ? node.exit.choices.length : 0;

  const targets = content.graph.nodes.filter((candidate) => candidate.nodeId !== node.nodeId);

  const intentFor = (kind: SceneExitKind): SceneExitIntent | null => {
    if (kind === "auto") return { kind: "auto", nextNodeId: currentTarget };
    if (kind === "choice") return { kind: "choice" };
    return null;
  };

  const commitKind = (kind: SceneExitKind) => {
    setPendingKind(null);
    const intent = intentFor(kind);
    if (intent) onSetSceneExit(node.nodeId, intent);
  };

  const requestKind = (kind: SceneExitKind) => {
    if (kind === currentKind) return;
    if (branchCount > 0) {
      setPendingKind(kind);
      return;
    }
    commitKind(kind);
  };

  return (
    <section className="mt-6 rounded-[18px] bg-white/[0.04] p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-[10px] bg-white/[0.07] text-white/62">
          <IconArrowRight className="size-3.5" />
        </span>
        <h3 className="text-xs font-semibold text-white/78">{t("inspector.exit")}</h3>
      </div>

      <div
        className="mt-3 grid grid-cols-3 gap-1.5"
        role="radiogroup"
        aria-label={t("inspector.exit")}
      >
        {SCENE_EXIT_KINDS.map((kind) => {
          const active = kind === currentKind;
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!canEdit}
              onClick={() => requestKind(kind)}
              className={cn(
                "rounded-xl px-3 py-2 text-[10px] transition disabled:cursor-default disabled:opacity-40",
                active
                  ? "bg-white/[0.14] text-white"
                  : "bg-white/[0.045] text-white/58 hover:bg-white/[0.09] hover:text-white"
              )}
            >
              {t(`inspector.exit${kind === "auto" ? "Auto" : "Choice"}`)}
            </button>
          );
        })}
      </div>

      {pendingKind ? (
        <div className="mt-3 rounded-xl bg-[#e0a45c]/[0.12] p-3">
          <p className="text-[10px] font-semibold text-[#e0a45c]">
            {t("inspector.convertExitTitle")}
          </p>
          <p className="mt-1 text-[9px] leading-4 text-white/58">
            {t("inspector.convertExitDescription", { count: branchCount })}
          </p>
          <div className="mt-2.5 flex gap-1.5">
            <Button
              type="button"
              variant="destructive"
              className="h-8 flex-1 text-[10px]"
              onClick={() => commitKind(pendingKind)}
            >
              {t("inspector.confirmConversion")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 flex-1 text-[10px]"
              onClick={() => setPendingKind(null)}
            >
              {t("inspector.cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {currentKind === "auto" ? (
        <label className="mt-3 block">
          <span className="text-[9px] font-semibold text-white/32">
            {t("inspector.continuationTarget")}
          </span>
          <Select
            value={currentTarget ?? ""}
            disabled={!canEdit || targets.length === 0}
            onValueChange={(nextNodeId) =>
              onSetSceneExit(node.nodeId, { kind: "auto", nextNodeId })
            }
          >
            <SelectTrigger className="mt-1.5 w-full" aria-label={t("inspector.continuationTarget")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {targets.map((candidate) => (
                <SelectItem key={candidate.nodeId} value={candidate.nodeId}>
                  {sceneLabel(candidate)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {currentTarget ? null : (
            <span className={cn("mt-1.5 block text-[9px]", "text-white/38")}>
              {t("inspector.terminalAfterPlayback")}
            </span>
          )}
        </label>
      ) : null}

      <p className="mt-2.5 text-[9px] leading-4 text-white/34">
        {t("inspector.continuationDescription")}
      </p>
    </section>
  );
}

function sceneLabel(node: StoryGraphNode): string {
  return node.name?.trim() || node.clipKey;
}

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
      ? node.exit.nextNodeId
        ? [node.exit.nextNodeId]
        : []
      : node.exit.choices.map((choice) => choice.nextNodeId)
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
