"use client";

import { useState } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconBook2,
  IconCopy,
  IconGitBranch,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type {
  InteractiveFilmDraftContent,
  StoryClipPromptDraft,
  FilmTrailerSummary,
  StoryGraphChoice,
  StoryGraphNode,
  StoryTrailerPromptDraft,
} from "@/lib/story-projects-api";
import type { StoryCanvasNode } from "./story-project-canvas-model";
import {
  StoryAutoRoutesEditor,
  TargetNodePicker,
  type AutoRoutePatch,
} from "./story-auto-routes-editor";
import { StoryChoiceAdvancedEditor } from "./story-choice-advanced-editor";
import { StoryDirectorPromptEditor } from "./story-director-prompt-editor";
import { StoryClipReferenceBindings } from "./story-clip-reference-bindings";
import type { StoryVideoComposerProps } from "./story-shot-composer";
import { StoryWorldLibrary } from "./story-world-library";

type FoundationField = "logline" | "synopsis" | "worldview";
type ClipNode = Extract<StoryGraphNode, { kind: "clip" }>;
type ChoiceExit = Extract<ClipNode["exit"], { kind: "choice" }>;
type Ending = InteractiveFilmDraftContent["storyBible"]["endings"][number];
type Character = InteractiveFilmDraftContent["storyBible"]["characters"][number];
type StateVariable = InteractiveFilmDraftContent["storyBible"]["stateVariables"][number];
type WorldTextField = "locations" | "props" | "storyRules";

interface StoryNodeInspectorProps {
  content: InteractiveFilmDraftContent;
  locale: string;
  selectedNode: StoryCanvasNode | null;
  showFoundation: boolean;
  canEdit: boolean;
  onShowFoundation: () => void;
  onUpdateFoundation: (field: FoundationField, value: string) => void;
  onCreateCharacter: () => string | null;
  onUpdateCharacter: (characterId: string, patch: Partial<Omit<Character, "id">>) => void;
  onDeleteCharacter: (characterId: string) => void;
  onAddWorldTextItem: (field: WorldTextField) => void;
  onUpdateWorldTextItem: (field: WorldTextField, index: number, value: string) => void;
  onRemoveWorldTextItem: (field: WorldTextField, index: number) => void;
  onCreateStateVariable: (type: StateVariable["type"]) => string | null;
  onReplaceStateVariable: (key: string, next: StateVariable) => void;
  onDeleteStateVariable: (key: string) => void;
  onReplaceClipPrompt: (graphNodeId: string, next: StoryClipPromptDraft) => void;
  onCloseNode: () => void;
  onSetEntry: (nodeId: string) => void;
  onChangeExitKind: (nodeId: string, kind: ClipNode["exit"]["kind"], targetId?: string) => void;
  onUpdateClipContinuation: (nodeId: string, targetNodeId: string) => void;
  onUpdateCheckpointTarget: (nodeId: string, targetNodeId: string) => void;
  onAddAutoRoute: (nodeId: string, targetNodeId: string) => void;
  onUpdateAutoRoute: (nodeId: string, routeIndex: number, patch: AutoRoutePatch) => void;
  onRemoveAutoRoute: (nodeId: string, routeIndex: number) => void;
  onUpdateChoiceExit: (
    nodeId: string,
    patch: Partial<Pick<ChoiceExit, "prompt" | "trigger">>
  ) => void;
  onAddChoice: (nodeId: string, targetNodeId: string) => void;
  onUpdateChoice: (
    nodeId: string,
    choiceId: string,
    patch: Partial<
      Pick<
        StoryGraphChoice,
        "label" | "nextNodeId" | "accessibilityLabel" | "visibleWhen" | "effects" | "afterSelect"
      >
    >
  ) => void;
  onMoveChoice: (nodeId: string, choiceId: string, direction: "up" | "down") => void;
  onRemoveChoice: (nodeId: string, choiceId: string) => void;
  onUpdateEnding: (endingId: string, patch: Partial<Ending>) => void;
  onDuplicateNode: (nodeId: string) => void;
  onDeleteSelected: () => void;
  production?: StoryVideoComposerProps;
  filmTrailer: FilmTrailerSummary | null;
  trailerProduction?: StoryVideoComposerProps;
  onCreateTrailerPrompt: () => void;
  onReplaceTrailerPrompt: (prompt: StoryTrailerPromptDraft) => void;
}

const ENDING_KINDS: Ending["kind"][] = ["truth", "bond", "echo", "failure", "hidden", "custom"];

export function StoryNodeInspector({
  content,
  locale,
  selectedNode,
  showFoundation,
  canEdit,
  onShowFoundation,
  onUpdateFoundation,
  onCreateCharacter,
  onUpdateCharacter,
  onDeleteCharacter,
  onAddWorldTextItem,
  onUpdateWorldTextItem,
  onRemoveWorldTextItem,
  onCreateStateVariable,
  onReplaceStateVariable,
  onDeleteStateVariable,
  onReplaceClipPrompt,
  onCloseNode,
  onSetEntry,
  onChangeExitKind,
  onUpdateClipContinuation,
  onUpdateCheckpointTarget,
  onAddAutoRoute,
  onUpdateAutoRoute,
  onRemoveAutoRoute,
  onUpdateChoiceExit,
  onAddChoice,
  onUpdateChoice,
  onMoveChoice,
  onRemoveChoice,
  onUpdateEnding,
  onDuplicateNode,
  onDeleteSelected,
  production,
  filmTrailer,
  trailerProduction,
  onCreateTrailerPrompt,
  onReplaceTrailerPrompt,
}: StoryNodeInspectorProps) {
  const t = useTranslations("storyStudio.canvas");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const canvasData = selectedNode?.data;
  const canonicalNodeId =
    canvasData?.kind === "decision" ? canvasData.sourceNodeId : canvasData?.nodeId;
  const graphNode =
    content.graph.nodes.find((candidate) => candidate.nodeId === canonicalNodeId) ?? null;
  const ending = canvasData?.endingId
    ? (content.storyBible.endings.find((candidate) => candidate.id === canvasData.endingId) ?? null)
    : null;

  return (
    <aside className="absolute top-16 right-3 bottom-3 z-30 w-[368px] overflow-y-auto rounded-[24px] bg-[oklch(0.205_0_0/0.72)] px-5 py-5 shadow-[-18px_0_60px_rgba(0,0,0,0.32)] backdrop-blur-[60px] backdrop-saturate-150">
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]" />
      {showFoundation || !canvasData ? (
        <StoryWorldLibrary
          content={content}
          locale={locale}
          canEdit={canEdit}
          onUpdateFoundation={onUpdateFoundation}
          onCreateCharacter={onCreateCharacter}
          onUpdateCharacter={onUpdateCharacter}
          onDeleteCharacter={onDeleteCharacter}
          onAddTextItem={onAddWorldTextItem}
          onUpdateTextItem={onUpdateWorldTextItem}
          onRemoveTextItem={onRemoveWorldTextItem}
          onCreateStateVariable={onCreateStateVariable}
          onReplaceStateVariable={onReplaceStateVariable}
          onDeleteStateVariable={onDeleteStateVariable}
        />
      ) : canvasData.kind === "root" ? (
        <RootTrailerInspector
          prompt={content.trailerPrompt}
          trailer={filmTrailer}
          production={trailerProduction}
          canEdit={canEdit}
          onCreate={onCreateTrailerPrompt}
          onChange={onReplaceTrailerPrompt}
          onClose={onCloseNode}
        />
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
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

          {graphNode ? (
            <GraphNodeEditor
              content={content}
              locale={locale}
              node={graphNode}
              decisionOnly={canvasData.kind === "decision"}
              canEdit={canEdit}
              production={production}
              onSetEntry={onSetEntry}
              onChangeExitKind={onChangeExitKind}
              onUpdateClipContinuation={onUpdateClipContinuation}
              onUpdateCheckpointTarget={onUpdateCheckpointTarget}
              onAddAutoRoute={onAddAutoRoute}
              onUpdateAutoRoute={onUpdateAutoRoute}
              onRemoveAutoRoute={onRemoveAutoRoute}
              onUpdateChoiceExit={onUpdateChoiceExit}
              onAddChoice={onAddChoice}
              onUpdateChoice={onUpdateChoice}
              onMoveChoice={onMoveChoice}
              onRemoveChoice={onRemoveChoice}
              onReplaceClipPrompt={onReplaceClipPrompt}
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

          <div className="mt-6 grid gap-2">
            {graphNode && canvasData.kind !== "decision" ? (
              <Button
                type="button"
                variant="secondary"
                disabled={!canEdit}
                onClick={() => onDuplicateNode(graphNode.nodeId)}
                className="w-full"
              >
                <IconCopy className="size-4" />
                {t("inspector.duplicate")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              disabled={!canEdit}
              onClick={() => setDeleteOpen(true)}
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
            <Button variant="ghost" className="w-full" onClick={onShowFoundation}>
              <IconBook2 className="size-4" />
              {t("foundation.action")}
            </Button>
          </div>

          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogContent className="rounded-[22px] bg-[oklch(0.22_0_0/0.96)] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.58)] backdrop-blur-[40px]">
              <DialogHeader>
                <DialogTitle>
                  {t(
                    canvasData.kind === "decision"
                      ? "inspector.removeDecisionTitle"
                      : "inspector.deleteTitle"
                  )}
                </DialogTitle>
                <DialogDescription>
                  {t(
                    canvasData.kind === "decision"
                      ? "inspector.removeDecisionDescription"
                      : "inspector.deleteDescription"
                  )}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">{t("inspector.cancel")}</Button>
                </DialogClose>
                <Button
                  variant="destructive"
                  onClick={() => {
                    onDeleteSelected();
                    setDeleteOpen(false);
                  }}
                >
                  <IconTrash className="size-4" />
                  {t("inspector.confirmDelete")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </aside>
  );
}

function RootTrailerInspector({
  prompt,
  trailer,
  production,
  canEdit,
  onCreate,
  onChange,
  onClose,
}: {
  prompt: StoryTrailerPromptDraft | null;
  trailer: FilmTrailerSummary | null;
  production?: StoryVideoComposerProps;
  canEdit: boolean;
  onCreate: () => void;
  onChange: (prompt: StoryTrailerPromptDraft) => void;
  onClose: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.trailer");
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-white/34 uppercase">
            {t("eyebrow")}
          </p>
          <h2 className="mt-1 text-base font-semibold">{t("title")}</h2>
          <p className="mt-1 text-[10px] leading-4 text-white/34">{t("description")}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/48 transition hover:bg-white/[0.1] hover:text-white"
          aria-label={t("close")}
        >
          <IconX className="size-4" />
        </button>
      </div>

      {!prompt ? (
        <div className="mt-6 rounded-[20px] bg-white/[0.04] p-5 text-center">
          <IconBook2 className="mx-auto size-5 text-white/28" />
          <h3 className="mt-3 text-sm font-semibold text-white/72">{t("authoring.emptyTitle")}</h3>
          <p className="mt-2 text-[10px] leading-5 text-white/38">
            {t("authoring.emptyDescription")}
          </p>
          <Button className="mt-4 w-full" disabled={!canEdit} onClick={onCreate}>
            <IconPlus className="size-4" />
            {t("authoring.create")}
          </Button>
        </div>
      ) : (
        <StoryDirectorPromptEditor prompt={prompt} canEdit={canEdit} onChange={onChange} />
      )}
      {trailer && production ? (
        <>
          <StoryClipReferenceBindings
            subject="trailer"
            clip={trailer}
            references={production.references}
            canEdit={canEdit}
            apiConnected
            pending={Boolean(production.referenceBindingsPending)}
            onSave={production.onUpdateReferenceBindings ?? (() => undefined)}
          />
        </>
      ) : null}
    </>
  );
}

function GraphNodeEditor({
  content,
  locale,
  node,
  decisionOnly,
  canEdit,
  production,
  onSetEntry,
  onChangeExitKind,
  onUpdateClipContinuation,
  onUpdateCheckpointTarget,
  onAddAutoRoute,
  onUpdateAutoRoute,
  onRemoveAutoRoute,
  onUpdateChoiceExit,
  onAddChoice,
  onUpdateChoice,
  onMoveChoice,
  onRemoveChoice,
  onReplaceClipPrompt,
}: {
  content: InteractiveFilmDraftContent;
  locale: string;
  node: StoryGraphNode;
  decisionOnly: boolean;
  canEdit: boolean;
  production?: StoryVideoComposerProps;
  onSetEntry: StoryNodeInspectorProps["onSetEntry"];
  onChangeExitKind: StoryNodeInspectorProps["onChangeExitKind"];
  onUpdateClipContinuation: StoryNodeInspectorProps["onUpdateClipContinuation"];
  onUpdateCheckpointTarget: StoryNodeInspectorProps["onUpdateCheckpointTarget"];
  onAddAutoRoute: StoryNodeInspectorProps["onAddAutoRoute"];
  onUpdateAutoRoute: StoryNodeInspectorProps["onUpdateAutoRoute"];
  onRemoveAutoRoute: StoryNodeInspectorProps["onRemoveAutoRoute"];
  onUpdateChoiceExit: StoryNodeInspectorProps["onUpdateChoiceExit"];
  onAddChoice: StoryNodeInspectorProps["onAddChoice"];
  onUpdateChoice: StoryNodeInspectorProps["onUpdateChoice"];
  onMoveChoice: StoryNodeInspectorProps["onMoveChoice"];
  onRemoveChoice: StoryNodeInspectorProps["onRemoveChoice"];
  onReplaceClipPrompt: StoryNodeInspectorProps["onReplaceClipPrompt"];
}) {
  const t = useTranslations("storyStudio.canvas");
  const targetNodes = content.graph.nodes.filter((candidate) => candidate.nodeId !== node.nodeId);
  const isEntry = content.graph.entryNodeId === node.nodeId;
  const [pendingExitKind, setPendingExitKind] = useState<ClipNode["exit"]["kind"] | null>(null);
  const [pendingExitTargetId, setPendingExitTargetId] = useState<string | null>(null);
  const clipPrompt =
    node.kind === "clip"
      ? (content.clipPrompts.find((prompt) => prompt.graphNodeId === node.nodeId) ?? null)
      : null;
  const exitBranchCount =
    node.exit.kind === "auto"
      ? node.kind === "clip"
        ? Number(node.exit.nextNodeId !== null)
        : node.exit.routes.length
      : node.exit.kind === "choice"
        ? node.exit.choices.length
        : 1;
  const requestExitKind = (kind: ClipNode["exit"]["kind"]) => {
    if (node.kind !== "clip" || kind === node.exit.kind) return;
    if (exitBranchCount === 0 && kind !== "ending" && kind !== "checkpoint") {
      onChangeExitKind(node.nodeId, kind);
      return;
    }
    setPendingExitTargetId(
      kind === "ending"
        ? (content.storyBible.endings[0]?.id ?? null)
        : kind === "checkpoint"
          ? (targetNodes[0]?.nodeId ?? null)
          : null
    );
    setPendingExitKind(kind);
  };
  return (
    <>
      <dl className="mt-6 space-y-3">
        <InspectorRow
          label={t("inspector.nodeId")}
          value={
            decisionOnly && node.kind === "clip" && node.exit.kind === "choice"
              ? node.exit.decisionId
              : node.nodeId
          }
          mono
        />
        {node.kind === "clip" && !decisionOnly ? (
          <InspectorRow label={t("inspector.clipKey")} value={node.clipKey} mono />
        ) : null}
      </dl>

      {node.kind === "clip" && production?.clip && !decisionOnly ? (
        <>
          <StoryClipReferenceBindings
            clip={production.clip}
            references={production.references}
            canEdit={canEdit}
            apiConnected={production.referenceApiConnected ?? false}
            pending={production.referenceBindingsPending ?? false}
            onSave={production.onUpdateReferenceBindings ?? (() => undefined)}
          />
        </>
      ) : null}

      {node.kind === "clip" && clipPrompt && !decisionOnly ? (
        <StoryDirectorPromptEditor
          prompt={clipPrompt}
          canEdit={canEdit}
          onChange={(next) => onReplaceClipPrompt(node.nodeId, next)}
        />
      ) : null}

      {!decisionOnly ? (
        <div className="mt-5 grid gap-3">
          <button
            type="button"
            disabled={!canEdit || isEntry}
            onClick={() => onSetEntry(node.nodeId)}
            className={cn(
              "flex h-10 items-center justify-between rounded-xl bg-white/[0.055] px-3 text-xs font-semibold text-white/60 transition hover:bg-white/[0.09] hover:text-white disabled:cursor-default",
              isEntry && "bg-white/[0.1] text-white/86"
            )}
          >
            <span>
              {isEntry
                ? t(node.kind === "router" ? "inspector.entryNode" : "inspector.entry")
                : t("inspector.makeEntry")}
            </span>
            <span className="size-2 rounded-full bg-white/45" />
          </button>
          {node.kind === "clip" ? (
            <label>
              <span className="text-[10px] font-semibold text-white/42">{t("inspector.exit")}</span>
              <Select
                value={node.exit.kind}
                disabled={!canEdit}
                onValueChange={(value) => requestExitKind(value as ClipNode["exit"]["kind"])}
              >
                <SelectTrigger className="mt-2 h-9! w-full rounded-xl bg-white/[0.055] px-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="auto">{t("inspector.exitAuto")}</SelectItem>
                  <SelectItem value="choice">{t("inspector.exitChoice")}</SelectItem>
                  <SelectItem value="checkpoint" disabled={targetNodes.length === 0}>
                    {t("inspector.exitCheckpoint")}
                  </SelectItem>
                  <SelectItem value="ending" disabled={content.storyBible.endings.length === 0}>
                    {t("inspector.exitEnding")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
          ) : null}

          {node.kind === "clip" && node.exit.kind === "ending" ? (
            <label>
              <span className="text-[10px] font-semibold text-white/42">
                {t("inspector.endingTarget")}
              </span>
              <Select
                value={node.exit.endingId}
                disabled={!canEdit}
                onValueChange={(endingId) => onChangeExitKind(node.nodeId, "ending", endingId)}
              >
                <SelectTrigger className="mt-2 h-9! w-full rounded-xl bg-white/[0.055] px-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {content.storyBible.endings.map((ending) => (
                    <SelectItem key={ending.id} value={ending.id}>
                      {localizedValue(ending.title, locale) || ending.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}

          {node.kind === "clip" && node.exit.kind === "auto" ? (
            <label>
              <span className="text-[10px] font-semibold text-white/42">
                {t("inspector.continuationTarget")}
              </span>
              <TargetNodePicker
                value={node.exit.nextNodeId}
                nodes={targetNodes}
                ariaLabel={t("inspector.continuationTarget")}
                disabled={!canEdit}
                onChange={(targetNodeId) => onUpdateClipContinuation(node.nodeId, targetNodeId)}
                className="mt-2"
              />
              <p className="mt-2 text-[9px] leading-4 text-white/34">
                {t("inspector.continuationDescription")}
              </p>
            </label>
          ) : null}

          {node.kind === "clip" && node.exit.kind === "checkpoint" ? (
            <label>
              <span className="text-[10px] font-semibold text-white/42">
                {t("inspector.checkpointTarget")}
              </span>
              <TargetNodePicker
                value={node.exit.nextNodeId}
                nodes={targetNodes}
                ariaLabel={t("inspector.checkpointTarget")}
                disabled={!canEdit}
                onChange={(targetNodeId) => onUpdateCheckpointTarget(node.nodeId, targetNodeId)}
                className="mt-2"
              />
              <p className="mt-2 text-[9px] leading-4 text-white/34">
                {t("inspector.checkpointDescription")}
              </p>
            </label>
          ) : null}
        </div>
      ) : null}

      {node.kind === "clip" && node.exit.kind === "choice" ? (
        <ChoiceExitEditor
          content={content}
          nodeId={node.nodeId}
          exit={node.exit}
          locale={locale}
          targetNodes={targetNodes}
          canEdit={canEdit}
          onUpdateChoiceExit={onUpdateChoiceExit}
          onAddChoice={onAddChoice}
          onUpdateChoice={onUpdateChoice}
          onMoveChoice={onMoveChoice}
          onRemoveChoice={onRemoveChoice}
        />
      ) : null}

      {node.kind === "router" ? (
        <StoryAutoRoutesEditor
          content={content}
          node={node}
          canEdit={canEdit}
          onAdd={(targetNodeId) => onAddAutoRoute(node.nodeId, targetNodeId)}
          onUpdate={(routeIndex, patch) => onUpdateAutoRoute(node.nodeId, routeIndex, patch)}
          onRemove={(routeIndex) => onRemoveAutoRoute(node.nodeId, routeIndex)}
        />
      ) : null}

      <Dialog
        open={pendingExitKind !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingExitKind(null);
            setPendingExitTargetId(null);
          }
        }}
      >
        <DialogContent className="rounded-[22px] bg-[oklch(0.22_0_0/0.96)] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.58)] backdrop-blur-[40px]">
          <DialogHeader>
            <DialogTitle>{t("inspector.convertExitTitle")}</DialogTitle>
            <DialogDescription>
              {t("inspector.convertExitDescription", { count: exitBranchCount })}
            </DialogDescription>
          </DialogHeader>
          {pendingExitKind === "ending" ? (
            <label>
              <span className="text-[10px] font-semibold text-white/42">
                {t("inspector.endingTarget")}
              </span>
              <Select
                value={pendingExitTargetId ?? undefined}
                onValueChange={setPendingExitTargetId}
              >
                <SelectTrigger className="mt-2 h-9! w-full rounded-xl bg-white/[0.055] px-3">
                  <SelectValue placeholder={t("inspector.endingTargetPlaceholder")} />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {content.storyBible.endings.map((ending) => (
                    <SelectItem key={ending.id} value={ending.id}>
                      {localizedValue(ending.title, locale) || ending.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}
          {pendingExitKind === "checkpoint" ? (
            <label>
              <span className="text-[10px] font-semibold text-white/42">
                {t("inspector.checkpointTarget")}
              </span>
              <TargetNodePicker
                value={pendingExitTargetId}
                nodes={targetNodes}
                ariaLabel={t("inspector.checkpointTarget")}
                onChange={setPendingExitTargetId}
                className="mt-2"
              />
            </label>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("inspector.cancel")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={
                (pendingExitKind === "ending" || pendingExitKind === "checkpoint") &&
                !pendingExitTargetId
              }
              onClick={() => {
                if (!pendingExitKind) return;
                onChangeExitKind(node.nodeId, pendingExitKind, pendingExitTargetId ?? undefined);
                setPendingExitKind(null);
                setPendingExitTargetId(null);
              }}
            >
              {t("inspector.confirmConversion")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChoiceExitEditor({
  content,
  nodeId,
  exit,
  locale,
  targetNodes,
  canEdit,
  onUpdateChoiceExit,
  onAddChoice,
  onUpdateChoice,
  onMoveChoice,
  onRemoveChoice,
}: {
  content: InteractiveFilmDraftContent;
  nodeId: string;
  exit: ChoiceExit;
  locale: string;
  targetNodes: StoryGraphNode[];
  canEdit: boolean;
  onUpdateChoiceExit: StoryNodeInspectorProps["onUpdateChoiceExit"];
  onAddChoice: StoryNodeInspectorProps["onAddChoice"];
  onUpdateChoice: StoryNodeInspectorProps["onUpdateChoice"];
  onMoveChoice: StoryNodeInspectorProps["onMoveChoice"];
  onRemoveChoice: StoryNodeInspectorProps["onRemoveChoice"];
}) {
  const t = useTranslations("storyStudio.canvas");
  const [newChoiceTarget, setNewChoiceTarget] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<StoryGraphChoice | null>(null);
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-[10px] bg-[rgba(91,157,255,0.38)] text-white">
          <IconGitBranch className="size-3.5" />
        </span>
        <h3 className="text-xs font-semibold text-white/78">{t("inspector.choices")}</h3>
      </div>

      <label className="mt-4 block">
        <span className="text-[10px] font-semibold text-white/42">
          {t("inspector.choicePrompt")}
        </span>
        <Textarea
          value={localizedValue(exit.prompt, locale)}
          disabled={!canEdit}
          rows={3}
          maxLength={4_000}
          placeholder={t("inspector.choicePromptPlaceholder")}
          onChange={(event) =>
            onUpdateChoiceExit(nodeId, {
              prompt: { ...exit.prompt, [locale]: event.target.value },
            })
          }
          className="mt-2 resize-none bg-white/[0.055] text-xs leading-5"
        />
        {!localizedValue(exit.prompt, locale).trim() ? (
          <span className="mt-1.5 block text-[9px] text-[#e0a45c]/82">
            {t("inspector.requiredForPlayableStory")}
          </span>
        ) : null}
      </label>

      <label className="mt-4 block">
        <span className="text-[10px] font-semibold text-white/42">
          {t("inspector.choiceTrigger")}
        </span>
        <Select
          value={exit.trigger.kind}
          disabled={!canEdit}
          onValueChange={(value) =>
            onUpdateChoiceExit(nodeId, {
              trigger:
                value === "timecode" ? { kind: "timecode", atMs: 0 } : { kind: "media-ended" },
            })
          }
        >
          <SelectTrigger className="mt-2 h-9! w-full rounded-xl bg-white/[0.055] px-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectItem value="media-ended">{t("inspector.triggerMediaEnded")}</SelectItem>
            <SelectItem value="timecode">{t("inspector.triggerTimecode")}</SelectItem>
          </SelectContent>
        </Select>
      </label>

      {exit.trigger.kind === "timecode" ? (
        <label className="mt-3 block">
          <span className="text-[10px] font-semibold text-white/42">
            {t("inspector.timecodeMs")}
          </span>
          <Input
            type="number"
            min={0}
            step={100}
            value={exit.trigger.atMs}
            disabled={!canEdit}
            onChange={(event) =>
              onUpdateChoiceExit(nodeId, {
                trigger: {
                  kind: "timecode",
                  atMs: Math.max(0, Math.round(event.target.valueAsNumber || 0)),
                },
              })
            }
            className="mt-2 h-9 rounded-xl bg-white/[0.055] px-3"
          />
        </label>
      ) : null}

      <div className="mt-4 space-y-3">
        {exit.choices.map((choice, index) => (
          <div key={choice.choiceId} className="rounded-[16px] bg-white/[0.045] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold text-white/42">
                {t("inspector.optionLabel", { number: index + 1 })}
              </p>
              {canEdit ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onMoveChoice(nodeId, choice.choiceId, "up")}
                    className="grid size-7 place-items-center rounded-lg bg-white/[0.05] text-white/34 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-25"
                    aria-label={t("inspector.moveChoiceUp")}
                  >
                    <IconArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === exit.choices.length - 1}
                    onClick={() => onMoveChoice(nodeId, choice.choiceId, "down")}
                    className="grid size-7 place-items-center rounded-lg bg-white/[0.05] text-white/34 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-25"
                    aria-label={t("inspector.moveChoiceDown")}
                  >
                    <IconArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingRemoval(choice)}
                    className="grid size-7 place-items-center rounded-lg bg-white/[0.05] text-white/34 transition hover:bg-white/[0.1] hover:text-[#ff9b9e]"
                    aria-label={t("inspector.removeChoice")}
                  >
                    <IconTrash className="size-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
            <Input
              value={localizedValue(choice.label, locale)}
              maxLength={4_000}
              disabled={!canEdit}
              placeholder={t("inspector.optionPlaceholder")}
              onChange={(event) =>
                onUpdateChoice(nodeId, choice.choiceId, {
                  label: { ...choice.label, [locale]: event.target.value },
                })
              }
              className="mt-2 h-9 rounded-xl bg-black/18 px-3"
            />
            {!localizedValue(choice.label, locale).trim() ? (
              <p className="mt-1.5 text-[9px] text-[#e0a45c]/82">
                {t("inspector.requiredForPlayableStory")}
              </p>
            ) : null}
            <label className="mt-3 block">
              <span className="text-[9px] font-semibold text-white/30">
                {t("inspector.target")}
              </span>
              <TargetNodePicker
                value={choice.nextNodeId}
                nodes={targetNodes}
                ariaLabel={t("inspector.target")}
                disabled={!canEdit}
                onChange={(targetNodeId) =>
                  onUpdateChoice(nodeId, choice.choiceId, { nextNodeId: targetNodeId })
                }
                className="mt-1.5"
              />
            </label>
            <StoryChoiceAdvancedEditor
              choice={choice}
              content={content}
              locale={locale}
              canEdit={canEdit}
              onChange={(patch) => onUpdateChoice(nodeId, choice.choiceId, patch)}
            />
          </div>
        ))}
      </div>

      {exit.choices.length < 2 ? (
        <p className="mt-3 rounded-xl bg-[rgba(224,164,92,0.08)] px-3 py-2 text-[9px] leading-4 text-[#e0a45c]/82">
          {t("inspector.choiceMinimum", { count: exit.choices.length })}
        </p>
      ) : null}

      {canEdit && exit.choices.length < 6 && targetNodes.length > 0 ? (
        <div className="mt-3 rounded-[16px] bg-white/[0.04] p-3">
          <p className="text-[10px] font-semibold text-white/42">{t("inspector.addChoice")}</p>
          <div className="mt-2 flex items-center gap-2">
            <TargetNodePicker
              value={newChoiceTarget}
              nodes={targetNodes}
              ariaLabel={t("inspector.newChoiceTarget")}
              onChange={setNewChoiceTarget}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              size="icon"
              variant="secondary"
              disabled={!newChoiceTarget}
              onClick={() => {
                if (!newChoiceTarget) return;
                onAddChoice(nodeId, newChoiceTarget);
                setNewChoiceTarget(null);
              }}
              aria-label={t("inspector.addChoice")}
            >
              <IconPlus className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null);
        }}
      >
        <DialogContent className="rounded-[22px] bg-[oklch(0.22_0_0/0.96)] p-5 shadow-[0_28px_100px_rgba(0,0,0,0.58)] backdrop-blur-[40px]">
          <DialogHeader>
            <DialogTitle>{t("inspector.removeChoiceTitle")}</DialogTitle>
            <DialogDescription>{t("inspector.removeChoiceDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t("inspector.cancel")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingRemoval) onRemoveChoice(nodeId, pendingRemoval.choiceId);
                setPendingRemoval(null);
              }}
            >
              <IconTrash className="size-4" />
              {t("inspector.removeChoice")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
      <InspectorRow label={t("inspector.nodeId")} value={ending.id} mono />
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
              summary: { ...ending.summary, [locale]: event.target.value },
            })
          }
          className="mt-2 resize-none bg-white/[0.055] text-xs leading-5"
        />
      </label>
      <label>
        <span className="text-[10px] font-semibold text-white/42">{t("inspector.endingKind")}</span>
        <Select
          value={ending.kind}
          disabled={!canEdit}
          onValueChange={(kind) => onUpdate({ kind: kind as Ending["kind"] })}
        >
          <SelectTrigger className="mt-2 h-9! w-full rounded-xl bg-white/[0.055] px-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {ENDING_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(`endingKinds.${kind}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

function localizedValue(value: Record<string, string>, locale: string): string {
  return value[locale] ?? "";
}
