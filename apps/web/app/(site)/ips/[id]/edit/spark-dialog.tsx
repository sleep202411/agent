"use client";

/**
 * Spark dialog — AI-assisted IP edit. Mirrors `create-ip-dialog` so the
 * two flows feel like the same surface: dropzone + 3 form fields with
 * `AI-suggested` pills, single Apply button.
 *
 * Differences from create:
 *   - Acts on an existing project (POST /project/update via useUpdateProject)
 *   - The Spark backend (`/aurora/spark/analyze`) returns `tags?: string[]`
 *     too — we silently match those names against the platform tag
 *     catalog and submit the matched ids on Apply. No tag UI is shown.
 *   - Empty fields are skipped on submit so opening Spark and applying
 *     without filling something doesn't blank an existing value.
 */

import { useLayoutEffect, useRef, useState } from "react";
import {
  IconCloudUpload,
  IconFileText,
  IconLoader2,
  IconRefresh,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { AiSuggestedChip } from "@/components/ui/ai-suggested-chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import {
  SPARK_MAX_BYTES,
  useIPTagList,
  useSparkAnalyze,
  useUpdateProject,
} from "@/app/(site)/ips/_hooks/use-ip";
import { useIPTypes } from "@/app/(site)/ips/_hooks/use-ip-list";

const SPARK_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月30日 12_47_51.png"
);

const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".md"];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

type AnalyzeStatus = "idle" | "analyzing" | "success" | "error";
type AiField = "name" | "typeId" | "description";

interface SparkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s　]/g, "");
}

function bytesToMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

export function SparkDialog(props: SparkDialogProps) {
  const { user } = useCurrentUser();
  return <SparkDialogContent key={JSON.stringify([user?.id, props.projectId])} {...props} />;
}
function SparkDialogContent({ open, onOpenChange, projectId }: SparkDialogProps) {
  const t = useTranslations("ipEdit");
  // Dropzone + AI-pill copy is shared with the create dialog (same UX
  // element, identical strings) — read those keys from the ipCreate
  // namespace rather than duplicating them under ipEdit.
  const tc = useTranslations("ipCreate");

  const [name, setNameState] = useState("");
  const nameRef = useRef("");
  const setName = (value: string) => {
    nameRef.current = value;
    setNameState(value);
  };
  const [typeId, setTypeId] = useState("");
  const [description, setDescriptionState] = useState("");
  const descriptionRef = useRef("");
  const setDescription = (value: string) => {
    descriptionRef.current = value;
    setDescriptionState(value);
  };
  const [tagIds, setTagIds] = useState<number[]>([]);

  const [analyzeStatus, setAnalyzeStatus] = useState<AnalyzeStatus>("idle");
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzedFileName, setAnalyzedFileName] = useState("");
  const [aiFilledFields, setAiFilledFields] = useState<Set<AiField>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyze = useSparkAnalyze();
  const update = useUpdateProject();
  const { data: typeList = [] } = useIPTypes();
  const { data: tagCatalog = [] } = useIPTagList();

  const [openScope, setOpenScope] = useState({ open });
  if (openScope.open !== open) {
    setOpenScope({ open });
    setNameState("");
    setTypeId("");
    setDescriptionState("");
    setTagIds([]);
    setAnalyzeStatus("idle");
    setAnalyzedFileName("");
    setAiFilledFields(new Set());
    setDragOver(false);
  }

  const active = useRef(false);
  const operation = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    active.current = openScope.open;
    nameRef.current = "";
    descriptionRef.current = "";
    return () => {
      active.current = false;
      operation.current?.abort();
      operation.current = null;
    };
  }, [openScope]);

  const markAi = (field: AiField) => {
    setAiFilledFields((prev) => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  };
  const clearAi = (field: AiField) => {
    setAiFilledFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  const validateFile = (file: File): string | null => {
    if (file.size > SPARK_MAX_BYTES) {
      return t("sparkFileTooLarge", { mb: bytesToMB(SPARK_MAX_BYTES) });
    }
    const lower = file.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return tc("fileTypeUnsupported");
    }
    return null;
  };

  const handleFile = async (file: File) => {
    if (!active.current || operation.current) return;
    const validationError = validateFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const request = new AbortController();
    operation.current = request;
    setAnalyzedFileName(file.name);
    setAnalyzeStatus("analyzing");
    setAnalyzeError(null);

    try {
      const result = await analyze.mutateAsync({ file, signal: request.signal });
      if (!active.current || request.signal.aborted || operation.current !== request) return;
      // Apply only fields the AI returned, and only if the user hasn't
      // already typed something in. Don't overwrite manual edits.
      if (result.name && !nameRef.current.trim()) {
        setName(result.name);
        markAi("name");
      }
      if (result.description && !descriptionRef.current.trim()) {
        setDescription(result.description);
        markAi("description");
      }
      // Tag matching is silent — pick catalog ids whose names match
      // any of the AI's free-form proposals; saved on Apply, never shown.
      const matched = new Set<number>();
      for (const proposed of result.tags ?? []) {
        const norm = normalize(proposed);
        for (const tag of tagCatalog) {
          if (normalize(tag.name) === norm) matched.add(tag.id);
        }
      }
      setTagIds(Array.from(matched));
      setAnalyzeStatus("success");
    } catch (error) {
      if (active.current && !request.signal.aborted && operation.current === request) {
        setAnalyzeError(error instanceof Error ? error.message : null);
        setAnalyzeStatus("error");
      }
    } finally {
      if (operation.current === request) operation.current = null;
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleClearAnalysis = () => {
    if (update.isPending) return;
    operation.current?.abort();
    operation.current = null;
    setAnalyzeStatus("idle");
    setAnalyzedFileName("");
    if (aiFilledFields.has("name")) setName("");
    if (aiFilledFields.has("typeId")) setTypeId("");
    if (aiFilledFields.has("description")) setDescription("");
    setAiFilledFields(new Set());
    setTagIds([]);
  };

  const handleApply = async () => {
    if (!active.current || operation.current) return;
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    // Skip blank fields so we don't accidentally clear backend values
    // the user never touched in this Spark session.
    const payload: Parameters<typeof update.mutateAsync>[0] = { id: Number(projectId) };
    if (trimmedName) payload.name = trimmedName;
    if (typeId) payload.typeId = typeId;
    if (trimmedDesc) payload.description = trimmedDesc;
    if (tagIds.length > 0) payload.tag = JSON.stringify(tagIds);
    if (Object.keys(payload).length === 1) {
      toast.warning(t("sparkNothingToApply"));
      return;
    }
    const request = new AbortController();
    operation.current = request;
    try {
      await update.mutateAsync(payload);
      if (!active.current || request.signal.aborted || operation.current !== request) return;
      toast.success(t("sparkApplied"));
      onOpenChange(false);
    } catch (err) {
      if (!active.current || request.signal.aborted || operation.current !== request) return;
      toast.error(err instanceof Error && err.message ? err.message : t("saveFailed"));
    } finally {
      if (operation.current === request) operation.current = null;
    }
  };

  const applying = update.isPending;
  const hasContent = !!(name.trim() || typeId || description.trim() || tagIds.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={SPARK_HERO_URL}
          eyebrow={t("spark")}
          title={t("sparkDialogTitle")}
          description={t("sparkDialogDescription")}
        />

        <div className="space-y-4 p-4">
          <Dropzone
            status={analyzeStatus}
            errorMessage={analyzeError}
            dragOver={dragOver}
            fileName={analyzedFileName}
            t={tc}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onBrowse={() => fileInputRef.current?.click()}
            onClear={handleClearAnalysis}
            onRetry={() => {
              setAnalyzeStatus("idle");
              fileInputRef.current?.click();
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />

          <Field>
            <FieldLabel>
              {t("sparkFieldName")}
              {aiFilledFields.has("name") && <AiSuggestedChip label={tc("aiSuggested")} />}
            </FieldLabel>
            <Input
              disabled={applying}
              value={name}
              onChange={(e) => {
                setName(e.target.value.slice(0, 80));
                clearAi("name");
              }}
            />
          </Field>

          <Field>
            <FieldLabel>
              {t("sparkFieldCategory")}
              {aiFilledFields.has("typeId") && <AiSuggestedChip label={tc("aiSuggested")} />}
            </FieldLabel>
            <Select
              disabled={applying}
              value={typeId}
              onValueChange={(v) => {
                setTypeId(v);
                clearAi("typeId");
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("sparkFieldCategoryPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {typeList.map((tp) => (
                  <SelectItem key={tp.id} value={String(tp.id)}>
                    {tp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>
              {t("sparkFieldDescription")}
              {aiFilledFields.has("description") && <AiSuggestedChip label={tc("aiSuggested")} />}
            </FieldLabel>
            <Textarea
              disabled={applying}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value.slice(0, 500));
                clearAi("description");
              }}
              rows={3}
            />
          </Field>

          <Button
            onClick={handleApply}
            disabled={applying || analyzeStatus === "analyzing" || !hasContent}
            className="w-full"
          >
            {applying ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconSparkles className="size-3.5" />
            )}
            {t("sparkApply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Helpers ──────────────────────────────────────────

interface DropzoneProps {
  status: AnalyzeStatus;
  errorMessage: string | null;
  dragOver: boolean;
  fileName: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onBrowse: () => void;
  onClear: () => void;
  onRetry: () => void;
}

function Dropzone({
  status,
  errorMessage,
  dragOver,
  fileName,
  t,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onBrowse,
  onClear,
  onRetry,
}: DropzoneProps) {
  if (status === "success") {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2.5">
        <IconSparkles className="size-4 shrink-0 text-emerald-300" />
        <span className="min-w-0 flex-1 truncate text-xs text-emerald-200">
          {t("dropzoneSuccess", { name: fileName })}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded p-1 text-emerald-300/70 transition-colors hover:bg-emerald-400/15 hover:text-emerald-200"
          aria-label={t("dropzoneClear")}
        >
          <IconX className="size-3.5" />
        </button>
      </div>
    );
  }

  if (status === "analyzing") {
    return (
      <div className="rounded-xl border border-violet-400/30 bg-violet-400/5 px-4 py-4 text-center">
        <div className="mx-auto mb-2 flex size-9 items-center justify-center rounded-full bg-violet-400/15">
          <IconLoader2 className="size-5 animate-spin text-violet-300" />
        </div>
        <div className="text-sm font-medium text-violet-200">{t("dropzoneAnalyzing")}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{fileName}</div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3.5 text-center">
        <div className="mb-2 text-sm font-medium text-destructive">
          {errorMessage || t("dropzoneFailed")}
        </div>
        <div className="flex justify-center gap-2">
          <Button size="sm" variant="outline" onClick={onRetry}>
            <IconRefresh className="size-3.5" />
            {t("dropzoneRetry")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            {t("dropzoneClear")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onBrowse}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onBrowse();
        }
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
        dragOver
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/40"
      )}
    >
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-full transition-colors",
          dragOver
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
        )}
      >
        {dragOver ? <IconCloudUpload className="size-5" /> : <IconFileText className="size-5" />}
      </div>
      <div className="text-sm font-semibold text-foreground">
        {dragOver ? t("dropzoneActive") : t("dropzoneIdleTitle")}
      </div>
      <p className="max-w-[320px] text-xs leading-relaxed text-muted-foreground">
        {t("dropzoneIdleHint")}
      </p>
      <div className="mt-1 text-xs font-medium text-primary">{t("dropzoneBrowse")}</div>
    </div>
  );
}
