"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  IconCloudUpload,
  IconFileText,
  IconLoader2,
  IconPhoto,
  IconRefresh,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { env } from "@/src/env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { useCreateProject } from "@/app/(site)/ips/_hooks/use-ip";
import { useSparkAnalyze } from "@/app/(site)/ips/_hooks/use-spark";
import { uploadIPBanner } from "@/app/(site)/ips/_hooks/uploads";

const MOCK_CATEGORIES = [
  { value: "1", label: "AIGC影视" },
  { value: "2", label: "热血动漫" },
  { value: "3", label: "AI纪录片" },
  { value: "4", label: "文化传统" },
  { value: "5", label: "经典动画" },
  { value: "6", label: "AI经典改编" },
  { value: "7", label: "末日来临" },
  { value: "8", label: "爱情故事" },
  { value: "9", label: "AI科幻" },
];

// Hero image lives on the shared static CDN (separate from the OSS
// avatar / banner buckets we use for user-generated content).
// `encodeURI` handles the spaces and CJK in the filename.
const CREATE_IP_HERO_URL = encodeURI(
  "https://static.fizzspace.cn/static/pc/ChatGPT Image 2026年4月28日 20_51_09.png"
);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
// Loose allow-list — backend will be the source of truth once wired up.
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".txt", ".md"];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

type AnalyzeStatus = "idle" | "analyzing" | "success" | "error";

interface CreateIPDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Create-IP dialog.
 *
 * UX:
 *   1. A decorative hero strip at the top sets the mood (`/create-ip-hero.png`,
 *      generated externally — see prompt in PR description).
 *   2. A primary drag-drop zone invites the user to drop a script /
 *      treatment / outline. The frontend POSTs the file to a Nest.js
 *      endpoint (TODO — not implemented yet) which returns suggested
 *      `name / typeId / description`. Suggested fields render with an
 *      "AI-suggested" pill so the user knows they're auto-filled.
 *   3. Below the dropzone is the regular form (name / category /
 *      description). Manual entry is always available — the dropzone is
 *      a shortcut, not a gate.
 *
 * State machine: `analyzeStatus` ∈ idle | analyzing | success | error.
 */
export function CreateIPDialog({ open, onOpenChange }: CreateIPDialogProps) {
  const t = useTranslations("ipCreate");
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState("");
  const [description, setDescription] = useState("");
  const [bannerLink, setBannerLink] = useState("");
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const create = useCreateProject();
  const creating = create.isPending;
  const sparkAnalyze = useSparkAnalyze();

  // AI-fill state
  const [analyzeStatus, setAnalyzeStatus] = useState<AnalyzeStatus>("idle");
  const [analyzedFileName, setAnalyzedFileName] = useState("");
  const [aiFilledFields, setAiFilledFields] = useState<Set<"name" | "typeId" | "description">>(
    new Set()
  );
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyzeAbortRef = useRef<AbortController | null>(null);

  // Reset on close
  useEffect(() => {
    if (open) return;
    setStep(1);
    setName("");
    setTypeId("");
    setDescription("");
    setBannerLink("");
    setUploadingBanner(false);
    setAnalyzeStatus("idle");
    setAnalyzedFileName("");
    setAiFilledFields(new Set());
    setDragOver(false);
    analyzeAbortRef.current?.abort();
    analyzeAbortRef.current = null;
  }, [open]);

  // ─── Field-level AI marker helpers ───────────────────
  const markAi = (field: "name" | "typeId" | "description") => {
    setAiFilledFields((prev) => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  };
  const clearAi = (field: "name" | "typeId" | "description") => {
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

    analyzeAbortRef.current?.abort();
    const controller = new AbortController();
    analyzeAbortRef.current = controller;

    try {
      const result = await sparkAnalyze.mutateAsync(file);
      if (controller.signal.aborted) return;

      // Apply only fields the backend returned. Don't overwrite values the
      // user has already typed, unless they explicitly clear them.
      if (result.name && !name.trim()) {
        setName(result.name);
        markAi("name");
      }
      if (result.description && !description.trim()) {
        setDescription(result.description);
        markAi("description");
      }
      setAnalyzeStatus("success");
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error("[CreateIPDialog] analyze failed", err);
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
    if (aiFilledFields.has("name")) setName("");
    if (aiFilledFields.has("typeId")) setTypeId("");
    if (aiFilledFields.has("description")) setDescription("");
    setAiFilledFields(new Set());
  };

  // ─── Banner upload ──────────────────────────────────
  const handleBannerFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error(t("fileTypeUnsupported"));
      return;
    }
    setUploadingBanner(true);
    try {
      const asset = await uploadIPBanner(file);
      setBannerLink(asset.path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(msg || t("createFailed"));
    } finally {
      setUploadingBanner(false);
    }
  };

  // ─── Create ─────────────────────────────────────────
  const handleCreate = () => {
    if (!name.trim() || !typeId || !bannerLink || creating) return;
    create.mutate(
      {
        name: name.trim(),
        typeId,
        bannerLink,
        description: description.trim() || undefined,
      },
      {
        onSuccess: ({ id }) => {
          onOpenChange(false);
          toast.success(t("createSuccess"));
          router.push(`/ips/${id}/edit`);
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : "";
          toast.error(msg || t("createFailed"));
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
        <DialogHero
          src={CREATE_IP_HERO_URL}
          eyebrow={t("heroEyebrow")}
          title={t("pageTitle")}
          description={t("heroSubtitle")}
        />

        <div className="space-y-4 p-4">
          {step === 1 ? (
            <>
              {/* Drag-drop zone */}
              <Dropzone
                status={analyzeStatus}
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

              {/* Form */}
              <div className="space-y-2">
                <FieldLabel
                  required
                  label={t("fieldName")}
                  ai={aiFilledFields.has("name")}
                  aiLabel={t("aiSuggested")}
                />
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clearAi("name");
                  }}
                  placeholder={t("fieldNamePlaceholder")}
                  maxLength={20}
                />
              </div>

              <div className="space-y-2">
                <FieldLabel
                  required
                  label={t("fieldCategory")}
                  ai={aiFilledFields.has("typeId")}
                  aiLabel={t("aiSuggested")}
                />
                <Select
                  value={typeId}
                  onValueChange={(v) => {
                    setTypeId(v);
                    clearAi("typeId");
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("fieldCategoryPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {MOCK_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <FieldLabel
                  label={t("fieldDescription")}
                  ai={aiFilledFields.has("description")}
                  aiLabel={t("aiSuggested")}
                />
                <Textarea
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    clearAi("description");
                  }}
                  placeholder={t("fieldDescriptionPlaceholder")}
                  maxLength={500}
                  rows={3}
                />
              </div>

              <Button
                onClick={() => setStep(2)}
                disabled={!name.trim() || !typeId}
                className="w-full"
              >
                {t("next")}
              </Button>
            </>
          ) : (
            <>
              {/* Banner — required by backend, full 16:9 preview area */}
              <div className="space-y-2">
                <FieldLabel required label={t("fieldBanner")} aiLabel={t("aiSuggested")} />
                <button
                  type="button"
                  onClick={() => bannerInputRef.current?.click()}
                  disabled={uploadingBanner}
                  className={cn(
                    "relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/30 transition-colors hover:border-primary/50",
                    uploadingBanner && "cursor-wait opacity-60"
                  )}
                >
                  {bannerLink ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={
                        bannerLink.startsWith("http")
                          ? bannerLink
                          : `${env.BANNER_BASE_URL}/${bannerLink}`
                      }
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1.5 text-xs text-muted-foreground">
                      {uploadingBanner ? (
                        <IconLoader2 className="size-5 animate-spin" />
                      ) : (
                        <IconPhoto className="size-5" />
                      )}
                      <span>{t("fieldBannerHint")}</span>
                    </div>
                  )}
                </button>
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void handleBannerFile(file);
                  }}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={creating}
                  className="flex-1"
                >
                  {t("prev")}
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!bannerLink || uploadingBanner || creating}
                  className="flex-1"
                >
                  {creating ? t("creating") : t("saveAndContinue")}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Field label with optional AI-suggested chip ─────

function FieldLabel({
  label,
  required,
  ai,
  aiLabel,
}: {
  label: string;
  required?: boolean;
  ai?: boolean;
  aiLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-sm">
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {ai && (
        <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-400/10 px-1.5 py-px text-[10px] font-medium text-violet-300">
          <IconSparkles className="size-2.5" />
          {aiLabel}
        </span>
      )}
    </div>
  );
}

// ─── Drag-drop zone ─────────────────────────────────

interface DropzoneProps {
  status: AnalyzeStatus;
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
  const t = useTranslations("ipCreate");

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
        <div className="mb-2 text-sm font-medium text-destructive">{t("dropzoneFailed")}</div>
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
