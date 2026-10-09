import { useIpGenerationPreview } from "./use-ip-generation-preview";
import { useCallback, useEffect, useLayoutEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api-client";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useComputeWalletBalance } from "@/features/paywall/lib/use-compute-wallet-balance";
import { uploadMobileMediaFile } from "@/lib/media-upload";

const AURORA = { service: "aurora" } as const;

interface AudienceTemplate {
  id: string;
  name: string;
  description: string;
  requireReferenceImage: boolean;
  referenceImageHint: string;
  outputAspectRatio: string;
  order: number;
}

interface JobStatus {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "cancelled";
  progress: number | null;
  outputs: { assetId: string; url?: string }[];
  error?: { message?: string };
}

interface IpGenerationPanelProps {
  ipId: string;
}

export function IpGenerationPanel({ ipId }: IpGenerationPanelProps) {
  const { generation } = useAuth();
  return <IpGenerationSession key={JSON.stringify([ipId, generation])} ipId={ipId} />;
}

function IpGenerationSession({ ipId }: IpGenerationPanelProps) {
  const t = useTranslations();
  const theme = useTheme();
  const { user, generation } = useAuth();
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const isCurrent = useCallback(
    () => mounted.current && getAuthGeneration() === generation,
    [generation]
  );
  const { requireAuth } = useAuthGate();

  const [templates, setTemplates] = useState<AudienceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<AudienceTemplate | null>(null);

  // Upload state
  const [refAssetId, setRefAssetId] = useState<string | null>(null);
  const [refAssetUrl, setRefAssetUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { costPreview, previewLoading, previewError } = useIpGenerationPreview({
    ipId,
    templateId: selectedTemplate?.id ?? null,
    requiresReference: selectedTemplate?.requireReferenceImage ?? false,
    referenceId: refAssetId,
  });

  // Job progress state
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeAttempt = useRef<AbortController | null>(null);

  // User compute balance
  const balance = useComputeWalletBalance();

  // 1. Fetch available templates on mount
  useEffect(() => {
    const controller = new AbortController();
    api
      .get<{ templates: AudienceTemplate[] }>(`/ip-commerce/ips/${ipId}/generation-templates`, {
        ...AURORA,
        signal: controller.signal,
      })
      .then((res) => {
        if (!controller.signal.aborted && isCurrent()) {
          setTemplates(res.templates ?? []);
          setSelectedTemplate(res.templates?.[0] ?? null);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && isCurrent()) setTemplates([]);
      });
    return () => {
      controller.abort();
    };
  }, [ipId, isCurrent]);

  // Clean up poll on unmount
  useEffect(() => {
    return () => {
      activeAttempt.current?.abort();
      activeAttempt.current = null;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  // Pick & upload reference photo
  const handlePickPhoto = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/*"],
        copyToCacheDirectory: true,
      });

      if (!isCurrent() || picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];

      setUploading(true);
      const res = await uploadMobileMediaFile(
        {
          uri: asset.uri,
          name: asset.name || "reference.jpg",
          type: asset.mimeType || "image/jpeg",
          size: asset.size,
        },
        { kind: "ip_audience_reference" }
      );

      if (!isCurrent()) return;
      setRefAssetId(res.mediaAssetId);
      setRefAssetUrl(res.url);
    } catch {
      if (isCurrent()) Alert.alert(t("ipGeneration.uploadFailed"));
    } finally {
      if (isCurrent()) setUploading(false);
    }
  };

  const handleRemovePhoto = () => {
    setRefAssetId(null);
    setRefAssetUrl(null);
  };

  // Poll status loop
  const isActiveAttempt = (attempt: AbortController) =>
    isCurrent() && activeAttempt.current === attempt && !attempt.signal.aborted;

  const pollStatus = (currentJobId: string, templateId: string, attempt: AbortController) => {
    if (!isActiveAttempt(attempt)) return;

    api
      .get<Omit<JobStatus, "id">>(
        `/ip-commerce/ips/${ipId}/generation-templates/${templateId}/jobs/${currentJobId}`,
        { ...AURORA, signal: attempt.signal }
      )
      .then((statusRes) => {
        if (!isActiveAttempt(attempt)) return;

        const updated: JobStatus = {
          id: currentJobId,
          status: statusRes.status,
          progress: statusRes.progress,
          outputs: statusRes.outputs || [],
          error: statusRes.error,
        };
        setJobStatus(updated);

        if (statusRes.status === "completed") {
          activeAttempt.current = null;
          setGenerating(false);
        } else if (statusRes.status === "failed" || statusRes.status === "cancelled") {
          activeAttempt.current = null;
          setGenerating(false);
          setGenError(statusRes.error?.message || t("ipGeneration.errorGeneric"));
        } else {
          pollTimerRef.current = setTimeout(() => {
            pollTimerRef.current = null;
            pollStatus(currentJobId, templateId, attempt);
          }, 2000);
        }
      })
      .catch((err) => {
        if (!isActiveAttempt(attempt)) return;
        activeAttempt.current = null;
        setGenerating(false);
        setGenError(err?.message || t("ipGeneration.errorGeneric"));
      });
  };

  // Start Generation
  const handleStartGeneration = async () => {
    if (!isCurrent() || activeAttempt.current) return;
    if (!user) {
      requireAuth();
      return;
    }
    if (!selectedTemplate || !costPreview || previewLoading || previewError) return;

    // Keep dispatch locked before React processes another tap. The controller
    // cancels local reads only; an accepted server job continues independently.
    const attempt = new AbortController();
    activeAttempt.current = attempt;
    setGenerating(true);
    setGenError(null);
    setJobStatus(null);

    try {
      const runRes = await api.post<{ jobId: string }>(
        `/ip-commerce/ips/${ipId}/generation-templates/${selectedTemplate.id}/run`,
        {
          ...AURORA,
          data: {
            referenceImageAssetId: refAssetId || undefined,
            idempotencyKey: `ip-audience:${globalThis.crypto.randomUUID()}`,
          },
        }
      );

      pollStatus(runRes.jobId, selectedTemplate.id, attempt);
    } catch (err: any) {
      if (!isActiveAttempt(attempt)) return;
      activeAttempt.current = null;
      setGenerating(false);
      setGenError(err?.message || t("ipGeneration.errorGeneric"));
    }
  };

  const handleCancel = () => {
    activeAttempt.current?.abort();
    activeAttempt.current = null;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setGenerating(false);
  };

  const handleReset = () => {
    handleCancel();
    setJobStatus(null);
    setGenError(null);
  };

  if (!templates.length) {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}
    >
      <ThemedText style={styles.title}>{t("ipGeneration.title")}</ThemedText>
      <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
        {t("ipGeneration.subtitle")}
      </ThemedText>

      {/* 1. Template picker */}
      <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>
        {t("ipGeneration.templateLabel")}
      </ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.templateScroll}>
        <View style={styles.templateRow}>
          {templates.map((tpl) => {
            const isSelected = selectedTemplate?.id === tpl.id;
            return (
              <Pressable
                key={tpl.id}
                onPress={() => {
                  setSelectedTemplate(tpl);
                  setGenError(null);
                }}
                style={[
                  styles.templateCard,
                  {
                    borderColor: isSelected ? theme.brand : theme.border,
                    backgroundColor: isSelected ? theme.backgroundSelected : theme.background,
                  },
                ]}
              >
                <ThemedText style={styles.templateName}>{tpl.name}</ThemedText>
                {tpl.description ? (
                  <ThemedText
                    style={[styles.templateDesc, { color: theme.textSecondary }]}
                    numberOfLines={2}
                  >
                    {tpl.description}
                  </ThemedText>
                ) : null}
                <ThemedText style={[styles.templateBadge, { color: theme.textSecondary }]}>
                  {tpl.outputAspectRatio}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* 2. Reference photo upload */}
      {selectedTemplate?.requireReferenceImage && (
        <View style={styles.uploadSection}>
          <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>
            {t("ipGeneration.referenceImageLabel")}
          </ThemedText>
          {selectedTemplate.referenceImageHint ? (
            <ThemedText style={[styles.hint, { color: theme.textSecondary }]}>
              {selectedTemplate.referenceImageHint}
            </ThemedText>
          ) : null}

          {refAssetUrl ? (
            <View style={styles.thumbnailWrapper}>
              <Image source={{ uri: refAssetUrl }} style={styles.thumbnail} />
              <Pressable
                onPress={handleRemovePhoto}
                style={[styles.removeButton, { backgroundColor: theme.backgroundSelected }]}
              >
                <ThemedText style={[styles.removeButtonText, { color: theme.brand }]}>
                  {t("ipGeneration.removePhoto")}
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={handlePickPhoto}
              disabled={uploading}
              style={[
                styles.uploadButton,
                { borderColor: theme.border, backgroundColor: theme.background },
              ]}
            >
              {uploading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={theme.brand} />
                  <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>
                    {t("ipGeneration.uploading")}
                  </ThemedText>
                </View>
              ) : (
                <ThemedText style={[styles.uploadButtonText, { color: theme.text }]}>
                  {t("ipGeneration.uploadButton")}
                </ThemedText>
              )}
            </Pressable>
          )}
        </View>
      )}

      {/* 3. Cost Preview */}
      <View
        style={[styles.costBox, { borderColor: theme.border, backgroundColor: theme.background }]}
      >
        <View style={styles.costRow}>
          <ThemedText style={[styles.costLabel, { color: theme.textSecondary }]}>
            {t("ipGeneration.costLabel")}:
          </ThemedText>
          {previewLoading ? (
            <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>
              {t("ipGeneration.previewLoading")}
            </ThemedText>
          ) : previewError ? (
            <ThemedText style={{ color: theme.brand, fontSize: 13 }}>
              {t("ipGeneration.previewFailed")}
            </ThemedText>
          ) : costPreview ? (
            <ThemedText style={[styles.costValue, { color: theme.brand }]}>
              {costPreview.isFree
                ? t("ipGeneration.costFree")
                : t("ipGeneration.costPoints").replace(
                    "{points}",
                    String(costPreview.computePoints)
                  )}
            </ThemedText>
          ) : (
            <ThemedText style={{ color: theme.textSecondary, fontSize: 13 }}>-</ThemedText>
          )}
        </View>
        {balance !== null && (
          <View style={styles.costRow}>
            <ThemedText style={[styles.costLabel, { color: theme.textSecondary }]}>
              {t("ipGeneration.balanceLabel")}:
            </ThemedText>
            <ThemedText style={styles.costLabel}>{balance}</ThemedText>
          </View>
        )}
      </View>

      {/* 4. Progress and results */}
      {generating && (
        <View style={styles.progressBox}>
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={theme.brand} />
            <ThemedText style={{ color: theme.text, fontSize: 13 }}>
              {t("ipGeneration.progressLabel").replace(
                "{percent}",
                String(jobStatus?.progress ?? 0)
              )}
            </ThemedText>
          </View>
          <Pressable onPress={handleCancel} style={styles.cancelLink}>
            <ThemedText style={[styles.cancelText, { color: theme.textSecondary }]}>
              {t("ipGeneration.cancel")}
            </ThemedText>
          </Pressable>
        </View>
      )}

      {genError && (
        <View style={[styles.errorBox, { borderColor: theme.brand }]}>
          <ThemedText style={[styles.errorText, { color: theme.brand }]}>{genError}</ThemedText>
        </View>
      )}

      {jobStatus?.status === "completed" && (
        <View
          style={[
            styles.completedBox,
            { borderColor: theme.border, backgroundColor: theme.background },
          ]}
        >
          <ThemedText style={[styles.completedTitle, { color: theme.brand }]}>
            {t("ipGeneration.completedLabel")}
          </ThemedText>
          {jobStatus.outputs?.[0]?.url && (
            <Image
              source={{ uri: jobStatus.outputs[0].url }}
              style={styles.outputImage}
              resizeMode="contain"
            />
          )}
          <View style={styles.actionRow}>
            {jobStatus.outputs?.[0]?.url && (
              <Pressable
                onPress={() => {
                  if (jobStatus.outputs[0].url) {
                    void Linking.openURL(jobStatus.outputs[0].url);
                  }
                }}
                style={[styles.primaryButton, { backgroundColor: theme.brand }]}
              >
                <ThemedText style={styles.primaryButtonText}>
                  {t("ipGeneration.downloadButton")}
                </ThemedText>
              </Pressable>
            )}
            <Pressable
              onPress={handleReset}
              style={[styles.secondaryButton, { backgroundColor: theme.backgroundSelected }]}
            >
              <ThemedText style={[styles.secondaryButtonText, { color: theme.text }]}>
                {t("ipGeneration.retry")}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      )}

      {!generating && jobStatus?.status !== "completed" && (
        <Pressable
          onPress={handleStartGeneration}
          disabled={
            !selectedTemplate ||
            (selectedTemplate.requireReferenceImage && !refAssetId) ||
            !costPreview
          }
          style={[
            styles.generateButton,
            {
              backgroundColor: theme.brand,
              opacity:
                !selectedTemplate ||
                (selectedTemplate.requireReferenceImage && !refAssetId) ||
                !costPreview
                  ? 0.4
                  : 1,
            },
          ]}
        >
          <ThemedText style={styles.generateButtonText}>
            {t("ipGeneration.generateButton")}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: Spacing.four,
    padding: Spacing.four,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    marginBottom: Spacing.two,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  templateScroll: {
    marginBottom: Spacing.three,
  },
  templateRow: {
    flexDirection: "row",
    gap: 10,
  },
  templateCard: {
    width: 140,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  templateName: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 4,
  },
  templateDesc: {
    fontSize: 11,
    lineHeight: 14,
    marginBottom: 6,
  },
  templateBadge: {
    fontSize: 10,
  },
  uploadSection: {
    marginBottom: Spacing.three,
  },
  hint: {
    fontSize: 11,
    marginBottom: 8,
  },
  uploadButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadButtonText: {
    fontSize: 13,
    fontWeight: "500",
  },
  thumbnailWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  removeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  removeButtonText: {
    fontSize: 12,
    fontWeight: "500",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  costBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.three,
  },
  costRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 2,
  },
  costLabel: {
    fontSize: 12,
  },
  costValue: {
    fontSize: 13,
    fontWeight: "600",
  },
  progressBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    marginBottom: Spacing.two,
  },
  cancelLink: {
    padding: 4,
  },
  cancelText: {
    fontSize: 12,
  },
  errorBox: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: Spacing.two,
  },
  errorText: {
    fontSize: 12,
  },
  completedBox: {
    padding: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    marginBottom: Spacing.two,
  },
  completedTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 10,
  },
  outputImage: {
    width: 220,
    height: 220,
    borderRadius: 8,
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  primaryButtonText: {
    color: "#000000",
    fontSize: 13,
    fontWeight: "600",
  },
  secondaryButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: "500",
  },
  generateButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  generateButtonText: {
    color: "#000000",
    fontSize: 14,
    fontWeight: "600",
  },
});
