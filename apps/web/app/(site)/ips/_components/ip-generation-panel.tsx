"use client";

import { useEffect, useState, useRef } from "react";
import {
  IconSparkles,
  IconPhoto,
  IconUpload,
  IconX,
  IconDownload,
  IconRefresh,
  IconAlertCircle,
  IconLoader2,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { api } from "@/src/lib/api";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useAuthDialog } from "@/components/auth/auth-dialog-provider";
import {
  useComputeWalletLedger,
  availableComputeBalance,
} from "@/app/(fizzstudio)/_hooks/use-billing";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";

interface AudienceTemplate {
  id: string;
  name: string;
  description: string;
  requireReferenceImage: boolean;
  referenceImageHint: string;
  outputAspectRatio: string;
  order: number;
}

interface CostPreview {
  computePoints: number;
  isFree: boolean;
}

interface JobStatus {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "cancelled";
  progress: number | null;
  outputs: Array<{ assetId: string; url?: string }>;
  error?: { message?: string };
}

export function IpGenerationPanel({ ipId }: { ipId: string }) {
  const t = useTranslations("ipGeneration");
  const { user } = useCurrentUser();
  const { open: openAuth } = useAuthDialog();

  const [templates, setTemplates] = useState<AudienceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<AudienceTemplate | null>(null);

  // Reference image state
  const [refAssetId, setRefAssetId] = useState<string | null>(null);
  const [refPreviewUrl, setRefPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Cost preview state
  const [costPreview, setCostPreview] = useState<CostPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Generation execution state
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const cancelPollRef = useRef(false);

  // User compute balance
  const walletQuery = useComputeWalletLedger();
  const balance = Number(availableComputeBalance(walletQuery.data));

  // 1. Fetch available templates on mount
  useEffect(() => {
    let unmounted = false;
    api
      .get<{ templates: AudienceTemplate[] }>(
        `/aurora/ip-commerce/ips/${ipId}/generation-templates`
      )
      .then((res) => {
        if (!unmounted && res.templates && res.templates.length > 0) {
          setTemplates(res.templates);
          setSelectedTemplate(res.templates[0]);
        }
      })
      .catch(() => {});

    return () => {
      unmounted = true;
    };
  }, [ipId]);

  // 2. Fetch cost preview when template or reference photo changes
  useEffect(() => {
    if (!selectedTemplate) return;

    if (selectedTemplate.requireReferenceImage && !refAssetId) {
      setCostPreview(null);
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);

    api
      .post<{ cost: CostPreview }>(
        `/aurora/ip-commerce/ips/${ipId}/generation-templates/${selectedTemplate.id}/preview`,
        {
          data: {
            referenceImageAssetId: refAssetId || undefined,
          },
        }
      )
      .then((res) => {
        setCostPreview(res.cost);
      })
      .catch(() => {
        setPreviewError(t("previewFailed"));
      })
      .finally(() => {
        setPreviewLoading(false);
      });
  }, [ipId, selectedTemplate, refAssetId, t]);

  // 3. Polling job status
  useEffect(() => {
    if (!jobId || !selectedTemplate) return;

    cancelPollRef.current = false;

    const poll = async () => {
      if (cancelPollRef.current) return;
      try {
        const res = await api.get<JobStatus>(
          `/aurora/ip-commerce/ips/${ipId}/generation-templates/${selectedTemplate.id}/jobs/${jobId}`
        );

        setJobStatus(res);

        if (res.status === "completed" || res.status === "failed" || res.status === "cancelled") {
          setGenerating(false);
          if (res.status === "failed") {
            setGenError(res.error?.message || t("errorGeneric"));
          }
        } else {
          pollTimerRef.current = setTimeout(poll, 2000);
        }
      } catch {
        if (!cancelPollRef.current) {
          pollTimerRef.current = setTimeout(poll, 3000);
        }
      }
    };

    poll();

    return () => {
      cancelPollRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [ipId, jobId, selectedTemplate, t]);

  if (!templates.length) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    try {
      const res = await uploadFileViaSignedUrl(file, {
        kind: "ai_reference_image",
        contentType: file.type,
      });

      setRefAssetId(res.mediaAssetId);
      setRefPreviewUrl(res.url);
    } catch {
      setUploadError(t("uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePhoto = () => {
    setRefAssetId(null);
    setRefPreviewUrl(null);
  };

  const handleStartGeneration = async () => {
    if (!selectedTemplate) return;

    if (!user) {
      openAuth();
      return;
    }

    setGenerating(true);
    setGenError(null);
    setJobStatus(null);

    try {
      const runRes = await api.post<{ jobId: string }>(
        `/aurora/ip-commerce/ips/${ipId}/generation-templates/${selectedTemplate.id}/run`,
        {
          data: {
            referenceImageAssetId: refAssetId || undefined,
            idempotencyKey: `ip-audience:${crypto.randomUUID()}`,
          },
        }
      );

      setJobId(runRes.jobId);
    } catch (err: unknown) {
      setGenerating(false);
      setGenError(err instanceof Error ? err.message : t("errorGeneric"));
    }
  };

  const handleCancel = () => {
    cancelPollRef.current = true;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setGenerating(false);
  };

  const handleReset = () => {
    setJobId(null);
    setJobStatus(null);
    setGenerating(false);
    setGenError(null);
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-2">
        <IconSparkles className="w-5 h-5 text-primary" />
        <h3 className="text-base font-semibold text-white">{t("title")}</h3>
      </div>
      <p className="text-xs text-white/60 mb-5">{t("subtitle")}</p>

      {/* Step 1: Template Selection */}
      <div className="mb-5">
        <label className="text-xs font-medium text-white/80 block mb-2">{t("templateLabel")}</label>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
          {templates.map((tpl) => {
            const isSelected = selectedTemplate?.id === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setSelectedTemplate(tpl)}
                disabled={generating}
                className={`flex flex-col text-left px-3 py-2 rounded-lg border text-xs min-w-[130px] transition ${
                  isSelected
                    ? "border-primary bg-primary/10 text-white"
                    : "border-white/10 bg-black/30 text-white/70 hover:border-white/20"
                }`}
              >
                <span className="font-semibold text-sm mb-1">{tpl.name}</span>
                <span className="text-[11px] text-white/50 line-clamp-1">
                  {tpl.outputAspectRatio}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Reference Photo (if required) */}
      {selectedTemplate?.requireReferenceImage && (
        <div className="mb-5">
          <label className="text-xs font-medium text-white/80 block mb-1">
            {t("referenceImageLabel")}
          </label>
          <p className="text-[11px] text-white/50 mb-3">
            {selectedTemplate.referenceImageHint || t("referenceImageHint")}
          </p>

          {refPreviewUrl ? (
            <div className="relative inline-block border border-white/15 rounded-lg overflow-hidden">
              <img src={refPreviewUrl} alt="Reference Preview" className="w-24 h-24 object-cover" />
              {!generating && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="absolute top-1 right-1 p-1 bg-black/60 rounded-full hover:bg-black/90 text-white/80 transition"
                  aria-label={t("removePhoto")}
                >
                  <IconX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-white/20 hover:border-white/40 bg-black/20 text-xs font-medium text-white/80 cursor-pointer transition">
                <IconUpload className="w-4 h-4 text-primary" />
                <span>{uploading ? t("uploading") : t("uploadButton")}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileUpload}
                  disabled={uploading || generating}
                  className="hidden"
                />
              </label>
              {uploadError && <span className="text-xs text-red-400">{uploadError}</span>}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Cost and Balance Preview */}
      <div className="mb-5 p-3 rounded-lg bg-black/30 border border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div>
          <span className="text-white/60 mr-2">{t("costLabel")}:</span>
          {previewLoading ? (
            <span className="text-white/40">{t("previewLoading")}</span>
          ) : costPreview ? (
            <span className="font-semibold text-primary">
              {costPreview.isFree
                ? t("costFree")
                : t("costPoints", { count: costPreview.computePoints })}
            </span>
          ) : previewError ? (
            <span className="text-red-400">{previewError}</span>
          ) : (
            <span className="text-white/40">--</span>
          )}
        </div>
        {user && <div className="text-white/50">{t("balanceLabel", { count: balance })}</div>}
      </div>

      {/* Step 4 & 5: Action Button & In-Flight Generation Progress */}
      {generating && (
        <div className="mb-4 p-4 rounded-lg bg-black/40 border border-white/10">
          <div className="flex items-center justify-between mb-2 text-xs text-white/80">
            <span className="flex items-center gap-2">
              <IconLoader2 className="w-4 h-4 animate-spin text-primary" />
              {t("progressLabel", { percent: jobStatus?.progress ?? 0 })}
            </span>
            <button
              type="button"
              onClick={handleCancel}
              className="text-white/50 hover:text-white transition"
            >
              {t("cancel")}
            </button>
          </div>
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${jobStatus?.progress ?? 5}%` }}
            />
          </div>
        </div>
      )}

      {genError && (
        <div className="mb-4 flex items-center gap-2 p-3 rounded-lg bg-red-950/40 border border-red-500/20 text-xs text-red-300">
          <IconAlertCircle className="w-4 h-4 shrink-0" />
          <span>{genError}</span>
        </div>
      )}

      {jobStatus?.status === "completed" && (
        <div className="mb-4 p-4 rounded-lg bg-white/[0.04] border border-white/10 text-center">
          <p className="text-xs font-medium text-primary mb-3">{t("completedLabel")}</p>
          {jobStatus.outputs?.[0]?.url && (
            <div className="mb-4 inline-block max-w-[280px] rounded-lg overflow-hidden border border-white/10">
              <img
                src={jobStatus.outputs[0].url}
                alt="Generated output"
                className="w-full h-auto"
              />
            </div>
          )}
          <div className="flex justify-center gap-3">
            {jobStatus.outputs?.[0]?.url && (
              <a
                href={jobStatus.outputs[0].url}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-black font-semibold text-xs hover:bg-primary/90 transition"
              >
                <IconDownload className="w-4 h-4" />
                {t("downloadButton")}
              </a>
            )}
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 text-white font-medium text-xs hover:bg-white/20 transition"
            >
              <IconRefresh className="w-4 h-4" />
              {t("retry")}
            </button>
          </div>
        </div>
      )}

      {!generating && jobStatus?.status !== "completed" && (
        <button
          type="button"
          onClick={handleStartGeneration}
          disabled={
            !selectedTemplate ||
            (selectedTemplate.requireReferenceImage && !refAssetId) ||
            !costPreview
          }
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-primary text-black font-semibold text-sm hover:bg-primary/90 transition disabled:opacity-40"
        >
          <IconPhoto className="w-4 h-4" />
          {t("generateButton")}
        </button>
      )}
    </div>
  );
}
