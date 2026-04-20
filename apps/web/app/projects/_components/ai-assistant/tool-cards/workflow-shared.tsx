"use client";

import { useEffect, useState } from "react";
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
  IconWand,
} from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";
import { toast } from "sonner";
import { useAppSelector } from "@/src/store";
import { updateDraftData, type Draft, type WorkflowName } from "@/src/lib/workflow/workflow-client";
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

// ─── Display labels ────────────────────────────────────

export const WORKFLOW_LABEL_KEYS: Record<WorkflowName, string> = {
  main_flow: "workflowMainFlow",
  role_design: "workflowRoleDesign",
  scene_design: "workflowSceneDesign",
  prop_design: "workflowPropDesign",
  batch_create_asset: "workflowBatchCreate",
  script_edit: "workflowScriptEdit",
  story_outline: "workflowStoryOutline",
  role_phase: "workflowRolePhase",
  role_image_phase: "workflowRoleImagePhase",
  scene_phase: "workflowScenePhase",
  scene_image_phase: "workflowSceneImagePhase",
  prop_phase: "workflowPropPhase",
  prop_image_phase: "workflowPropImagePhase",
  episode_phase: "workflowEpisodePhase",
  script_phase: "workflowScriptPhase",
  storyboard_phase: "workflowStoryboardPhase",
};

interface WorkflowPersona {
  name: string;
  /** Tabler icon component — shown next to the persona name. */
  icon: Icon;
}

export const WORKFLOW_PERSONA: Record<WorkflowName, WorkflowPersona> = {
  main_flow: { name: "创作总监", icon: IconSparkles },
  story_outline: { name: "剧本统筹", icon: IconBook },
  role_design: { name: "角色设计师", icon: IconUsers },
  scene_design: { name: "场景设计师", icon: IconBuildingStore },
  prop_design: { name: "道具设计师", icon: IconPackage },
  role_phase: { name: "角色设计师", icon: IconUsers },
  role_image_phase: { name: "角色设计师", icon: IconPhoto },
  scene_phase: { name: "场景设计师", icon: IconBuildingStore },
  scene_image_phase: { name: "场景设计师", icon: IconPhoto },
  prop_phase: { name: "道具设计师", icon: IconPackage },
  prop_image_phase: { name: "道具设计师", icon: IconPhoto },
  episode_phase: { name: "剧集规划师", icon: IconLayoutList },
  script_phase: { name: "编剧", icon: IconPencil },
  storyboard_phase: { name: "分镜师", icon: IconCamera },
  batch_create_asset: { name: "资产录入", icon: IconPackage },
  script_edit: { name: "编剧", icon: IconPencil },
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
  const Icon = persona.icon;
  return (
    <div className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
      <Icon className="size-3.5 text-muted-foreground" />
      <span>{persona.name}</span>
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
              aria-label="展开全部"
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
            aria-label="收起"
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

// Chinese labels for common draft.data fields so the detail dialog reads
// naturally. Unknown keys fall back to the raw key name so we never hide
// data the user might care about.
const DRAFT_FIELD_LABELS: Record<string, string> = {
  name: "名称",
  title: "标题",
  roleName: "角色名",
  sceneName: "场景名",
  propName: "道具名",
  description: "描述",
  introduction: "简介",
  intro: "简介",
  summary: "摘要",
  prompt: "图像提示词",
  aliases: "别名",
  positioning: "定位",
  appearance: "外观",
  personality: "性格",
  background: "背景",
  voiceId: "音色",
  model: "模型",
  category: "类型",
  timeOfDay: "时间",
  setting: "环境",
  keyElements: "视觉锚点",
  lighting: "光线",
  atmosphere: "氛围",
  era: "年代",
  material: "材质",
  significance: "剧情意义",
  shot_no: "镜号",
  scene: "场景",
  image_prompt: "图像提示词",
  video_prompt: "视频提示词",
  movement: "运镜",
  shot_size: "景别",
  perspective: "视角",
  duration: "时长",
  dialogue: "对白",
  worldId: "世界 ID",
};

function labelForDraftField(key: string): string {
  return DRAFT_FIELD_LABELS[key] ?? key;
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
  return String(v);
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
  const columns = collectRowColumns(rows);
  if (columns.length === 0) {
    return <div className="text-[12px] text-muted-foreground">空表格</div>;
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
              aria-label="展开全部"
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
              aria-label="收起"
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

// Seedance 2.0 character-sheet template — appended in parens after the
// base prompt. Future: per-entityType templates (scene/prop) if we add
// equivalent Seedance recipes for those.
const SEEDANCE_CHARACTER_TEMPLATE =
  "8K超高清，皮肤肌理细致入微，毛孔极致细节，无动作，极具写实，影棚实拍真人质感。角色设计表，角色多角度转面参考图，补充视角组，正面视图、正侧面视图、背面视图、45度侧视图、俯视顶视图、仰视底视图，头部细节组(正脸、侧脸特写)，材质细节纹理研究组、布料纹理、鞋子的特写镜头，干净的纯白色背景，排版规整，带有文字标注，均匀光照，无阴影，白色背景，去除Ai塑料感，去除Ai味。";

function seedanceTemplateFor(entityType: string | undefined): string | null {
  if (entityType === "role") return SEEDANCE_CHARACTER_TEMPLATE;
  return null;
}

function buildSeedancePrompt(draft: Draft): string {
  const template = seedanceTemplateFor(draft.entityType);
  const base = String(((draft.data ?? {}) as Record<string, unknown>).prompt ?? "").trim();
  if (!template) return base;
  if (!base) return `(${template})`;
  return `${base} (${template})`;
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

  const data = (draft?.data ?? {}) as Record<string, unknown>;
  const { title } = draft ? draftPreview(draft) : { title: "" };

  const entries = Object.entries(data).filter(([, v]) => {
    if (v == null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });

  const hasPromptField = typeof data.prompt === "string";
  const hasSeedanceAction =
    !!draft && hasPromptField && seedanceTemplateFor(draft.entityType) !== null;
  const originalPrompt = String(data.prompt ?? "");

  const [editedPrompt, setEditedPrompt] = useState(originalPrompt);
  const [saving, setSaving] = useState(false);

  // Re-seed textarea whenever a different draft is opened.
  useEffect(() => {
    setEditedPrompt(String(((draft?.data ?? {}) as Record<string, unknown>).prompt ?? ""));
    setSaving(false);
  }, [draft?.clientRefId, open]);

  const hasChanges = editedPrompt !== originalPrompt;

  const handleSeedance = () => {
    if (!draft) return;
    setEditedPrompt(buildSeedancePrompt(draft));
  };

  const handleReset = () => {
    setEditedPrompt(originalPrompt);
  };

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
      toast.error("项目 ID 缺失，无法保存");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateDraftData(draft.runId, draft.clientRefId, projectId, {
        prompt: editedPrompt,
      });
      toast.success("已保存");
      onDraftUpdated?.(updated);
      onOpenChange(false);
    } catch (err) {
      toast.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Width scales with content: narrow for single-entity drafts (role /
          scene / prop), wide for storyboard drafts that carry a multi-column
          rows table. max-w-5xl keeps the table readable without pushing the
          sidebar panels off-screen. */}
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{title || "—"}</DialogTitle>
          <DialogDescription className="sr-only">草稿详情</DialogDescription>
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
                  {isPromptRow && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        color="muted"
                        size="xs"
                        onClick={handleReset}
                        disabled={!hasChanges || saving}
                      >
                        重置
                      </Button>
                      {hasSeedanceAction && (
                        <Button
                          variant="outline"
                          color="muted"
                          size="xs"
                          onClick={handleSeedance}
                          disabled={saving}
                        >
                          <IconWand />
                          生成 Seedance 2.0 提示词
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {isPromptRow ? (
                  <textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
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
            <div className="text-[12px] text-muted-foreground">此草稿暂无可展示字段。</div>
          )}
        </div>

        <DialogFooter className="flex gap-2 border-t border-border p-4">
          <Button variant="outline" color="muted" onClick={handleCancel} disabled={saving}>
            取消
          </Button>
          <Button variant="solid" color="primary" onClick={handleSave} disabled={saving}>
            {saving && <IconLoader2 className="animate-spin" />}
            {saving ? "保存中…" : "保存"}
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

export function buildInputData(
  workflowName: WorkflowName,
  ctx: { projectId: string; worldId?: string | null; targetEpisodeCount?: number | null },
  feedback?: string
): Record<string, unknown> {
  switch (workflowName) {
    case "role_phase":
    case "scene_phase":
    case "prop_phase":
      return {
        ...(ctx.worldId ? { worldId: ctx.worldId } : {}),
        ...(feedback ? { feedback } : {}),
      };
    case "role_image_phase":
    case "scene_image_phase":
    case "prop_image_phase":
      // No required inputs — workflow reads committed entries from Java.
      return feedback ? { feedback } : {};
    case "episode_phase":
      return {
        projectId: ctx.projectId,
        targetEpisodeCount:
          typeof ctx.targetEpisodeCount === "number" && ctx.targetEpisodeCount > 0
            ? ctx.targetEpisodeCount
            : DEFAULT_TARGET_EPISODE_COUNT,
        ...(feedback ? { feedback } : {}),
      };
    case "script_phase":
      return { projectId: ctx.projectId, ...(feedback ? { feedback } : {}) };
    case "storyboard_phase":
      return { projectId: ctx.projectId, ...(feedback ? { feedback } : {}) };
    default:
      return feedback ? { feedback } : {};
  }
}
