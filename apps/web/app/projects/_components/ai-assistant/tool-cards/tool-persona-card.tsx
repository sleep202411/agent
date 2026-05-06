"use client";

import { useCallback, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  IconLoader2,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconMinus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { markdownComponents } from "../markdown-components";
import {
  getPersonaFromToolName,
  PERSONA_TONE_CLASSES,
  type AssistantPersonaMeta,
} from "@/src/lib/assistant/personas";
import type { AssistantToolInvocation } from "@/src/lib/assistant/assistant-types";

interface AskPersonaInput {
  task?: string;
}

interface AskPersonaOutput {
  persona?: string;
  /** Markdown prose for the user. */
  summary?: string;
  /**
   * Structured fields for supervisor's commit step. Open-ended on
   * purpose — each persona returns its own shape (episode_planner →
   * `{episodes:[…]}`, storyboarder → `{rows:[…]}`, character/scene/
   * prop designers → `{name, description, prompt}`, scriptwriter →
   * `{content:"…"}`). The card renders whatever it can detect.
   */
  fields?: Record<string, unknown> | null;
  tookMs?: number;
  contextBytes?: number;
  error?: string;
}

interface ToolPersonaCardProps {
  toolName: string;
  part: AssistantToolInvocation;
}

/**
 * Renders an ask_* tool invocation as a persona-attributed card:
 * avatar badge + question + reply. Users can tell at a glance which
 * crew role answered, instead of seeing an opaque `tool-ask_xxx` line.
 */
export function ToolPersonaCard({ toolName, part }: ToolPersonaCardProps) {
  const t = useTranslations("ai");
  const persona = getPersonaFromToolName(toolName);

  if (!persona) return null;

  const input = part.input as AskPersonaInput | undefined;
  const output = part.output as AskPersonaOutput | undefined;

  const isConsulting =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state !== "output-available" &&
      part.state !== "output-error" &&
      part.state !== "output-denied");

  const hasError = Boolean(output?.error) || part.state === "output-error";
  const summary = output?.summary ?? "";
  const task = input?.task ?? "";
  const fields = output?.fields ?? null;

  return (
    <PersonaCard
      persona={persona}
      isConsulting={isConsulting}
      hasError={hasError}
      task={task}
      summary={summary}
      fields={fields}
      error={output?.error ?? part.errorText}
      tookMs={output?.tookMs}
      t={t}
    />
  );
}

interface PersonaCardInnerProps {
  persona: AssistantPersonaMeta;
  isConsulting: boolean;
  hasError: boolean;
  task: string;
  summary: string;
  fields: Record<string, unknown> | null;
  error?: string;
  tookMs?: number;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function PersonaCard({
  persona,
  isConsulting,
  hasError,
  task,
  summary,
  fields,
  error,
  tookMs,
  t,
}: PersonaCardInnerProps) {
  const [expanded, setExpanded] = useState(true);
  const pillClass = PERSONA_TONE_CLASSES[persona.tone];
  const displayName = t(`personas.${persona.nameKey}`);

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-[13px]">
      {/* Persona pill + status row */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-medium",
            pillClass
          )}
        >
          <persona.icon className="size-3.5" />
          {displayName}
        </span>

        {isConsulting ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <IconLoader2 className="size-3 animate-spin" />
            {t("personaConsulting")}
          </span>
        ) : hasError ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
            <IconMinus className="size-3 text-muted-foreground/40" />
            {t("personaError")}
          </span>
        ) : (
          <>
            {typeof tookMs === "number" && tookMs > 0 && (
              <span className="text-[11px] text-muted-foreground/60">
                {(tookMs / 1000).toFixed(1)}s
              </span>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {expanded ? t("personaCollapse") : t("personaExpand")}
              {expanded ? (
                <IconChevronUp className="size-3" />
              ) : (
                <IconChevronDown className="size-3" />
              )}
            </button>
          </>
        )}
      </div>

      {task && (
        <div className="mt-1.5 text-[12px] text-muted-foreground">
          <span className="opacity-70">{t("personaTask")}：</span>
          <span className="italic">{task}</span>
        </div>
      )}

      {hasError && <PersonaErrorRow rawError={typeof error === "string" ? error : ""} />}

      {!hasError && summary && expanded && (
        <div className="mt-2 border-t border-border/40 pt-2 text-[13px] leading-relaxed text-foreground/90">
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {summary}
          </Markdown>
        </div>
      )}

      {!hasError && expanded && <FieldsPreview fields={fields} />}
    </div>
  );
}

// ─── Fields preview ─────────────────────────────────────────────────
//
// Renders persona's `fields` so the user can review what's about to be
// committed BEFORE clicking the save button. Without this, "save 8
// episodes" was a leap of faith — fields was 2 KB of episode outlines
// the user never saw. Branches on the most-specific shape we can
// detect (episodes array → titled list, rows array → shot table, single
// asset record → key-value list, script content → markdown body),
// falling back to a JSON dump for unknown shapes (so the user at least
// knows there IS data, even if we don't have a custom view yet).

interface FieldsPreviewProps {
  fields: Record<string, unknown> | null;
}

function FieldsPreview({ fields }: FieldsPreviewProps) {
  if (!fields || Object.keys(fields).length === 0) return null;

  const episodes = pickArrayOf<EpisodeItem>(fields.episodes, isEpisodeItem);
  if (episodes) return <EpisodesPreview items={episodes} />;

  const rows = pickArrayOf<StoryboardRow>(fields.rows, isStoryboardRow);
  if (rows) return <StoryboardPreview rows={rows} />;

  const items = pickArrayOf<AssetItem>(fields.items, isAssetItem);
  if (items) return <AssetItemsPreview items={items} />;

  const content = typeof fields.content === "string" ? fields.content : null;
  if (content) return <ScriptContentPreview content={content} />;

  if (isAssetItem(fields)) return <AssetItemsPreview items={[fields]} />;

  // Unknown shape — show keys so the user at least knows fields was
  // populated and the save button isn't going to act on `{}`.
  return (
    <div className="mt-2 rounded-md border border-border/40 bg-background/40 px-2 py-1.5 text-[11px] text-muted-foreground">
      Generated keys: {Object.keys(fields).join(", ")}
    </div>
  );
}

interface EpisodeItem {
  title: string;
  introduction?: string;
  frontPrompt?: string;
  behindPrompt?: string;
}
function isEpisodeItem(v: unknown): v is EpisodeItem {
  return typeof v === "object" && v !== null && typeof (v as EpisodeItem).title === "string";
}
function EpisodesPreview({ items }: { items: EpisodeItem[] }) {
  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {items.length} episodes
      </div>
      <ol className="space-y-1.5">
        {items.map((ep, i) => (
          <li key={i} className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5">
            <div className="text-[12px] font-semibold text-foreground/90">{ep.title}</div>
            {ep.introduction && (
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {ep.introduction}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface StoryboardRow {
  shot_no?: string | number;
  scene?: string;
  description?: string;
  dialogue?: string;
  shot_size?: string;
  perspective?: string;
  movement?: string;
  duration?: number | string;
  image_prompt?: string;
}
function isStoryboardRow(v: unknown): v is StoryboardRow {
  if (typeof v !== "object" || v === null) return false;
  const r = v as StoryboardRow;
  return typeof r.description === "string" && r.description.length > 0;
}
function StoryboardPreview({ rows }: { rows: StoryboardRow[] }) {
  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {rows.length} shots
      </div>
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5">
            <div className="flex items-baseline gap-1.5 text-[12px]">
              <span className="font-semibold text-foreground/90">#{r.shot_no ?? i + 1}</span>
              {r.scene && <span className="text-muted-foreground/80">· {r.scene}</span>}
              {(r.shot_size || r.perspective || r.movement) && (
                <span className="text-muted-foreground/60">
                  · {[r.shot_size, r.perspective, r.movement].filter(Boolean).join(" / ")}
                </span>
              )}
              {typeof r.duration !== "undefined" && (
                <span className="ml-auto text-[10.5px] text-muted-foreground/60">
                  {r.duration}s
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {r.description}
            </p>
            {r.dialogue && (
              <p className="mt-0.5 text-[11.5px] italic text-muted-foreground/80">
                「{r.dialogue}」
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface AssetItem {
  name: string;
  description?: string;
  prompt?: string;
  role?: string;
  appearance?: string;
  personality?: string;
  category?: string;
}
function isAssetItem(v: unknown): v is AssetItem {
  if (typeof v !== "object" || v === null) return false;
  return typeof (v as AssetItem).name === "string" && (v as AssetItem).name.length > 0;
}
function AssetItemsPreview({ items }: { items: AssetItem[] }) {
  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      {items.length > 1 && (
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {items.length} items
        </div>
      )}
      <div className="space-y-2">
        {items.map((a, i) => (
          <div key={i} className="rounded-md border border-border/30 bg-background/30 px-2 py-1.5">
            <div className="text-[12px] font-semibold text-foreground/90">
              {a.name}
              {a.role && (
                <span className="ml-1.5 text-[11px] text-muted-foreground/70">· {a.role}</span>
              )}
              {a.category && (
                <span className="ml-1.5 text-[11px] text-muted-foreground/70">· {a.category}</span>
              )}
            </div>
            {a.description && (
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                {a.description}
              </p>
            )}
            {a.appearance && (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground/80">
                <span className="text-muted-foreground/60">外观：</span>
                {a.appearance}
              </p>
            )}
            {a.personality && (
              <p className="mt-0.5 text-[11.5px] text-muted-foreground/80">
                <span className="text-muted-foreground/60">性格：</span>
                {a.personality}
              </p>
            )}
            {a.prompt && (
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground/60">
                <span className="text-muted-foreground/40">prompt：</span>
                {a.prompt}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScriptContentPreview({ content }: { content: string }) {
  return (
    <div className="mt-2 border-t border-border/40 pt-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Script body · {content.length} chars
      </div>
      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/30 bg-background/30 px-2 py-1.5 text-[11.5px] leading-relaxed text-foreground/85">
        {content}
      </pre>
    </div>
  );
}

function pickArrayOf<T>(value: unknown, guard: (v: unknown) => v is T): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every(guard) ? (value as T[]) : null;
}

// Friendly inline error indicator with copy-details affordance —
// matches ToolIndicator's failed-tool style. Persona timeouts /
// malformed structured outputs are common (DeepSeek under heavy
// schema pressure); raw "<root> Required" type messages are noise
// to the user but valuable for debugging via copy.
function PersonaErrorRow({ rawError }: { rawError: string }) {
  const t = useTranslations("ai");
  const copy = useCallback(() => {
    if (!rawError) return;
    void navigator.clipboard.writeText(rawError).then(
      () => toast.success(t("toolErrorCopied")),
      () => toast.error(t("toolErrorCopyFailed"))
    );
  }, [rawError, t]);

  return (
    <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground/60">
      <IconMinus className="size-3 text-muted-foreground/40" />
      <span>{t("toolErrorFriendly")}</span>
      {rawError && (
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/50 transition-colors hover:bg-white/8 hover:text-muted-foreground"
          title={t("toolErrorCopyHint")}
        >
          <IconCopy className="size-3" />
          {t("toolErrorCopy")}
        </button>
      )}
    </div>
  );
}
