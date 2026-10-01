"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import {
  IconPlus,
  IconTrash,
  IconDeviceFloppy,
  IconRefresh,
  IconLoader2,
  IconPhoto,
  IconArrowUp,
  IconArrowDown,
  IconAlertTriangle,
  IconSparkles,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "@/src/lib/api";
import { useAiCatalog } from "@/app/(fizzstudio)/_hooks/use-ai-catalog";
import { uploadFileViaSignedUrl } from "@/src/lib/media-upload";

export interface GenerationTemplateAdmin {
  id: string;
  name: string;
  description: string;
  modelId: string;
  promptPrefix: string;
  promptSuffix: string;
  requireReferenceImage: boolean;
  referenceImageHint: string;
  outputAspectRatio: "1:1" | "4:5" | "9:16" | "16:9";
  logoAssetId: string | null;
  enabled: boolean;
  order: number;
}

interface AudienceGenerationTemplatesEditorProps {
  ipId: string;
}

export function AudienceGenerationTemplatesEditor({
  ipId,
}: AudienceGenerationTemplatesEditorProps) {
  return <TemplateEditorSession key={ipId} ipId={ipId} />;
}

function TemplateEditorSession({ ipId }: AudienceGenerationTemplatesEditorProps) {
  const t = useTranslations("ipGenerationAdmin");
  const catalogQuery = useAiCatalog();

  const [templates, setTemplates] = useState<GenerationTemplateAdmin[]>([]);
  const [version, setVersion] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [conflictError, setConflictError] = useState(false);
  const [uploadingLogoIndex, setUploadingLogoIndex] = useState<number | null>(null);

  const fileInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({});

  const availableModels = Object.values(catalogQuery.data?.models ?? {}).filter(
    (m) => m.type === "image" || m.type === "video"
  );

  const fetchTemplates = useCallback(
    (signal?: AbortSignal) => {
      return api
        .get<{ templates: GenerationTemplateAdmin[]; version: number }>(
          `/aurora/ip-commerce/me/ips/${ipId}/generation-templates`,
          { signal }
        )
        .then((res) => {
          if (signal?.aborted) return;
          setTemplates(res.templates || []);
          setVersion(res.version ?? 0);
          setConflictError(false);
        })
        .catch((error: unknown) => {
          if (!signal?.aborted)
            toast.error(error instanceof Error ? error.message : t("saveFailed"));
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        });
    },
    [ipId, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchTemplates(controller.signal);
    return () => controller.abort();
  }, [fetchTemplates]);

  const handleAddTemplate = () => {
    const defaultModel = availableModels[0]?.id || "fal_flux_schnell";
    const newTemplate: GenerationTemplateAdmin = {
      id: crypto.randomUUID(),
      name: "",
      description: "",
      modelId: defaultModel,
      promptPrefix: "",
      promptSuffix: "",
      requireReferenceImage: true,
      referenceImageHint: "",
      outputAspectRatio: "1:1",
      logoAssetId: null,
      enabled: true,
      order: templates.length + 1,
    };
    setTemplates((prev) => [...prev, newTemplate]);
  };

  const handleUpdateTemplate = (index: number, patch: Partial<GenerationTemplateAdmin>) => {
    setTemplates((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const handleDeleteTemplate = (index: number) => {
    if (!window.confirm(t("deleteConfirm"))) return;
    setTemplates((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= templates.length) return;
    setTemplates((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next.map((tpl, i) => ({ ...tpl, order: i + 1 }));
    });
  };

  const handleLogoUpload = async (index: number, file: File) => {
    try {
      setUploadingLogoIndex(index);
      const res = await uploadFileViaSignedUrl(file, {
        kind: "ip_banner",
      });
      handleUpdateTemplate(index, { logoAssetId: res.mediaAssetId });
      toast.success(t("logoUploaded"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("logoUploadFailed"));
    } finally {
      setUploadingLogoIndex(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setConflictError(false);

    try {
      const sanitized = templates.map((tpl, i) => ({
        ...tpl,
        order: i + 1,
        name: tpl.name.trim() || `Template ${i + 1}`,
        description: tpl.description?.trim() || "",
        promptPrefix: tpl.promptPrefix?.trim() || "",
        promptSuffix: tpl.promptSuffix?.trim() || "",
        referenceImageHint: tpl.referenceImageHint?.trim() || "",
      }));

      const res = await api.put<{ templates: GenerationTemplateAdmin[]; version: number }>(
        `/aurora/ip-commerce/me/ips/${ipId}/generation-templates`,
        {
          data: {
            templates: sanitized,
            expectedVersion: version,
          },
        }
      );

      setTemplates(res.templates || []);
      setVersion(res.version ?? version + 1);
      toast.success(t("saved"));
    } catch (error) {
      const err = error as {
        status?: unknown;
        statusCode?: unknown;
        response?: { status?: unknown };
        code?: unknown;
      } | null;
      const isConflict =
        err?.status === 409 ||
        err?.statusCode === 409 ||
        err?.response?.status === 409 ||
        err?.code === "IP_VERSION_CONFLICT" ||
        err?.code === "CONFLICT";
      if (isConflict) {
        setConflictError(true);
      } else {
        toast.error(t("saveFailed"));
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-white/50 text-sm gap-2">
        <IconLoader2 className="w-5 h-5 animate-spin text-primary" />
        <span>Loading templates...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <h2 className="text-lg font-semibold text-white">{t("title")}</h2>
          <p className="text-xs text-white/60 mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAddTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium text-xs transition"
          >
            <IconPlus className="w-4 h-4" />
            {t("addTemplate")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-black font-semibold text-xs transition disabled:opacity-50"
          >
            {saving ? (
              <IconLoader2 className="w-4 h-4 animate-spin" />
            ) : (
              <IconDeviceFloppy className="w-4 h-4" />
            )}
            {saving ? t("saving") : t("saveChanges")}
          </button>
        </div>
      </div>

      {conflictError && (
        <div className="p-4 rounded-lg bg-amber-950/40 border border-amber-500/30 flex items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <IconAlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{t("conflictError")}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void fetchTemplates();
            }}
            className="flex items-center gap-1 px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 font-medium transition"
          >
            <IconRefresh className="w-3.5 h-3.5" />
            {t("refresh")}
          </button>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="p-8 text-center rounded-xl border border-dashed border-white/10 text-xs text-white/50 space-y-3">
          <IconSparkles className="w-8 h-8 mx-auto text-white/30" />
          <p>{t("emptyState")}</p>
          <button
            type="button"
            onClick={handleAddTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium text-xs transition"
          >
            <IconPlus className="w-4 h-4" />
            {t("addTemplate")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {templates.map((tpl, idx) => (
            <div
              key={tpl.id}
              className="p-5 rounded-xl border border-white/10 bg-white/[0.02] space-y-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-primary">
                  {t("templateLabel", { index: idx + 1 })}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleMove(idx, "up")}
                    disabled={idx === 0}
                    className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-20"
                  >
                    <IconArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(idx, "down")}
                    disabled={idx === templates.length - 1}
                    className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-20"
                  >
                    <IconArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTemplate(idx)}
                    className="p-1 rounded hover:bg-red-500/20 text-red-400 transition"
                  >
                    <IconTrash className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Name */}
                <div>
                  <label className="block text-white/70 mb-1">{t("fieldName")} *</label>
                  <input
                    type="text"
                    value={tpl.name}
                    onChange={(e) => handleUpdateTemplate(idx, { name: e.target.value })}
                    maxLength={120}
                    placeholder="e.g. Vintage Cyberpunk Poster"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-primary"
                  />
                </div>

                {/* Model */}
                <div>
                  <label className="block text-white/70 mb-1">{t("fieldModel")} *</label>
                  <NativeSelect
                    value={tpl.modelId}
                    onChange={(value) => handleUpdateTemplate(idx, { modelId: value })}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-primary"
                  >
                    {availableModels.map((m) => (
                      <option key={m.id} value={m.id} className="bg-neutral-900 text-white">
                        {m.name} ({m.type})
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                {/* Description */}
                <div className="md:col-span-2">
                  <label className="block text-white/70 mb-1">{t("fieldDescription")}</label>
                  <input
                    type="text"
                    value={tpl.description}
                    onChange={(e) => handleUpdateTemplate(idx, { description: e.target.value })}
                    maxLength={500}
                    placeholder="Short description displayed to viewers"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-primary"
                  />
                </div>

                {/* Prompt prefix */}
                <div>
                  <label className="block text-white/70 mb-1">{t("fieldPromptPrefix")}</label>
                  <textarea
                    rows={3}
                    value={tpl.promptPrefix}
                    onChange={(e) => handleUpdateTemplate(idx, { promptPrefix: e.target.value })}
                    maxLength={2000}
                    placeholder="Base system prompt prefix applied to generation"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-primary resize-none"
                  />
                </div>

                {/* Prompt suffix */}
                <div>
                  <label className="block text-white/70 mb-1">{t("fieldPromptSuffix")}</label>
                  <textarea
                    rows={3}
                    value={tpl.promptSuffix}
                    onChange={(e) => handleUpdateTemplate(idx, { promptSuffix: e.target.value })}
                    maxLength={2000}
                    placeholder="Style tokens / lighting / camera cues appended to generation"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-primary resize-none"
                  />
                </div>

                {/* Reference photo options */}
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tpl.requireReferenceImage}
                      onChange={(e) =>
                        handleUpdateTemplate(idx, { requireReferenceImage: e.target.checked })
                      }
                      className="rounded border-white/20 text-primary focus:ring-0"
                    />
                    <span className="text-white/80">{t("fieldRequireReference")}</span>
                  </label>

                  {tpl.requireReferenceImage && (
                    <div>
                      <label className="block text-white/70 mb-1">{t("fieldReferenceHint")}</label>
                      <input
                        type="text"
                        value={tpl.referenceImageHint}
                        onChange={(e) =>
                          handleUpdateTemplate(idx, { referenceImageHint: e.target.value })
                        }
                        maxLength={200}
                        placeholder="e.g. Please upload a clear frontal selfie"
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-primary"
                      />
                    </div>
                  )}
                </div>

                {/* Aspect ratio & Branding Logo */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-white/70 mb-1">{t("fieldAspectRatio")}</label>
                    <NativeSelect
                      value={tpl.outputAspectRatio}
                      onChange={(value) =>
                        handleUpdateTemplate(idx, {
                          outputAspectRatio: value as GenerationTemplateAdmin["outputAspectRatio"],
                        })
                      }
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:border-primary"
                    >
                      <option value="1:1" className="bg-neutral-900 text-white">
                        1:1 (Square)
                      </option>
                      <option value="4:5" className="bg-neutral-900 text-white">
                        4:5 (Portrait)
                      </option>
                      <option value="9:16" className="bg-neutral-900 text-white">
                        9:16 (Story / Reel)
                      </option>
                      <option value="16:9" className="bg-neutral-900 text-white">
                        16:9 (Landscape)
                      </option>
                    </NativeSelect>
                  </div>

                  <div>
                    <label className="block text-white/70 mb-1">{t("fieldLogo")}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        ref={(el) => {
                          fileInputRefs.current[idx] = el;
                        }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleLogoUpload(idx, file);
                        }}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRefs.current[idx]?.click()}
                        disabled={uploadingLogoIndex === idx}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white font-medium text-xs transition"
                      >
                        {uploadingLogoIndex === idx ? (
                          <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <IconPhoto className="w-3.5 h-3.5" />
                        )}
                        <span>{tpl.logoAssetId ? "Change Logo" : "Upload Logo"}</span>
                      </button>
                      {tpl.logoAssetId && (
                        <button
                          type="button"
                          onClick={() => handleUpdateTemplate(idx, { logoAssetId: null })}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Enabled checkbox */}
                <div className="md:col-span-2 pt-2 border-t border-white/5 flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tpl.enabled}
                      onChange={(e) => handleUpdateTemplate(idx, { enabled: e.target.checked })}
                      className="rounded border-white/20 text-primary focus:ring-0"
                    />
                    <span className="text-white/80 font-medium">{t("fieldEnabled")}</span>
                  </label>
                  <span className="text-white/40 text-[11px]">
                    ID: <code className="font-mono text-white/60">{tpl.id}</code>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
