"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IconArrowRight } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppSelector } from "@/src/store";
import { selectCurrentInstance, type ProjectDetail } from "@/src/store/slices/projectSlice";
import type { ConfirmProjectParamsPayload } from "@/src/lib/assistant/assistant-client";
import { fetchProjectDictionaries } from "@/src/lib/project-dictionaries";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import type { ProjectDictionaries } from "@/src/types/workspace";

const DIALOG_LANGUAGE_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: "zh-CN", labelKey: "paramsDialogLanguageSimplifiedChinese" },
  { value: "zh-HK", labelKey: "paramsDialogLanguageTraditionalChinese" },
  { value: "en-US", labelKey: "paramsDialogLanguageEnglish" },
];

/**
 * Compute a proportional preview box from the dictionary label (e.g. "16:9",
 * "9:16", "21:9"). Falls back to a square if the label isn't parseable so
 * new enums Java adds later still render. Max dimension is clamped to 30px
 * so cards stay tidy in a row.
 */
const MAX_PREVIEW_DIM = 30;
function getAspectPreview(label: string): { w: number; h: number } {
  const match = label.match(/^(\d+(?:\.\d+)?)\s*[:xX]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return { w: 24, h: 24 };
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { w: 24, h: 24 };
  }
  const scale = MAX_PREVIEW_DIM / Math.max(w, h);
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

const EPISODE_COUNT_STORAGE_KEY = (projectId: string) => `fizzos:episode-count:${projectId}`;
const DIALOG_LANGUAGE_STORAGE_KEY = (projectId: string) => `fizzos:dialog-language:${projectId}`;
const EPISODE_COUNT_MIN = 2;
const EPISODE_COUNT_MAX = 40;

export function loadEpisodeCount(projectId: string): number | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(EPISODE_COUNT_STORAGE_KEY(projectId));
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < EPISODE_COUNT_MIN || n > EPISODE_COUNT_MAX) {
      return undefined;
    }
    return n;
  } catch {
    return undefined;
  }
}

export function saveEpisodeCount(projectId: string, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EPISODE_COUNT_STORAGE_KEY(projectId), String(value));
  } catch {
    // storage quota / private mode — not fatal, just lose the value on reload
  }
}

/**
 * Load the project's chosen dialog language (zh-CN / zh-HK / en-US). Falls
 * back to undefined if nothing's stored. Currently NOT persisted by Java —
 * ProjectParamsForm keeps the authoritative copy in localStorage so all
 * downstream workflow invocations can route the value through
 * workspaceContext.dialogLanguage.
 */
export function loadDialogLanguage(projectId: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(DIALOG_LANGUAGE_STORAGE_KEY(projectId));
    return raw && raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function saveDialogLanguage(projectId: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DIALOG_LANGUAGE_STORAGE_KEY(projectId), value);
  } catch {}
}

/** True once aspect/length/style + episode count are all set. Mirror of
 * `isProjectParamsComplete` in `packages/shared/src/project-params.ts` — web
 * app deliberately doesn't depend on @repo/shared, so keep both in sync when
 * changing the rule. */
export function isProjectParamsComplete(detail: ProjectDetail | null | undefined): boolean {
  if (!detail) return false;
  return Boolean(
    detail.aspectRatioType &&
    typeof detail.chapterLength === "number" &&
    detail.chapterLength > 0 &&
    detail.stylePainting &&
    typeof detail.targetEpisodeCount === "number" &&
    detail.targetEpisodeCount >= EPISODE_COUNT_MIN
  );
}

interface ProjectParamsFormProps {
  /**
   * Called when the user clicks "儲存並繼續". Receives the collected params.
   * The form itself no longer writes to Java — the parent (tool card) hands
   * the payload off to the agent, and Nest owns the persistence step.
   */
  onSubmitted?: (params: ConfirmProjectParamsPayload) => void;
  /**
   * When true, all inputs and the submit button are disabled. Used to keep
   * the form visible in chat history after submission without allowing edits
   * (so the decision stays anchored to where it was made).
   */
  readOnly?: boolean;
}

export function ProjectParamsForm({ onSubmitted, readOnly = false }: ProjectParamsFormProps) {
  const t = useTranslations("ai");
  const tp = useTranslations("project");
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);

  const [dictionaries, setDictionaries] = useState<ProjectDictionaries | null>(null);
  const [loadingDict, setLoadingDict] = useState(true);
  const [aspectRatioType, setAspectRatioType] = useState(detail?.aspectRatioType ?? "");
  const [chapterLength, setChapterLength] = useState<string>(
    detail?.chapterLength != null ? String(detail.chapterLength) : ""
  );
  const [stylePainting, setStylePainting] = useState(detail?.stylePainting ?? "");
  const [dialogLanguage, setDialogLanguage] = useState(detail?.dialogLanguage ?? "zh-CN");
  const [episodeCount, setEpisodeCount] = useState<string>(() => {
    if (detail?.targetEpisodeCount != null) return String(detail.targetEpisodeCount);
    const stored = detail?.id ? loadEpisodeCount(detail.id) : undefined;
    return stored != null ? String(stored) : "";
  });

  useEffect(() => {
    let active = true;
    setLoadingDict(true);
    fetchProjectDictionaries()
      .then((d) => {
        if (active) setDictionaries(d);
      })
      .catch((err) => {
        console.error("[ProjectParamsForm] load dictionaries failed", err);
        if (active) toast.error(tp("loadConfigFailed"));
      })
      .finally(() => {
        if (active) setLoadingDict(false);
      });
    return () => {
      active = false;
    };
  }, [tp]);

  const chapterLengthNum = Number(chapterLength);
  const episodeCountNum = Number(episodeCount);
  const episodeCountValid =
    Number.isFinite(episodeCountNum) &&
    episodeCountNum >= EPISODE_COUNT_MIN &&
    episodeCountNum <= EPISODE_COUNT_MAX;
  const canSubmit =
    !readOnly &&
    !loadingDict &&
    Boolean(aspectRatioType) &&
    Boolean(stylePainting) &&
    Boolean(chapterLength) &&
    Number.isFinite(chapterLengthNum) &&
    chapterLengthNum > 0 &&
    episodeCountValid;
  const controlsDisabled = loadingDict || readOnly;

  const handleSubmit = () => {
    if (!canSubmit) {
      toast.error(t("paramsFormMissing"));
      return;
    }
    if (detail?.id) {
      saveEpisodeCount(detail.id, episodeCountNum);
      saveDialogLanguage(detail.id, dialogLanguage);
    }
    onSubmitted?.({
      aspectRatioType,
      chapterLength: chapterLengthNum,
      stylePainting,
      dialogLanguage,
      targetEpisodeCount: episodeCountNum,
    });
  };

  const selectedStyle = dictionaries?.styleOptions.find((s) => s.id === stylePainting);

  return (
    <div className="mt-2 flex flex-col">
      <div className="text-[13px] text-muted-foreground">{t("paramsFormHint")}</div>

      {/* 影片尺寸 */}
      <SectionTitle>{tp("videoSize")}</SectionTitle>
      <CardRow>
        {dictionaries?.sizeOptions.map((opt) => {
          const { w, h } = getAspectPreview(opt.label);
          const selected = aspectRatioType === opt.value;
          return (
            <CardPick
              key={opt.value}
              selected={selected}
              disabled={controlsDisabled}
              onClick={() => setAspectRatioType(opt.value)}
            >
              <div className="mb-1.5 flex h-7 items-center justify-center">
                <div
                  className="rounded-[3px] bg-gradient-to-br from-primary-hover to-primary"
                  style={{ width: `${w}px`, height: `${h}px` }}
                />
              </div>
              <div className="text-[13px] font-semibold text-foreground/90">{opt.label}</div>
            </CardPick>
          );
        })}
      </CardRow>

      {/* 单集时长 */}
      <SectionTitle>{tp("episodeDuration")}</SectionTitle>
      <Input
        value={chapterLength}
        inputMode="numeric"
        maxLength={4}
        disabled={controlsDisabled}
        onChange={(e) => setChapterLength(e.target.value.replace(/[^\d]/g, ""))}
        placeholder={tp("episodeDurationPlaceholder")}
        className="h-10 rounded-xl border-0 bg-white/5 text-[13px] focus-visible:ring-1 focus-visible:ring-primary"
      />

      {/* 剧集数量 */}
      <SectionTitle>{t("paramsEpisodeCount")}</SectionTitle>
      <Input
        value={episodeCount}
        inputMode="numeric"
        maxLength={2}
        disabled={controlsDisabled}
        onChange={(e) => setEpisodeCount(e.target.value.replace(/[^\d]/g, ""))}
        placeholder={t("paramsEpisodeCountPlaceholder", {
          min: EPISODE_COUNT_MIN,
          max: EPISODE_COUNT_MAX,
        })}
        className="h-10 rounded-xl border-0 bg-white/5 text-[13px] focus-visible:ring-1 focus-visible:ring-primary"
      />

      {/* 画风 */}
      <SectionTitle>{tp("artStyle")}</SectionTitle>
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {dictionaries?.styleOptions.map((opt) => {
          const selected = stylePainting === opt.id;
          const thumb = buildOssUrl(opt.picLink);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setStylePainting(opt.id)}
              disabled={controlsDisabled}
              className={cn(
                "relative flex w-20 shrink-0 flex-col items-center gap-1 rounded-xl bg-white/5 p-1.5 transition-opacity",
                controlsDisabled ? "cursor-not-allowed" : "",
                selected ? "opacity-100" : "opacity-50 hover:opacity-80"
              )}
            >
              {selected && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xl border border-primary"
                />
              )}
              <div className="relative aspect-square w-full overflow-hidden rounded-md bg-muted">
                {thumb ? (
                  <img src={thumb} alt={opt.info ?? ""} className="size-full object-cover" />
                ) : null}
              </div>
              <div className="line-clamp-1 w-full text-center text-[11px] font-medium text-foreground/90">
                {opt.info ?? opt.id}
              </div>
            </button>
          );
        })}
      </div>
      {selectedStyle?.info && (
        <div className="mt-1 text-[11px] text-muted-foreground">{selectedStyle.info}</div>
      )}

      {/* 对白语言 */}
      <SectionTitle>{t("paramsDialogLanguage")}</SectionTitle>
      <CardRow>
        {DIALOG_LANGUAGE_OPTIONS.map((opt) => {
          const selected = dialogLanguage === opt.value;
          return (
            <CardPick
              key={opt.value}
              selected={selected}
              disabled={controlsDisabled}
              onClick={() => setDialogLanguage(opt.value)}
              compact
            >
              <div className="text-[13px] font-semibold text-foreground/90">{t(opt.labelKey)}</div>
            </CardPick>
          );
        })}
      </CardRow>

      {/* Confirm */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={cn(
          "mt-4 flex h-11 w-full items-center justify-center gap-1.5 rounded-2xl text-[14px] font-semibold text-primary-foreground transition-colors",
          "bg-primary hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-50"
        )}
      >
        <span>{t("paramsFormSubmit")}</span>
        <IconArrowRight className="size-4" />
      </button>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="mt-3.5 mb-2 text-[14px] font-semibold text-foreground">{children}</div>;
}

function CardRow({ children }: { children: ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
}

function CardPick({
  children,
  selected,
  disabled,
  onClick,
  compact,
}: {
  children: ReactNode;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative flex flex-1 flex-col items-center justify-center rounded-xl bg-white/5 transition-opacity",
        compact ? "px-2 py-2.5" : "px-3 py-3",
        disabled && "cursor-not-allowed",
        selected ? "opacity-100" : "opacity-50 hover:opacity-80"
      )}
    >
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl border border-primary"
        />
      )}
      {children}
    </button>
  );
}
