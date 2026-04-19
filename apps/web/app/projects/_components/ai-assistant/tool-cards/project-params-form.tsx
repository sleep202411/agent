"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IconArrowRight, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch, useAppSelector } from "@/src/store";
import {
  setDetail,
  selectCurrentInstance,
  type ProjectDetail,
} from "@/src/store/slices/projectSlice";
import { backendApi } from "@/src/lib/api";
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

/** True once aspect/length/style are all set — dialogLanguage not required
 * because Java doesn't persist it yet; once it does, add a check here. */
export function isProjectParamsComplete(detail: ProjectDetail | null | undefined): boolean {
  if (!detail) return false;
  return Boolean(
    detail.aspectRatioType &&
    typeof detail.chapterLength === "number" &&
    detail.chapterLength > 0 &&
    detail.stylePainting
  );
}

interface ProjectParamsFormProps {
  /** Called after the form is successfully submitted and Redux is refreshed. */
  onSubmitted: () => void;
}

export function ProjectParamsForm({ onSubmitted }: ProjectParamsFormProps) {
  const t = useTranslations("ai");
  const tp = useTranslations("project");
  const dispatch = useAppDispatch();
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const worldId = useAppSelector((s) => selectCurrentInstance(s).worldId);

  const [dictionaries, setDictionaries] = useState<ProjectDictionaries | null>(null);
  const [loadingDict, setLoadingDict] = useState(true);
  const [aspectRatioType, setAspectRatioType] = useState(detail?.aspectRatioType ?? "");
  const [chapterLength, setChapterLength] = useState<string>(
    detail?.chapterLength != null ? String(detail.chapterLength) : ""
  );
  const [stylePainting, setStylePainting] = useState(detail?.stylePainting ?? "");
  const [dialogLanguage, setDialogLanguage] = useState(detail?.dialogLanguage ?? "zh-CN");
  const [saving, setSaving] = useState(false);

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
  const canSubmit =
    !saving &&
    !loadingDict &&
    Boolean(aspectRatioType) &&
    Boolean(stylePainting) &&
    Boolean(chapterLength) &&
    Number.isFinite(chapterLengthNum) &&
    chapterLengthNum > 0;

  const handleSubmit = async () => {
    if (!detail?.id || !worldId) return;
    if (!canSubmit) {
      toast.error(t("paramsFormMissing"));
      return;
    }

    setSaving(true);
    const payload = {
      id: detail.id,
      worldId,
      name: detail.name,
      description: detail.description,
      type: detail.type,
      episode: detail.episode,
      imagePath: detail.imagePath,
      aspectRatioType,
      chapterLength: chapterLengthNum,
      stylePainting,
      // Java may ignore until schema lands; send eagerly so it persists the
      // moment the column is added.
      dialogLanguage,
    };

    try {
      await backendApi.post("/api/user/world/update/worldproduct", { data: payload });
      dispatch(
        setDetail({
          ...(detail ?? {}),
          aspectRatioType,
          chapterLength: chapterLengthNum,
          stylePainting,
          dialogLanguage,
        })
      );
      toast.success(tp("projectUpdateSuccess"));
      onSubmitted();
    } catch (err) {
      console.error("[ProjectParamsForm] save failed", err);
      toast.error(err instanceof Error ? err.message : tp("projectUpdateFailed"));
    } finally {
      setSaving(false);
    }
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
              disabled={loadingDict || saving}
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
        disabled={loadingDict || saving}
        onChange={(e) => setChapterLength(e.target.value.replace(/[^\d]/g, ""))}
        placeholder={tp("episodeDurationPlaceholder")}
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
              disabled={loadingDict || saving}
              className={cn(
                "relative flex w-20 shrink-0 flex-col items-center gap-1 rounded-xl bg-white/5 p-1.5 transition-opacity",
                loadingDict || saving ? "cursor-not-allowed" : "",
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
              disabled={loadingDict || saving}
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
        {saving && <IconLoader2 className="size-4 animate-spin" />}
        <span>{t("paramsFormSubmit")}</span>
        {!saving && <IconArrowRight className="size-4" />}
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

/**
 * Static read-only echo of the params the user just confirmed. Lives in the
 * chat stream so the decision stays visible in conversation history without
 * taking up as much space as the interactive form.
 */
export function ProjectParamsSummary() {
  const t = useTranslations("ai");
  const tp = useTranslations("project");
  const detail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const [dictionaries, setDictionaries] = useState<ProjectDictionaries | null>(null);

  useEffect(() => {
    let active = true;
    fetchProjectDictionaries()
      .then((d) => {
        if (active) setDictionaries(d);
      })
      .catch(() => {
        // Non-fatal — fall back to showing raw values below.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!detail) return null;

  const aspectLabel =
    dictionaries?.sizeOptions.find((o) => o.value === detail.aspectRatioType)?.label ??
    detail.aspectRatioType ??
    "—";
  const styleLabel =
    dictionaries?.styleOptions.find((s) => s.id === detail.stylePainting)?.info ??
    detail.stylePainting ??
    "—";
  const languageLabel = DIALOG_LANGUAGE_OPTIONS.find(
    (o) => o.value === detail.dialogLanguage
  )?.labelKey;
  const languageText = languageLabel ? t(languageLabel) : (detail.dialogLanguage ?? "—");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-foreground/90">
        <IconCheck className="size-3.5 text-primary" />
        {t("paramsGateConfirmed")}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <SummaryRow label={tp("videoSize")} value={aspectLabel} />
        <SummaryRow
          label={tp("episodeDuration")}
          value={detail.chapterLength != null ? String(detail.chapterLength) : "—"}
        />
        <SummaryRow label={tp("artStyle")} value={styleLabel} />
        <SummaryRow label={t("paramsDialogLanguage")} value={languageText} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-foreground/90">{value}</span>
    </div>
  );
}
