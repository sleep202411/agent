"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  IconArrowRight,
  IconCheck,
  IconPlayerPlay,
  IconUpload,
  IconPlayerStop,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import type {
  CreatableStoryFormat,
  InteractiveStoryDraftContent,
  StoryGraphNode,
  StoryNodeMusic,
} from "@/lib/story-projects-api";
import type { StoryCanvasNode } from "./story-project-canvas-model";
import { collectStoryMusicTracks, StoryNodeMusicPanel } from "./story-node-music-panel";
import { StoryClipMediaPanel, type StoryClipMediaPanelProps } from "./story-clip-media-panel";
import { StoryWorldLibrary, type StoryWorldCoverMediaProps } from "./story-world-library";

type FoundationField = "logline" | "synopsis" | "worldview";
type Ending = InteractiveStoryDraftContent["storyBible"]["endings"][number];
type Character = InteractiveStoryDraftContent["storyBible"]["characters"][number];
type StoryChapterTarget = {
  id: string;
  title: string;
  entryNodeId: string | null;
};

/**
 * What the creator asked a scene's next step to become. The inspector states the
 * intent; the canvas owns which mutation realizes it, because only the canvas
 * knows the surrounding draft (a choice mints a decision, an ending has to name
 * one).
 */
export type SceneExitIntent =
  | { kind: "auto"; nextNodeId: string | null }
  | { kind: "choice" }
  | { kind: "ending"; endingId: string };

type SceneExitKind = SceneExitIntent["kind"];

const SCENE_EXIT_KINDS: readonly SceneExitKind[] = ["auto", "choice", "ending"];

interface StoryNodeInspectorProps {
  content: InteractiveStoryDraftContent;
  /** Decides which authoring surfaces this project's runtime can actually use. */
  format: CreatableStoryFormat;
  locale: string;
  selectedNode: StoryCanvasNode | null;
  showFoundation: boolean;
  canEdit: boolean;
  coverMedia: StoryWorldCoverMediaProps;
  onUpdateFoundation: (field: FoundationField, value: string) => void;
  onUpdateCharacter: (characterId: string, patch: Partial<Omit<Character, "id">>) => void;
  onDeleteCharacter: (characterId: string) => void;
  onCloseNode: () => void;
  chapterTargets?: StoryChapterTarget[];
  onConnectChapter?: (nodeId: string, targetNodeId: string, title: string) => void;
  onUpdateEnding: (endingId: string, patch: Partial<Ending>) => void;
  onDeleteSelected: () => void;
  clipMedia?: StoryClipMediaPanelProps;
  onUpdateClipMeta: (nodeId: string, patch: { name?: string; description?: string }) => void;
  onUpdateText: (nodeId: string, patch: { title?: string; body?: string }) => void;
  /** Ownership scope for a track uploaded from the inspector. */
  workspaceId: string | null;
  onUpdateMusic: (nodeId: string, music: StoryNodeMusic | null) => void;
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
  format,
  locale,
  selectedNode,
  showFoundation,
  canEdit,
  coverMedia,
  onUpdateFoundation,
  onUpdateCharacter,
  onDeleteCharacter,
  onCloseNode,
  chapterTargets = [],
  onConnectChapter = () => undefined,
  onUpdateEnding,
  onDeleteSelected,
  clipMedia,
  onUpdateClipMeta,
  onUpdateText,
  workspaceId,
  onUpdateMusic,
  onSetSceneExit,
  onSetEntryNode,
}: StoryNodeInspectorProps) {
  const t = useTranslations("storyStudio.canvas");
  const canvasData = selectedNode?.data;
  const canonicalNodeId =
    canvasData?.kind === "decision" ? canvasData.sourceNodeId : canvasData?.nodeId;
  const graphNode =
    content.graph.nodes.find((candidate) => candidate.nodeId === canonicalNodeId) ?? null;
  const ending = canvasData?.endingId
    ? (content.storyBible.endings.find((candidate) => candidate.id === canvasData.endingId) ?? null)
    : null;
  const inspectedCharacter =
    canvasData?.kind === "character" && canvasData.characterId
      ? (content.storyBible.characters.find(
          (candidate) => candidate.id === canvasData.characterId
        ) ?? null)
      : null;

  if (!showFoundation && (!canvasData || canvasData.kind === "decision")) return null;

  return (
    <aside className="absolute top-16 bottom-3 left-3 z-30 flex w-[368px] flex-col overflow-hidden rounded-[24px] bg-[oklch(0.205_0_0/0.72)] shadow-[18px_0_60px_rgba(0,0,0,0.32)] backdrop-blur-[60px] backdrop-saturate-150">
      <div className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]" />
      {showFoundation ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <StoryWorldLibrary
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
              <h2 className="mt-1 truncate text-base font-semibold">
                {canvasData.kind === "character"
                  ? canvasData.title || t("world.characters.cardUntitled")
                  : canvasData.title}
              </h2>
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
            {canvasData.kind === "character" && canvasData.characterId ? (
              <CharacterNodeEditor
                content={content}
                locale={locale}
                characterId={canvasData.characterId}
                canEdit={canEdit}
                onUpdate={onUpdateCharacter}
              />
            ) : null}

            {graphNode ? (
              <GraphNodeEditor
                content={content}
                format={format}
                locale={locale}
                node={graphNode}
                canEdit={canEdit}
                clipMedia={clipMedia}
                workspaceId={workspaceId}
                onUpdateClipMeta={onUpdateClipMeta}
                onUpdateText={onUpdateText}
                onUpdateMusic={onUpdateMusic}
                chapterTargets={chapterTargets}
                onConnectChapter={onConnectChapter}
                onSetSceneExit={onSetSceneExit}
                onSetEntryNode={onSetEntryNode}
              />
            ) : null}

            {ending ? (
              <EndingEditor
                ending={ending}
                locale={locale}
                canEdit={canEdit}
                onUpdate={(patch) => onUpdateEnding(ending.id, patch)}
              />
            ) : null}
          </div>

          {canvasData.kind === "character" && inspectedCharacter ? (
            <div className="shrink-0 border-t border-white/[0.06] px-5 py-4">
              <Button
                type="button"
                variant="destructive"
                disabled={!canEdit}
                onClick={() => onDeleteCharacter(inspectedCharacter.id)}
                className="w-full"
              >
                <IconTrash className="size-4" />
                {t("world.characters.delete")}
              </Button>
              <p className="mt-2 text-[9px] leading-4 text-white/30">
                {t("world.characters.deleteAvailable")}
              </p>
            </div>
          ) : null}

          {canvasData.kind !== "character" ? (
            <div className="shrink-0 grid gap-2 border-t border-white/[0.06] px-5 py-4">
              <Button
                type="button"
                variant="destructive"
                disabled={!canEdit}
                onClick={onDeleteSelected}
                className="w-full"
              >
                <IconTrash className="size-4" />
                {t(
                  ending
                    ? "inspector.deleteEnding"
                    : canvasData.kind === "decision"
                      ? "inspector.removeDecision"
                      : "inspector.delete"
                )}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </aside>
  );
}

function GraphNodeEditor({
  content,
  format,
  locale,
  node,
  canEdit,
  clipMedia,
  workspaceId,
  onUpdateClipMeta,
  onUpdateText,
  onUpdateMusic,
  chapterTargets,
  onConnectChapter,
  onSetSceneExit,
  onSetEntryNode,
}: {
  content: InteractiveStoryDraftContent;
  format: StoryNodeInspectorProps["format"];
  locale: string;
  node: StoryGraphNode;
  canEdit: boolean;
  clipMedia?: StoryClipMediaPanelProps;
  workspaceId: StoryNodeInspectorProps["workspaceId"];
  onUpdateClipMeta: StoryNodeInspectorProps["onUpdateClipMeta"];
  onUpdateText: StoryNodeInspectorProps["onUpdateText"];
  onUpdateMusic: StoryNodeInspectorProps["onUpdateMusic"];
  chapterTargets: StoryChapterTarget[];
  onConnectChapter: NonNullable<StoryNodeInspectorProps["onConnectChapter"]>;
  onSetSceneExit: StoryNodeInspectorProps["onSetSceneExit"];
  onSetEntryNode: StoryNodeInspectorProps["onSetEntryNode"];
}) {
  const t = useTranslations("storyStudio.canvas");
  // Only the narrative runtime reads a scene's bed — the cinematic player never
  // does, and the Build compiler drops music for that format. Offering the panel
  // there would let a creator upload a 50 MB bed, bind it, publish, and get
  // silence with nothing to explain it.
  const playsMusic = format !== "interactive_film";
  const musicTracks = collectStoryMusicTracks(content.graph.nodes, (letter) =>
    t("inspector.music.trackLabel", { letter })
  );
  const isEntry = content.graph.entryNodeId === node.nodeId;
  return (
    <>
      {/*
        The chapter's entry used to be reachable only by dragging off the story
        world card. That card is going away, and it never belonged to a chapter
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

      {node.kind === "clip" ? (
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
      ) : null}

      {node.kind === "text" ? (
        <div className="mt-6 space-y-4">
          <label className="block" htmlFor="story-text-title">
            <span className="text-[9px] font-semibold text-white/32">
              {t("inspector.textTitle")}
            </span>
            <Input
              id="story-text-title"
              value={localizedValue(node.title, locale)}
              disabled={!canEdit}
              maxLength={4_000}
              placeholder={t("inspector.textTitlePlaceholder")}
              onChange={(event) => onUpdateText(node.nodeId, { title: event.target.value })}
              className="mt-1.5 h-9! rounded-lg bg-white/[0.05] px-3 text-xs"
            />
          </label>
          <label className="block" htmlFor="story-text-body">
            <span className="text-[9px] font-semibold text-white/32">
              {t("inspector.textBody")}
            </span>
            <Textarea
              id="story-text-body"
              value={localizedValue(node.body, locale)}
              disabled={!canEdit}
              maxLength={20_000}
              rows={10}
              placeholder={t("inspector.textBodyPlaceholder")}
              onChange={(event) => onUpdateText(node.nodeId, { body: event.target.value })}
              className="mt-1.5 resize-y rounded-lg bg-white/[0.05] px-3 text-xs leading-5"
            />
            {!localizedValue(node.body, locale).trim() ? (
              <span className="mt-1.5 block text-[9px] text-[#e0a45c]/82">
                {t("inspector.requiredForPlayableStory")}
              </span>
            ) : null}
          </label>
        </div>
      ) : null}

      {node.kind === "clip" && clipMedia ? (
        <StoryClipMediaPanel key={clipMedia.clip?.graphNodeId ?? node.nodeId} {...clipMedia} />
      ) : null}

      {playsMusic ? (
        <StoryNodeMusicPanel
          key={node.nodeId}
          music={node.music ?? null}
          tracks={musicTracks}
          canEdit={canEdit}
          workspaceId={workspaceId}
          onChange={(music) => onUpdateMusic(node.nodeId, music)}
        />
      ) : null}

      <SceneExitEditor
        content={content}
        node={node}
        locale={locale}
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
  locale,
  canEdit,
  onSetSceneExit,
}: {
  content: InteractiveStoryDraftContent;
  node: StoryGraphNode;
  locale: string;
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
  const endings = content.storyBible.endings;

  const intentFor = (kind: SceneExitKind): SceneExitIntent | null => {
    if (kind === "auto") return { kind: "auto", nextNodeId: currentTarget };
    if (kind === "choice") return { kind: "choice" };
    const endingId = node.exit.kind === "ending" ? node.exit.endingId : endings[0]?.id;
    return endingId ? { kind: "ending", endingId } : null;
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

  const kindDisabled = (kind: SceneExitKind) =>
    !canEdit || (kind === "ending" && endings.length === 0);

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
              disabled={kindDisabled(kind)}
              onClick={() => requestKind(kind)}
              className={cn(
                "rounded-xl px-3 py-2 text-[10px] transition disabled:cursor-default disabled:opacity-40",
                active
                  ? "bg-white/[0.14] text-white"
                  : "bg-white/[0.045] text-white/58 hover:bg-white/[0.09] hover:text-white"
              )}
            >
              {t(
                `inspector.exit${kind === "auto" ? "Auto" : kind === "choice" ? "Choice" : "Ending"}`
              )}
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
                  {sceneLabel(candidate, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {currentTarget ? null : (
            <span className="mt-1.5 block text-[9px] text-[#e0a45c]/82">
              {t("inspector.requiredForPlayableStory")}
            </span>
          )}
        </label>
      ) : null}

      {currentKind === "ending" ? (
        <label className="mt-3 block">
          <span className="text-[9px] font-semibold text-white/32">
            {t("inspector.endingTarget")}
          </span>
          <Select
            value={node.exit.kind === "ending" ? node.exit.endingId : ""}
            disabled={!canEdit || endings.length === 0}
            onValueChange={(endingId) => onSetSceneExit(node.nodeId, { kind: "ending", endingId })}
          >
            <SelectTrigger className="mt-1.5 w-full" aria-label={t("inspector.endingTarget")}>
              <SelectValue placeholder={t("inspector.endingTargetPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {endings.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {localizedValue(candidate.title, locale) || candidate.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}

      <p className="mt-2.5 text-[9px] leading-4 text-white/34">
        {t("inspector.continuationDescription")}
      </p>
    </section>
  );
}

function sceneLabel(node: StoryGraphNode, locale: string): string {
  if (node.kind === "clip") return node.name?.trim() || node.clipKey;
  return localizedValue(node.title, locale).trim() || node.nodeId;
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

function EndingEditor({
  ending,
  locale,
  canEdit,
  onUpdate,
}: {
  ending: Ending;
  locale: string;
  canEdit: boolean;
  onUpdate: (patch: Partial<Ending>) => void;
}) {
  const t = useTranslations("storyStudio.canvas");
  return (
    <div className="mt-6 grid gap-4">
      <label>
        <span className="text-[10px] font-semibold text-white/42">
          {t("inspector.endingTitle")}
        </span>
        <Input
          value={localizedValue(ending.title, locale)}
          maxLength={4_000}
          disabled={!canEdit}
          onChange={(event) =>
            onUpdate({ title: { ...ending.title, [locale]: event.target.value } })
          }
          className="mt-2 h-9 rounded-xl bg-white/[0.055] px-3"
        />
      </label>
      <label>
        <span className="text-[10px] font-semibold text-white/42">
          {t("inspector.endingSummary")}
        </span>
        <Textarea
          value={localizedValue(ending.summary, locale)}
          maxLength={4_000}
          disabled={!canEdit}
          rows={5}
          onChange={(event) =>
            onUpdate({
              summary: { ...(ending.summary ?? {}), [locale]: event.target.value },
            })
          }
          className="mt-2 resize-none bg-white/[0.055] text-xs leading-5"
        />
      </label>
    </div>
  );
}

function InspectorRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/[0.045] px-3 py-3">
      <dt className="text-[9px] font-semibold text-white/32">{label}</dt>
      <dd className={cn("mt-1 break-all text-xs text-white/68", mono && "font-mono text-[10px]")}>
        {value}
      </dd>
    </div>
  );
}

const MAX_LOCALIZED_NAME_LENGTH = 4_000;
const MAX_SUMMARY_LENGTH = 4_000;
const MAX_CHARACTER_IMAGES = 6;
const MAX_CHARACTER_VOICE_DURATION_MS = 5_000;
const CHARACTER_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const CHARACTER_VOICE_ACCEPT =
  "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/x-m4a";

/**
 * The character-node inspector. Character cards are a canvas projection of
 * storyBible.characters, so their fields edit that bible entry directly through
 * the existing update/remove mutations. A pure branching tree never references a
 * character, so deletion is always available.
 */
function CharacterNodeEditor({
  content,
  locale,
  characterId,
  canEdit,
  onUpdate,
}: {
  content: InteractiveStoryDraftContent;
  locale: string;
  characterId: string;
  canEdit: boolean;
  onUpdate: (id: string, patch: Partial<Omit<Character, "id">>) => void;
}) {
  const t = useTranslations("storyStudio.canvas.world.characters");
  const character =
    content.storyBible.characters.find((candidate) => candidate.id === characterId) ?? null;
  if (!character) return null;

  return (
    <div className="mt-6 space-y-4">
      <InspectorRow label={t("stableId")} value={character.id} mono />

      <label className="block">
        <FieldLabel>{t("name", { locale })}</FieldLabel>
        <Input
          value={character.name[locale] ?? ""}
          maxLength={MAX_LOCALIZED_NAME_LENGTH}
          disabled={!canEdit}
          placeholder={t("namePlaceholder")}
          onChange={(event) =>
            onUpdate(character.id, {
              name: { ...character.name, [locale]: event.target.value },
            })
          }
          className="mt-1.5 h-9 rounded-xl bg-white/[0.055] px-3"
        />
      </label>

      <label className="block">
        <FieldLabel>{t("summary")}</FieldLabel>
        <Textarea
          value={character.summary}
          maxLength={MAX_SUMMARY_LENGTH}
          disabled={!canEdit}
          rows={5}
          placeholder={t("summaryPlaceholder")}
          onChange={(event) => onUpdate(character.id, { summary: event.target.value })}
          className="mt-1.5 resize-none rounded-xl bg-white/[0.055] text-xs leading-5"
        />
      </label>

      <CharacterImagesEditor
        character={character}
        canEdit={canEdit}
        onUpdate={(images) => onUpdate(character.id, { images })}
      />

      <CharacterVoiceEditor
        character={character}
        canEdit={canEdit}
        onUpdate={(voice) => onUpdate(character.id, { voice })}
      />
    </div>
  );
}

function CharacterImagesEditor({
  character,
  canEdit,
  onUpdate,
}: {
  character: Character;
  canEdit: boolean;
  onUpdate: (images: Character["images"]) => void;
}) {
  const t = useTranslations("storyStudio.canvas.world.characters");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const remaining = MAX_CHARACTER_IMAGES - character.images.length;

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || remaining <= 0) return;
    const files = Array.from(fileList).slice(0, remaining);
    setBusy(true);
    setError(null);
    try {
      const uploaded: Character["images"] = [];
      for (const file of files) {
        const result = await uploadFileViaSignedUrl(file, {
          kind: "ai_reference_image",
          contentType: file.type || undefined,
        });
        uploaded.push({
          mediaAssetId: result.mediaAssetId,
          url: result.url,
          label: defaultImageLabel(file.name, character.images.length + uploaded.length + 1),
        });
      }
      onUpdate([...character.images, ...uploaded]);
    } catch (err) {
      if (!isUploadAbort(err)) setError(t("imageUploadFailed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <section aria-labelledby="story-character-images-title">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel id="story-character-images-title">{t("images")}</FieldLabel>
        <span className="rounded-full bg-white/[0.055] px-2 py-1 text-[9px] tabular-nums text-white/34">
          {character.images.length}/{MAX_CHARACTER_IMAGES}
        </span>
      </div>
      <p className="mt-1 text-[9px] leading-4 text-white/30">
        {t("imagesHint", { max: MAX_CHARACTER_IMAGES })}
      </p>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {character.images.map((image, index) => (
          <div key={image.mediaAssetId} className="rounded-xl bg-white/[0.045] p-1.5">
            <div className="group relative aspect-square overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element -- unsized user upload */}
              <img
                src={image.url}
                alt={image.label || t("imageAlt", { number: index + 1 })}
                draggable={false}
                className="size-full select-none object-cover"
              />
              {canEdit ? (
                <button
                  type="button"
                  onClick={() =>
                    onUpdate(character.images.filter((candidate) => candidate !== image))
                  }
                  aria-label={t("removeImage", { number: index + 1 })}
                  title={t("removeImage", { number: index + 1 })}
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/55 text-white/70 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 hover:text-white"
                >
                  <IconX className="size-3.5" />
                </button>
              ) : null}
            </div>
            <ImageLabelInput
              key={image.label}
              label={image.label}
              index={index}
              canEdit={canEdit}
              onCommit={(nextLabel) =>
                onUpdate(
                  character.images.map((candidate) =>
                    candidate === image ? { ...candidate, label: nextLabel } : candidate
                  )
                )
              }
            />
          </div>
        ))}
        {canEdit && remaining > 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            aria-label={t("addImage")}
            title={t("addImage")}
            className="grid aspect-square place-items-center rounded-xl bg-white/[0.035] text-white/34 transition hover:bg-white/[0.07] hover:text-white/62 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/24"
          >
            {busy ? (
              <span className="text-[9px]">{t("uploading")}</span>
            ) : (
              <IconPlus className="size-5" />
            )}
          </button>
        ) : null}
      </div>
      {character.images.length === 0 && (!canEdit || remaining <= 0) ? (
        <p className="mt-2 rounded-xl bg-white/[0.035] px-3 py-2.5 text-[10px] leading-4 text-white/32">
          {t("imagesEmpty")}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-[9px] leading-4 text-destructive/80">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept={CHARACTER_IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(event) => void handleFiles(event.target.files)}
      />
    </section>
  );
}

function CharacterVoiceEditor({
  character,
  canEdit,
  onUpdate,
}: {
  character: Character;
  canEdit: boolean;
  onUpdate: (voice: Character["voice"]) => void;
}) {
  const t = useTranslations("storyStudio.canvas.world.characters");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const waveRef = useRef<HTMLButtonElement>(null);
  const voice = character.voice;
  const peaks = useVoiceWaveformPeaks(voice?.url ?? null);

  const stopProgressLoop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  // Painted straight onto the DOM from the rAF loop — per-frame React
  // state would re-render the whole inspector 60×/s for a cosmetic sweep.
  const paintProgress = (ratio: number) => {
    const clipped = Math.min(1, Math.max(0, ratio));
    if (progressRef.current) {
      progressRef.current.style.clipPath = `inset(0 ${((1 - clipped) * 100).toFixed(2)}% 0 0)`;
    }
  };

  const stopPlayback = () => {
    stopProgressLoop();
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
    paintProgress(0);
  };

  const startProgressLoop = () => {
    stopProgressLoop();
    const tick = () => {
      const audio = audioRef.current;
      if (!audio || !voice) return;
      const total =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : voice.durationMs / 1000;
      paintProgress(audio.currentTime / total);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const playFrom = (ratio: number | null) => {
    if (!voice) return;
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio(voice.url);
      const settle = () => {
        stopProgressLoop();
        audioRef.current = null;
        setPlaying(false);
        paintProgress(0);
      };
      audio.onended = settle;
      audio.onerror = settle;
      audioRef.current = audio;
    }
    if (ratio !== null) {
      audio.currentTime = ratio * (voice.durationMs / 1000);
      paintProgress(ratio);
    }
    setPlaying(true);
    startProgressLoop();
    void audio.play().catch(() => stopPlayback());
  };

  const togglePlayback = () => {
    if (playing) stopPlayback();
    else playFrom(null);
  };

  const seekFromPointer = (clientX: number) => {
    const rect = waveRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) {
      togglePlayback();
      return;
    }
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    playFrom(ratio);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    stopPlayback();
    let durationMs: number;
    try {
      durationMs = Math.round(await probeAudioDurationMs(file));
    } catch {
      setError(t("voiceUnreadable"));
      return;
    }
    if (durationMs <= 0 || durationMs > MAX_CHARACTER_VOICE_DURATION_MS) {
      setError(t("voiceTooLong"));
      return;
    }
    setBusy(true);
    try {
      const result = await uploadFileViaSignedUrl(file, {
        kind: "ai_reference_audio",
        contentType: file.type || undefined,
      });
      onUpdate({ mediaAssetId: result.mediaAssetId, url: result.url, durationMs });
    } catch (err) {
      if (!isUploadAbort(err)) setError(t("voiceUploadFailed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  return (
    <section aria-labelledby="story-character-voice-title">
      <FieldLabel id="story-character-voice-title">{t("voice")}</FieldLabel>
      <p className="mt-1 text-[9px] leading-4 text-white/30">
        {t("voiceHint", { seconds: MAX_CHARACTER_VOICE_DURATION_MS / 1000 })}
      </p>

      {voice ? (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-white/[0.045] p-2">
          <button
            type="button"
            onClick={togglePlayback}
            aria-label={playing ? t("voiceStop") : t("voicePlay")}
            title={playing ? t("voiceStop") : t("voicePlay")}
            className="grid size-8 shrink-0 place-items-center rounded-full text-white/62 transition hover:bg-white/[0.1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/24"
          >
            {playing ? (
              <IconPlayerStop className="size-4 fill-current" />
            ) : (
              <IconPlayerPlay className="size-4 fill-current" />
            )}
          </button>
          <button
            ref={waveRef}
            type="button"
            onClick={(event) => seekFromPointer(event.clientX)}
            aria-label={playing ? t("voiceStop") : t("voicePlay")}
            className="relative flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/24"
          >
            <WaveformBars peaks={peaks ?? FALLBACK_WAVEFORM_PEAKS} barClassName="bg-white/[0.22]" />
            <div
              ref={progressRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center gap-[2px]"
              style={{ clipPath: "inset(0 100% 0 0)" }}
            >
              <WaveformBars peaks={peaks ?? FALLBACK_WAVEFORM_PEAKS} barClassName="bg-white/85" />
            </div>
          </button>
          <span className="shrink-0 font-mono text-[9px] tabular-nums text-white/44">
            {busy ? t("uploading") : `${(voice.durationMs / 1000).toFixed(1)}s`}
          </span>
          {canEdit ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                aria-label={t("replaceVoice")}
                title={t("replaceVoice")}
                className="text-white/34 hover:text-white"
              >
                <IconUpload />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy}
                onClick={() => {
                  stopPlayback();
                  onUpdate(null);
                }}
                aria-label={t("removeVoice")}
                title={t("removeVoice")}
                className="text-white/34 hover:text-destructive"
              >
                <IconTrash />
              </Button>
            </>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 rounded-xl bg-white/[0.035] px-3 py-2.5 text-[10px] leading-4 text-white/32">
          {t("voiceEmpty")}
        </p>
      )}

      {canEdit && !voice ? (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-2 w-full"
        >
          <IconUpload className="size-4" />
          {busy ? t("uploading") : t("addVoice")}
        </Button>
      ) : null}
      {error ? <p className="mt-2 text-[9px] leading-4 text-destructive/80">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept={CHARACTER_VOICE_ACCEPT}
        hidden
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
    </section>
  );
}

const MAX_IMAGE_LABEL_LENGTH = 60;

/** Names the look (常服 / 夜行 / 盛装 …); empty commits revert to the last name. */
function ImageLabelInput({
  label,
  index,
  canEdit,
  onCommit,
}: {
  label: string;
  index: number;
  canEdit: boolean;
  onCommit: (label: string) => void;
}) {
  const t = useTranslations("storyStudio.canvas.world.characters");
  const [draft, setDraft] = useState(label);

  const commit = () => {
    const normalized = draft.trim().slice(0, MAX_IMAGE_LABEL_LENGTH);
    if (!normalized) {
      setDraft(label);
      return;
    }
    if (normalized !== label) onCommit(normalized);
  };

  return (
    <Input
      value={draft}
      maxLength={MAX_IMAGE_LABEL_LENGTH}
      disabled={!canEdit}
      placeholder={t("imageLabelPlaceholder")}
      aria-label={t("imageLabelLabel", { number: index + 1 })}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(label);
          event.currentTarget.blur();
        }
      }}
      className="mt-1.5 h-7 rounded-lg bg-black/18 px-2 text-[10px]"
    />
  );
}

const WAVEFORM_BUCKETS = 48;

/** One row of peak bars; rendered twice (dim base + clipped bright layer). */
function WaveformBars({ peaks, barClassName }: { peaks: number[]; barClassName: string }) {
  return (
    <>
      {peaks.map((peak, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn("min-h-[3px] w-full min-w-0 flex-1 rounded-full", barClassName)}
          style={{ height: `${Math.max(10, Math.round(peak * 100))}%` }}
        />
      ))}
    </>
  );
}

/** Neutral placeholder bars shown until decode succeeds (or when it can't). */
const FALLBACK_WAVEFORM_PEAKS = Array.from(
  { length: WAVEFORM_BUCKETS },
  (_, index) => 0.3 + 0.22 * Math.sin(index / 2.6) * Math.sin(index / 7)
);

/**
 * Decodes the uploaded sample into normalized per-bucket peaks. Any failure
 * (CORS, unsupported codec, no Web Audio) leaves the fallback bars in place.
 */
function useVoiceWaveformPeaks(url: string | null): number[] | null {
  const [result, setResult] = useState<{ url: string; peaks: number[] } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(url, { mode: "cors" });
        if (!response.ok) return;
        const bytes = await response.arrayBuffer();
        const AudioContextCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) return;
        const context = new AudioContextCtor();
        try {
          const decoded = await context.decodeAudioData(bytes);
          const channel = decoded.getChannelData(0);
          const bucketSize = Math.max(1, Math.floor(channel.length / WAVEFORM_BUCKETS));
          const raw: number[] = [];
          for (let bucket = 0; bucket < WAVEFORM_BUCKETS; bucket += 1) {
            const start = bucket * bucketSize;
            const end = Math.min(channel.length, start + bucketSize);
            let peak = 0;
            for (let sample = start; sample < end; sample += 1) {
              const value = Math.abs(channel[sample]!);
              if (value > peak) peak = value;
            }
            raw.push(peak);
          }
          const highest = Math.max(...raw, 0.001);
          if (!cancelled) {
            setResult({ url, peaks: raw.map((value) => value / highest) });
          }
        } finally {
          void context.close();
        }
      } catch {
        // Keep the fallback bars.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return result?.url === url ? result.peaks : null;
}

/** Default look name = the file name stem, falling back to a numbered ref. */
function defaultImageLabel(fileName: string, ordinal: number): string {
  const stem = fileName.replace(/\.[^.]+$/u, "").trim();
  return (stem || `Ref ${ordinal}`).slice(0, MAX_IMAGE_LABEL_LENGTH);
}

/** Duration probe via a detached audio element; rejects unreadable files. */
function probeAudioDurationMs(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      const seconds = audio.duration;
      if (!Number.isFinite(seconds) || seconds <= 0) {
        reject(new Error("unreadable audio duration"));
        return;
      }
      resolve(seconds * 1000);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable audio file"));
    };
    audio.src = url;
  });
}

function FieldLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className="text-[10px] font-semibold text-white/42">
      {children}
    </span>
  );
}

function localizedValue(value: Record<string, string> | undefined, locale: string): string {
  return value?.[locale] ?? "";
}
