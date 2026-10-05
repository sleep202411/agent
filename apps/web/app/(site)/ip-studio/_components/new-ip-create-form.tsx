"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  IconCloudUpload,
  IconFileText,
  IconLoader2,
  IconRefresh,
  IconSparkles,
  IconTags,
  IconX,
} from "@tabler/icons-react";
import posthog from "posthog-js";
import { useTranslations } from "@/src/i18n/i18n";
import { localeFromPathname, localizePath } from "@/src/i18n/locale-url";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { AiSuggestedChip } from "@/components/ui/ai-suggested-chip";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
} from "@/components/ui/dialog";
import { useNewIpSparkAnalyze } from "@/app/(site)/ip-studio/_hooks/use-new-ip-spark";
import { useCreateIpCommerceIp, useIpCommerceTaxonomyTerms } from "@/src/lib/ip-commerce/hooks";
import type { IpTaxonomyTerm } from "@/src/lib/ip-commerce/api";
import { REGIONS, regionLabel, regionUi } from "@/src/lib/regions";

// Hero image lives on the shared static CDN (separate from the OSS
// avatar / banner buckets we use for user-generated content).
// `encodeURI` handles the spaces and CJK in the filename.
const CREATE_IP_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const NAME_MAX_LENGTH = 80;
const DESCRIPTION_MAX_LENGTH = 280;
// Loose allow-list — backend will be the source of truth once wired up.
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".md"];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

type AnalyzeStatus = "idle" | "analyzing" | "success" | "error";

interface NewIpCreateFormProps {
  onClose?: () => void;
  /** Fires after a draft is created, before navigation to the workbench. */
  onCreated?: (ipId: string) => void;
}

interface NewIpCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (ipId: string) => void;
}

export function NewIpCreateDialog({ open, onOpenChange, onCreated }: NewIpCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-lg">
        <NewIpCreateForm onClose={() => onOpenChange(false)} onCreated={onCreated} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * New IP create form.
 *
 * UX:
 *   1. This component lives in the new IP module, separate from the
 *      legacy `/ips` plaza and creation flow.
 *   2. A primary drag-drop zone invites the user to drop a script /
 *      treatment / outline. The frontend POSTs the file to the Nest.js
 *      Spark analysis endpoint and applies returned suggestions without
 *      overwriting fields the user already typed.
 *   3. The submitted draft is written to the new Nest `Ip` schema.
 *
 * State machine: `analyzeStatus` ∈ idle | analyzing | success | error.
 */
export function NewIpCreateForm({ onClose, onCreated }: NewIpCreateFormProps = {}) {
  const t = useTranslations("newIpCreate");
  const channelT = useTranslations("channels");
  const commonT = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const defaultSourceLocale = localeFromPathname(pathname);

  const [channelType, setChannelType] = useState<"ip" | "community">("ip");
  const [name, setNameState] = useState("");
  const [genreCodes, setGenreCodes] = useState<string[]>([]);
  const [region, setRegion] = useState("");
  const [description, setDescriptionState] = useState("");
  // Async analysis must consult the latest draft, including edits made while it runs.
  const nameRef = useRef("");
  const descriptionRef = useRef("");
  const setName = (value: string) => {
    nameRef.current = value;
    setNameState(value);
  };
  const setDescription = (value: string) => {
    descriptionRef.current = value;
    setDescriptionState(value);
  };
  const create = useCreateIpCommerceIp();
  const creating = create.isPending;
  const sparkAnalyze = useNewIpSparkAnalyze();
  const taxonomy = useIpCommerceTaxonomyTerms({ locale: defaultSourceLocale });
  const taxonomyItems = taxonomy.data?.items ?? [];
  const genreOptions = taxonomyItems.filter((item) => item.type === "genre");

  // AI-fill state
  const [analyzeStatus, setAnalyzeStatus] = useState<AnalyzeStatus>("idle");
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzedFileName, setAnalyzedFileName] = useState("");
  const [aiFilledFields, setAiFilledFields] = useState<Set<"name" | "description">>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);

  const resetForm = () => {
    setName("");
    setChannelType("ip");
    setGenreCodes([]);
    setRegion("");
    setDescription("");
    setAnalyzeStatus("idle");
    setAnalyzedFileName("");
    setAiFilledFields(new Set());
    setDragOver(false);
    analyzeAbortRef.current?.abort();
    analyzeAbortRef.current = null;
  };

  // ─── Field-level AI marker helpers ───────────────────
  const markAi = (field: "name" | "description") => {
    setAiFilledFields((prev) => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  };
  const clearAi = (field: "name" | "description") => {
    setAiFilledFields((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  };

  // ─── File validation ────────────────────────────────
  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE_BYTES) return t("fileTooLarge");
    const lower = file.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return t("fileTypeUnsupported");
    return null;
  };

  // ─── Submit handler for the dropzone ────────────────
  const handleFile = async (file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setAnalyzedFileName(file.name);
    setAnalyzeStatus("analyzing");
    setAnalyzeError(null);
    posthog.capture("ip_spark_analysis_started", {
      file_type: file.name.split(".").pop()?.toLowerCase(),
      file_size_kb: Math.round(file.size / 1024),
    });

    analyzeAbortRef.current?.abort();
    const controller = new AbortController();
    analyzeAbortRef.current = controller;

    try {
      const result = await sparkAnalyze.mutateAsync(file);
      if (controller.signal.aborted) return;

      // Apply only fields the backend returned. Don't overwrite values the
      // user has already typed, unless they explicitly clear them.
      if (result.name && !nameRef.current.trim()) {
        setName(result.name.slice(0, NAME_MAX_LENGTH));
        markAi("name");
      }
      if (result.description && !descriptionRef.current.trim()) {
        setDescription(result.description.slice(0, DESCRIPTION_MAX_LENGTH));
        markAi("description");
      }
      setAnalyzeStatus("success");
    } catch (err) {
      if (controller.signal.aborted) return;
      setAnalyzeError(err instanceof Error ? err.message : null);
      setAnalyzeStatus("error");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleClearAnalysis = () => {
    analyzeAbortRef.current?.abort();
    setAnalyzeStatus("idle");
    setAnalyzedFileName("");
    // Only clear fields that were AI-filled and haven't been edited by the user.
    // Channel type is a manual choice — do not reset it here.
    if (aiFilledFields.has("name")) setName("");
    if (aiFilledFields.has("description")) setDescription("");
    setAiFilledFields(new Set());
  };

  // ─── Create ─────────────────────────────────────────
  const handleCreate = () => {
    if (!name.trim() || !genreCodes.length || creating) return;
    create.mutate(
      {
        title: name.trim(),
        genreCodes,
        sourceLocale: defaultSourceLocale,
        summary: description.trim() || undefined,
        region: region || undefined,
        channelType,
      },
      {
        onSuccess: ({ ip }) => {
          posthog.capture("ip_created", {
            ip_id: ip.id,
            channel_type: channelType,
            genre_codes: genreCodes,
            source_locale: defaultSourceLocale,
            used_spark_analysis: analyzeStatus === "success",
          });
          resetForm();
          toast.success(t("createSuccess"));
          onCreated?.(ip.id);
          // Navigate to the workbench first so parent close handlers
          // (e.g. /ips/create → replace /ips) cannot win the race.
          router.push(localizePath(`/ip-studio/${ip.id}`, defaultSourceLocale));
          onClose?.();
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : "";
          toast.error(msg || t("createFailed"));
          posthog.captureException(err);
        },
      }
    );
  };

  const formContent = (
    <>
      <DialogHero
        src={CREATE_IP_HERO_URL}
        eyebrow={t("heroEyebrow")}
        title={t("pageTitle")}
        description={t("heroSubtitle")}
      />
      <DialogBody>
        <Dropzone
          status={analyzeStatus}
          errorMessage={analyzeError}
          dragOver={dragOver}
          fileName={analyzedFileName}
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

        <FieldGroup>
          <Field>
            <FieldLabel required>{channelT("category")}</FieldLabel>
            <NativeSelect
              aria-label={channelT("category")}
              value={channelType}
              disabled={creating}
              onChange={(v) => setChannelType(v as "ip" | "community")}
              className="w-full"
            >
              <option value="ip">{channelT("ip")}</option>
              <option value="community">{channelT("community")}</option>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel required>
              {t("fieldName")}
              {aiFilledFields.has("name") && <AiSuggestedChip label={t("aiSuggested")} />}
            </FieldLabel>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearAi("name");
              }}
              maxLength={NAME_MAX_LENGTH}
              showCount
              placeholder={t("fieldNamePlaceholder")}
            />
          </Field>

          <Field>
            <FieldLabel required>{t("fieldGenres")}</FieldLabel>
            {taxonomy.isError ? (
              <div role="alert" className="space-y-2">
                <p className="text-sm text-destructive">{t("taxonomyLoadFailed")}</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={taxonomy.isFetching}
                  onClick={() => void taxonomy.refetch()}
                >
                  {commonT("retry")}
                </Button>
              </div>
            ) : (
              <TaxonomyPicker
                items={genreOptions}
                selectedCodes={genreCodes}
                max={8}
                loading={taxonomy.isLoading}
                emptyLabel={t("taxonomyEmpty")}
                onChange={setGenreCodes}
              />
            )}
            <FieldDescription>
              {t("taxonomyHelp", { count: genreCodes.length, max: 8 })}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>{regionUi("field", defaultSourceLocale)}</FieldLabel>
            <NativeSelect value={region} onChange={setRegion} className="w-full">
              <option value="">{regionUi("placeholder", defaultSourceLocale)}</option>
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {regionLabel(r.code, defaultSourceLocale)}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field>
            <FieldLabel>
              {t("fieldDescription")}
              {aiFilledFields.has("description") && <AiSuggestedChip label={t("aiSuggested")} />}
            </FieldLabel>
            <Textarea
              className="max-h-40 overflow-y-auto"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                clearAi("description");
              }}
              maxLength={DESCRIPTION_MAX_LENGTH}
              showCount
              placeholder={t("fieldDescriptionPlaceholder")}
              rows={3}
            />
          </Field>
        </FieldGroup>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          onClick={handleCreate}
          disabled={!name.trim() || !genreCodes.length || creating}
        >
          {creating ? t("creating") : t("createDraft")}
        </Button>
      </DialogFooter>
    </>
  );

  return formContent;
}

function TaxonomyPicker({
  items,
  selectedCodes,
  max,
  loading,
  emptyLabel,
  onChange,
}: {
  items: IpTaxonomyTerm[];
  selectedCodes: string[];
  max: number;
  loading: boolean;
  emptyLabel: string;
  onChange: (codes: string[]) => void;
}) {
  const selected = new Set(selectedCodes);

  if (loading) {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground">
        <IconLoader2 className="size-4 animate-spin" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground">
        <IconTags className="size-4" />
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = selected.has(item.code);
        const disabled = !active && selectedCodes.length >= max;
        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (active) {
                onChange(selectedCodes.filter((code) => code !== item.code));
              } else if (!disabled) {
                onChange([...selectedCodes, item.code]);
              }
            }}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3 text-sm font-medium transition",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              disabled && "cursor-not-allowed opacity-45"
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Drag-drop zone ─────────────────────────────────

interface DropzoneProps {
  status: AnalyzeStatus;
  errorMessage: string | null;
  dragOver: boolean;
  fileName: string;
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
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onBrowse,
  onClear,
  onRetry,
}: DropzoneProps) {
  const t = useTranslations("newIpCreate");

  // Success state collapses to a slim chip — frees up vertical space
  // so the form fields are immediately reachable.
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

  // idle — full dropzone
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
        "group relative flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-4 text-center transition-colors",
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
