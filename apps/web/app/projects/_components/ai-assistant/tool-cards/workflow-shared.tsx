"use client";

import { useState } from "react";
import {
  IconBook,
  IconBuildingStore,
  IconCamera,
  IconChevronDown,
  IconChevronUp,
  IconLoader2,
  IconLayoutList,
  IconPackage,
  IconPencil,
  IconPhoto,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";
import { toast } from "sonner";
import { useAppSelector } from "@/src/store";
import { updateDraftData, type Draft, type WorkflowName } from "@/src/lib/workflow/workflow-client";
import {
  findMostRecentInvokeInput,
  type AssistantMessage,
} from "@/src/lib/assistant/assistant-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/src/i18n/i18n";

// ─── Display labels ────────────────────────────────────

export const WORKFLOW_LABEL_KEYS: Record<WorkflowName, string> = {
  role_design: "workflowRoleDesign",
  scene_design: "workflowSceneDesign",
  prop_design: "workflowPropDesign",
  batch_create_asset: "workflowBatchCreate",
  script_edit: "workflowScriptEdit",
  story_outline: "workflowStoryOutline",
  parse_script: "workflowParseScript",
  role_phase: "workflowRolePhase",
  role_image_phase: "workflowRoleImagePhase",
  scene_phase: "workflowScenePhase",
  scene_image_phase: "workflowSceneImagePhase",
  prop_phase: "workflowPropPhase",
  prop_image_phase: "workflowPropImagePhase",
  episode_phase: "workflowEpisodePhase",
  script_phase: "workflowScriptPhase",
  storyboard_phase: "workflowStoryboardPhase",
  produce_script_pipeline: "workflowProduceScriptPipeline",
};

interface WorkflowPersona {
  /** i18n key under `ai.personas.*` — resolved at render time so the
   *  sidebar/chat card adapt to the user's locale. */
  nameKey: string;
  /** Tabler icon component — shown next to the persona name. */
  icon: Icon;
}

export const WORKFLOW_PERSONA: Record<WorkflowName, WorkflowPersona> = {
  story_outline: { nameKey: "personas.storyOutliner", icon: IconBook },
  parse_script: { nameKey: "personas.storyOutliner", icon: IconBook },
  role_design: { nameKey: "personas.characterDesigner", icon: IconUsers },
  scene_design: { nameKey: "personas.sceneDesigner", icon: IconBuildingStore },
  prop_design: { nameKey: "personas.propDesigner", icon: IconPackage },
  role_phase: { nameKey: "personas.characterDesigner", icon: IconUsers },
  role_image_phase: { nameKey: "personas.characterDesigner", icon: IconPhoto },
  scene_phase: { nameKey: "personas.sceneDesigner", icon: IconBuildingStore },
  scene_image_phase: { nameKey: "personas.sceneDesigner", icon: IconPhoto },
  prop_phase: { nameKey: "personas.propDesigner", icon: IconPackage },
  prop_image_phase: { nameKey: "personas.propDesigner", icon: IconPhoto },
  episode_phase: { nameKey: "personas.episodePlanner", icon: IconLayoutList },
  script_phase: { nameKey: "personas.scriptwriter", icon: IconPencil },
  storyboard_phase: { nameKey: "personas.storyboardDesigner", icon: IconCamera },
  produce_script_pipeline: { nameKey: "personas.storyboardDesigner", icon: IconSparkles },
  batch_create_asset: { nameKey: "personas.assetImporter", icon: IconPackage },
  script_edit: { nameKey: "personas.scriptwriter", icon: IconPencil },
};

function groupDraftsByType(drafts: Draft[]): Record<string, Draft[]> {
  const grouped: Record<string, Draft[]> = {};
  for (const d of drafts) {
    if (d.status === "discarded" || d.status === "committed") continue;
    const key = d.entityType;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(d);
  }
  return grouped;
}

// ─── Sub-components ────────────────────────────────────

export function PersonaPill({ persona }: { persona: WorkflowPersona }) {
  const t = useTranslations("ai");
  const Icon = persona.icon;
  return (
    <div className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
      <Icon className="size-3.5 text-muted-foreground" />
      <span>{t(persona.nameKey)}</span>
    </div>
  );
}

interface StoryOutlineResultShape {
  storySummary?: string;
  genre?: string;
  tone?: string;
  structure?: Array<{ chapterId?: string; title?: string; summary?: string }>;
  cast?: Array<{ name?: string; role?: string; arc?: string }>;
  settings?: Array<{ name?: string; typeHint?: string }>;
  threads?: { main?: string; subs?: Array<{ name?: string; description?: string }> };
}

// Height of the collapsed preview — tall enough to show the story summary
// plus a hint of the chapter list, low enough that a long outline doesn't
// dominate the chat scroll. Pair with the fade overlay + chevron button so
// the user knows there's more to see.
const STORY_OUTLINE_COLLAPSED_MAX_H = 200;

export function StoryOutlineResult({
  result,
  t,
}: {
  result: unknown;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const data = result as StoryOutlineResultShape | null;
  const [expanded, setExpanded] = useState(false);

  if (!data || !data.structure) return null;

  const body = (
    <div className="space-y-3 p-3">
      {data.storySummary && (
        <div>
          <ResultHeading>{t("workflowResultStorySummary")}</ResultHeading>
          <p className="text-[12px] leading-relaxed text-foreground/80">{data.storySummary}</p>
        </div>
      )}
      {data.structure.length > 0 && (
        <div>
          <ResultHeading>
            {t("workflowResultChapters", { count: data.structure.length })}
          </ResultHeading>
          <ol className="space-y-1 text-[12px] leading-relaxed">
            {data.structure.map((ch, i) => (
              <li key={ch.chapterId ?? i} className="flex gap-1.5">
                <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
                <span>
                  <span className="font-medium text-foreground/90">{ch.title}</span>
                  {ch.summary ? <span className="text-foreground/60"> — {ch.summary}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {data.cast && data.cast.length > 0 && (
        <div>
          <ResultHeading>{t("workflowResultCast", { count: data.cast.length })}</ResultHeading>
          <ul className="space-y-0.5 text-[12px] leading-relaxed">
            {data.cast.map((c, i) => (
              <li key={c.name ?? i}>
                <span className="font-medium text-foreground/90">{c.name}</span>
                {c.role ? <span className="text-foreground/60"> · {c.role}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.settings && data.settings.length > 0 && (
        <div>
          <ResultHeading>
            {t("workflowResultSettings", { count: data.settings.length })}
          </ResultHeading>
          <ul className="flex flex-wrap gap-x-2 gap-y-0.5 text-[12px] leading-relaxed text-foreground/80">
            {data.settings.map((s, i) => (
              <li key={s.name ?? i}>{s.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <div className="mt-3 rounded-lg border border-border/40 bg-white/2">
      <div
        className="relative overflow-hidden"
        style={expanded ? undefined : { maxHeight: STORY_OUTLINE_COLLAPSED_MAX_H }}
      >
        {body}
        {!expanded && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background via-background/80 to-transparent" />
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={t("draftTableExpandAll")}
              className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full border border-border/60 bg-card shadow-md transition-colors hover:bg-muted"
            >
              <IconChevronDown className="size-4" />
            </button>
          </>
        )}
      </div>
      {expanded && (
        <div className="flex justify-end p-2">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label={t("draftTableCollapseAll")}
            className="flex size-7 items-center justify-center rounded-full border border-border/60 bg-card transition-colors hover:bg-muted"
          >
            <IconChevronUp className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function ResultHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  );
}

/**
 * Best-effort extract of a short preview string from an arbitrary draft.
 * Role/scene/prop drafts have name + description; episode has title +
 * introduction; script/storyboard varies. We normalize to {title, detail}
 * so the UI can render every entity type with the same card.
 */
function draftPreview(draft: Draft): { title: string; detail?: string } {
  const d = (draft.data ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = d[k];
      if (typeof v === "string" && v.trim().length > 0) return v.trim();
    }
    return undefined;
  };
  const title = pick("name", "title", "roleName", "sceneName", "propName") ?? "—";
  const detail = pick("description", "introduction", "intro", "summary", "prompt");
  return { title, detail };
}

// Internal plumbing fields we never want to surface to the user in the
// detail dialog. `sortHint` is handled specially (see below) — for
// episodes it's rendered with a 1-based value; for other entity types
// (role/scene/prop) it's plumbing and stays hidden.
const HIDDEN_DRAFT_FIELDS = new Set<string>([]);

// Human-readable labels for common draft.data fields so the detail dialog
// reads naturally. Kept English-only for now (consistent with "English-
// first when i18n isn't wired yet") — unknown keys fall back to the raw
// key name so we never hide data the user might care about.
const DRAFT_FIELD_LABELS: Record<string, string> = {
  sortHint: "Episode #",
  name: "Name",
  title: "Title",
  roleName: "Character",
  sceneName: "Scene",
  propName: "Prop",
  description: "Description",
  introduction: "Synopsis",
  intro: "Synopsis",
  summary: "Summary",
  prompt: "Image Prompt",
  aliases: "Aliases",
  positioning: "Role",
  appearance: "Appearance",
  personality: "Personality",
  background: "Background",
  voiceId: "Voice",
  model: "Model",
  category: "Category",
  timeOfDay: "Time of day",
  setting: "Setting",
  keyElements: "Key elements",
  lighting: "Lighting",
  atmosphere: "Atmosphere",
  era: "Era",
  material: "Material",
  significance: "Significance",
  shot_no: "Shot #",
  scene: "Scene",
  image_prompt: "Image Prompt",
  video_prompt: "Video Prompt",
  movement: "Camera move",
  shot_size: "Shot size",
  perspective: "Angle",
  duration: "Duration",
  dialogue: "Dialogue",
  worldId: "World ID",
};

function labelForDraftField(key: string): string {
  return DRAFT_FIELD_LABELS[key] ?? key;
}

/**
 * Script content coming back from the LLM often has runs of 3+ `\n` between
 * dialogue lines (formatting drift across models). Rendered under
 * `whitespace-pre-wrap` those become huge visual gaps. Collapse any run of
 * 3+ newlines down to exactly 2 so paragraph breaks stay but gaps don't
 * balloon.
 */
function collapseExtraBlankLines(s: string): string {
  return s.replace(/\n{3,}/g, "\n\n");
}

function formatDraftFieldValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x == null) return "";
        // Objects inside arrays hit this path — without the JSON.stringify
        // branch they collapse to "[object Object]" and the dialog shows
        // garbage. Arrays of objects SHOULD be routed to DraftFieldTable
        // above; this fallback is defensive for mixed/unexpected shapes.
        if (typeof x === "object") return JSON.stringify(x);
        return String(x);
      })
      .join("、");
  }
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return collapseExtraBlankLines(String(v));
}

/**
 * True when `v` is a non-empty array of plain objects — the shape we want to
 * render as a shadcn Table instead of a string. Catches storyboard rows
 * (`[{shot_no, scene, description, ...}, ...]`) without false-positiving on
 * arrays of primitives ("、"-joined strings is fine for those).
 */
function isObjectRowArray(v: unknown): v is Record<string, unknown>[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every((row) => row !== null && typeof row === "object" && !Array.isArray(row));
}

/** Union of column keys across all rows (row 0 first, then any extras). */
function collectRowColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        cols.push(key);
      }
    }
  }
  return cols;
}

/** Stringify one cell — objects get JSON, arrays get 、-joined, else String. */
function renderCellValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("、");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function DraftFieldTable({ rows }: { rows: Record<string, unknown>[] }) {
  const t = useTranslations("ai");
  const columns = collectRowColumns(rows);
  if (columns.length === 0) {
    return <div className="text-[12px] text-muted-foreground">{t("draftTableEmpty")}</div>;
  }
  return (
    <div className="rounded-md border border-border/60">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col}>{labelForDraftField(col)}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col} className="max-w-[240px] whitespace-pre-wrap break-words">
                  {renderCellValue(row[col])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// Show 2 rows (4 items) by default; collapse the rest behind a chevron.
const DRAFT_GRID_COLLAPSED_ITEMS = 4;

export function DraftSummary({
  drafts,
  t,
  onDraftUpdated,
}: {
  drafts: Draft[];
  t: (key: string, params?: Record<string, string | number>) => string;
  onDraftUpdated?: (draft: Draft) => void;
}) {
  const grouped = groupDraftsByType(drafts);
  const entries = Object.entries(grouped);
  if (entries.length === 0) {
    return (
      <div className="mt-2 text-[12px] text-muted-foreground">{t("workflowNoPendingDrafts")}</div>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-4">
      {entries.map(([type, items]) => (
        <DraftGroup key={type} type={type} items={items} t={t} onDraftUpdated={onDraftUpdated} />
      ))}
    </div>
  );
}

function DraftGroup({
  type,
  items,
  t,
  onDraftUpdated,
}: {
  type: string;
  items: Draft[];
  t: (key: string, params?: Record<string, string | number>) => string;
  onDraftUpdated?: (draft: Draft) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);

  const collapsible = items.length > DRAFT_GRID_COLLAPSED_ITEMS;
  const visibleItems =
    !collapsible || expanded ? items : items.slice(0, DRAFT_GRID_COLLAPSED_ITEMS);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] font-medium text-foreground/70">
        {t(`workflowEntity.${type}`)} · {items.length}
      </div>
      <div className="relative">
        <div className="grid grid-cols-2 gap-2">
          {visibleItems.map((d) => (
            <DraftCard key={d.clientRefId} draft={d} onClick={() => setActiveDraft(d)} />
          ))}
        </div>
        {collapsible && !expanded && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background via-background/80 to-transparent" />
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={t("draftTableExpandAll")}
              className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full border border-border/60 bg-card shadow-md transition-colors hover:bg-muted"
            >
              <IconChevronDown className="size-4" />
            </button>
          </>
        )}
        {collapsible && expanded && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={t("draftTableCollapseAll")}
              className="flex size-7 items-center justify-center rounded-full border border-border/60 bg-card transition-colors hover:bg-muted"
            >
              <IconChevronUp className="size-4" />
            </button>
          </div>
        )}
      </div>
      <DraftDetailDialog
        draft={activeDraft}
        open={activeDraft !== null}
        onOpenChange={(o) => {
          if (!o) setActiveDraft(null);
        }}
        onDraftUpdated={(next) => {
          setActiveDraft(next);
          onDraftUpdated?.(next);
        }}
      />
    </div>
  );
}

function DraftCard({ draft, onClick }: { draft: Draft; onClick: () => void }) {
  const { title, detail } = draftPreview(draft);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:bg-white/10"
    >
      <div className="line-clamp-1 text-[13px] font-medium text-foreground/90">{title}</div>
      {detail ? (
        <div className="line-clamp-3 whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </button>
  );
}

function DraftDetailDialog({
  draft,
  open,
  onOpenChange,
  onDraftUpdated,
}: {
  draft: Draft | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftUpdated?: (next: Draft) => void;
}) {
  const projectId = useAppSelector((s) => s.project.currentProjectId);
  const t = useTranslations("ai");

  const data = (draft?.data ?? {}) as Record<string, unknown>;
  const { title } = draft ? draftPreview(draft) : { title: "" };

  const entries = Object.entries(data)
    .filter(([k, v]) => {
      // `sortHint` is the agent-side 0-based index. Meaningful only for
      // episodes (rendered as 集数); plumbing for everything else.
      if (k === "sortHint") {
        return draft?.entityType === "episode" && typeof v === "number";
      }
      if (HIDDEN_DRAFT_FIELDS.has(k)) return false;
      if (v == null) return false;
      if (typeof v === "string") return v.trim().length > 0;
      if (Array.isArray(v)) return v.length > 0;
      return true;
    })
    .map(([k, v]): [string, unknown] => {
      // Shift to 1-based for display.
      if (k === "sortHint" && typeof v === "number") return [k, v + 1];
      return [k, v];
    })
    // Pin 集数 to the top — the rest keeps Java's natural order.
    .sort(([a], [b]) => (a === "sortHint" ? -1 : b === "sortHint" ? 1 : 0));

  const originalPrompt = String(data.prompt ?? "");
  const draftKey = `${draft?.clientRefId ?? "none"}:${open ? "open" : "closed"}`;
  const [promptState, setPromptState] = useState({ key: draftKey, value: originalPrompt });
  const [savingState, setSavingState] = useState({ key: draftKey, value: false });
  const editedPrompt = promptState.key === draftKey ? promptState.value : originalPrompt;
  const saving = savingState.key === draftKey ? savingState.value : false;
  const setSaving = (value: boolean) => setSavingState({ key: draftKey, value });

  const hasChanges = editedPrompt !== originalPrompt;

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (!draft || saving) return;
    if (!hasChanges) {
      onOpenChange(false);
      return;
    }
    if (!projectId) {
      toast.error(t("draftTableProjectIdMissing"));
      return;
    }
    setSaving(true);
    try {
      const updated = await updateDraftData(draft.runId, draft.clientRefId, projectId, {
        prompt: editedPrompt,
      });
      toast.success(t("draftTableSaved"));
      onDraftUpdated?.(updated);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        t("draftTableSaveFailed", { reason: err instanceof Error ? err.message : String(err) })
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Base DialogContent applies `sm:max-w-sm` (384px) which wins over an
          un-prefixed `max-w-*`, so we MUST use the sm: prefix here. Cap at
          680px — fits single-entity drafts comfortably and lets storyboard
          tables scroll horizontally rather than push the chat sidebar. */}
      <DialogContent className="sm:max-w-[min(92vw,680px)]">
        <DialogHeader>
          <DialogTitle>{title || "—"}</DialogTitle>
          <DialogDescription className="sr-only">{t("draftTableDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-4">
          {entries.map(([key, value]) => {
            const isPromptRow = key === "prompt";
            return (
              <div key={key} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {labelForDraftField(key)}
                  </div>
                </div>
                {isPromptRow ? (
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => setPromptState({ key: draftKey, value: e.target.value })}
                    disabled={saving}
                    className="min-h-[140px] w-full resize-y border-0 bg-transparent p-0 text-[13px] leading-relaxed text-foreground/90 focus:outline-none focus:ring-0 disabled:opacity-60"
                  />
                ) : isObjectRowArray(value) ? (
                  <DraftFieldTable rows={value} />
                ) : (
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                    {formatDraftFieldValue(value)}
                  </div>
                )}
              </div>
            );
          })}
          {entries.length === 0 && (
            <div className="text-[12px] text-muted-foreground">{t("draftTableNoFields")}</div>
          )}
        </div>

        <DialogFooter className="flex gap-2 border-t border-border p-4">
          <Button variant="outline" color="muted" onClick={handleCancel} disabled={saving}>
            {t("draftTableCancel")}
          </Button>
          <Button variant="solid" color="primary" onClick={handleSave} disabled={saving}>
            {saving && <IconLoader2 className="animate-spin" />}
            {saving ? t("draftTableSaving") : t("draftTableSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Default target episode count when the user jumps into episode_phase via a
// button AND the ProjectParamsForm value (client-side) isn't available
// (e.g. cleared localStorage + no Redux state). Normally overridden by the
// value the user picked in the form.
const DEFAULT_TARGET_EPISODE_COUNT = 10;

/**
 * Build the inputData payload for a button-triggered workflow dispatch
 * (retry / next-step / continue buttons).
 *
 * Layered resolution, in this order — later layers win:
 *   1. Workflow-specific minimum required scaffold (projectId, worldId, …)
 *   2. **Replay of the supervisor's previous `invoke_workflow` for this
 *      workflowName from chat history**, if any. This recovers fields the
 *      supervisor injected on the original dispatch — most importantly
 *      `textRef` for parse_script / story_outline, which the frontend has
 *      no other way to know about. Without this layer, retry buttons for
 *      these workflows fail with `text: Required` because the original
 *      attachment is forgotten the moment the supervisor's turn ends.
 *   3. Caller-supplied `feedback` (the user said "redo with X")
 *
 * Layer 2 is the single architectural fix for the "every retry button
 * sometimes silently drops fields" class of bugs. Adding a new
 * supervisor-injected field to a workflow's inputSchema no longer
 * requires a parallel frontend change — the replay covers it.
 */
export function buildInputData(
  workflowName: WorkflowName,
  ctx: { projectId: string; worldId?: string | null; targetEpisodeCount?: number | null },
  feedback?: string,
  messages?: AssistantMessage[]
): Record<string, unknown> {
  // Layer 2: replay the supervisor's last inputData for this workflow.
  // Strip projectId/worldId/episodeId — Mastra's `/workflow/start` route
  // re-injects them from the request context, and ctx is the source of
  // truth for the current selection (e.g. user switched worldId).
  const replay = messages ? findMostRecentInvokeInput(messages, workflowName) : undefined;
  const baseFromReplay: Record<string, unknown> = {};
  if (replay) {
    for (const [k, v] of Object.entries(replay)) {
      if (k === "projectId" || k === "worldId" || k === "episodeId") continue;
      baseFromReplay[k] = v;
    }
  }

  switch (workflowName) {
    case "role_phase":
    case "scene_phase":
    case "prop_phase":
      return {
        ...baseFromReplay,
        ...(ctx.worldId ? { worldId: ctx.worldId } : {}),
        ...(feedback ? { feedback } : {}),
      };
    case "role_image_phase":
    case "scene_image_phase":
    case "prop_image_phase":
      // No required inputs — workflow reads committed entries from Java.
      return { ...baseFromReplay, ...(feedback ? { feedback } : {}) };
    case "episode_phase":
      return {
        ...baseFromReplay,
        projectId: ctx.projectId,
        targetEpisodeCount:
          typeof ctx.targetEpisodeCount === "number" && ctx.targetEpisodeCount > 0
            ? ctx.targetEpisodeCount
            : typeof baseFromReplay.targetEpisodeCount === "number" &&
                baseFromReplay.targetEpisodeCount > 0
              ? (baseFromReplay.targetEpisodeCount as number)
              : DEFAULT_TARGET_EPISODE_COUNT,
        ...(feedback ? { feedback } : {}),
      };
    case "script_phase":
    case "storyboard_phase":
      return {
        ...baseFromReplay,
        projectId: ctx.projectId,
        ...(feedback ? { feedback } : {}),
      };
    case "parse_script":
    case "story_outline":
      // These two workflows REQUIRE `text` or `textRef` — supervisor
      // resolved that on first dispatch from the user's attachment. Layer
      // 2 (replay) is mandatory here; without it, retries fail with
      // `text: Required` / `no text provided and no committed episodes`.
      return {
        ...baseFromReplay,
        projectId: ctx.projectId,
        ...(feedback ? { feedback } : {}),
      };
    default:
      return { ...baseFromReplay, ...(feedback ? { feedback } : {}) };
  }
}
