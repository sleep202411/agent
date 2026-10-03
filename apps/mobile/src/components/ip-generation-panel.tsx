import { saveOutput } from "@/features/ai-lab/save-output";
import { useScreenActive } from "@/hooks/use-app-active";
import { useAudienceGeneration } from "@/features/ip-community/use-audience-generation";
import { useIpGenerationPreview } from "./use-ip-generation-preview";
import { useCallback, useEffect, useLayoutEffect, useState, useRef } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
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

  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<AudienceTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<AudienceTemplate | null>(null);

  // Upload state
  const [refAssetId, setRefAssetId] = useState<string | null>(null);
  const [refAssetUrl, setRefAssetUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => () => upload.current?.abort(), []);
  const cancelUpload = () => {
    upload.current?.abort();
    upload.current = null;
    setUploading(false);
    setUploadError(null);
  };

  const { costPreview, previewLoading, previewError, previewErrorMessage, retryPreview } =
    useIpGenerationPreview({
      ipId,
      templateId: selectedTemplate?.id ?? null,
      requiresReference: selectedTemplate?.requireReferenceImage ?? false,
      referenceId: refAssetId,
    });

  const job = useAudienceGeneration(ipId);
  const { jobStatus, error: genError } = job;
  const generating = job.busy || job.submitting;
  const active = useScreenActive();
  const saving = useRef<AbortController | null>(null);
  const [saveToken, setSaveToken] = useState<AbortController | null>(null);
  const savingOutput = active && !!saveToken && !saveToken.signal.aborted;
  const [outputError, setOutputError] = useState<string | null>(null);
  useEffect(() => {
    if (active) return;
    saving.current?.abort();
    saving.current = null;
  }, [active]);
  useEffect(() => () => saving.current?.abort(), []);
  const handleSaveOutput = async () => {
    const output = jobStatus?.outputs[0];
    if (!active || !isCurrent() || saving.current || !output?.url) return;
    const token = new AbortController();
    saving.current = token;
    const current = () => isCurrent() && saving.current === token && !token.signal.aborted;
    setSaveToken(token);
    setOutputError(null);
    try {
      await saveOutput(
        { id: output.assetId, url: output.url, type: "image" },
        token.signal,
        current
      );
    } catch (error) {
      if (current())
        setOutputError(
          error instanceof Error && error.message ? error.message : t("ipGeneration.saveFailed")
        );
    } finally {
      if (current()) {
        saving.current = null;
        setSaveToken(null);
      }
    }
  };

  // User compute balance
  const {
    balance,
    error: balanceError,
    loading: balanceLoading,
    refresh: refreshBalance,
  } = useComputeWalletBalance();

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
      .catch((error: unknown) => {
        if (!controller.signal.aborted && isCurrent())
          setCatalogError(error instanceof Error && error.message ? error.message : "");
      })
      .finally(() => {
        if (!controller.signal.aborted && isCurrent()) setCatalogLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [ipId, isCurrent, catalogAttempt]);

  // Native pickers can temporarily background the app. Keep this operation
  // tied to its account, IP and selection; cancellation happens on navigation
  // unmount or an explicit template/reference change, not picker AppState.
  const handlePickPhoto = async () => {
    if (!isCurrent() || !active || upload.current || job.attempt) return;
    if (!user) {
      requireAuth();
      return;
    }
    const token = new AbortController();
    upload.current = token;
    const current = () => isCurrent() && upload.current === token && !token.signal.aborted;
    setUploading(true);
    setUploadError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg", "image/png", "image/webp"],
        multiple: false,
        copyToCacheDirectory: true,
        base64: false,
      });
      if (!current() || picked.canceled) return;
      const asset = picked.assets?.[0];
      if (picked.assets?.length !== 1 || !asset?.uri || !asset.name?.trim())
        throw new Error(t("ipGeneration.referenceInvalid"));
      const reported = asset.file?.type || asset.mimeType;
      const extensions: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
      };
      const type =
        reported && reported !== "application/octet-stream"
          ? reported.toLowerCase()
          : extensions[asset.name.split(".").pop()?.toLowerCase() ?? ""];
      if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type))
        throw new Error(t("ipGeneration.referenceInvalid"));
      const res = await uploadMobileMediaFile(
        { uri: asset.uri, name: asset.name, type, size: asset.size },
        { kind: "ai_reference_image", maxBytes: 30 * 1024 ** 2, signal: token.signal }
      );
      if (!current()) return;
      setRefAssetId(res.mediaAssetId);
      setRefAssetUrl(res.url);
    } catch (error) {
      if (current())
        setUploadError(
          error instanceof Error && error.message ? error.message : t("ipGeneration.uploadFailed")
        );
    } finally {
      if (current()) {
        upload.current = null;
        setUploading(false);
      }
    }
  };

  const handleRemovePhoto = () => {
    cancelUpload();
    setRefAssetId(null);
    setRefAssetUrl(null);
  };

  const handleStartGeneration = () => {
    if (!isCurrent() || !active || upload.current) return;
    if (!user) {
      requireAuth();
      return;
    }
    if (!selectedTemplate || !costPreview || previewLoading || previewError) return;
    void job.start(selectedTemplate.id, selectedTemplate.name, refAssetId ?? undefined);
  };
  const handleReset = () => {
    if (saving.current) return;
    setOutputError(null);
    job.reset();
    retryPreview();
  };

  if (!templates.length && !job.attempt && !job.blocked) {
    if (!catalogLoading && catalogError === null) return null;
    return (
      <View
        style={[
          styles.container,
          { borderColor: theme.border, backgroundColor: theme.backgroundElement },
        ]}
      >
        <ThemedText style={styles.title}>{t("ipGeneration.title")}</ThemedText>
        {catalogLoading ? (
          <View style={styles.costRow}>
            <ActivityIndicator color={theme.textSecondary} />
            <ThemedText style={styles.subtitle}>{t("ipGeneration.loadingTemplates")}</ThemedText>
          </View>
        ) : (
          <>
            <ThemedText style={[styles.errorText, { color: theme.brand }]}>
              {catalogError || t("ipGeneration.templateLoadFailed")}
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setCatalogLoading(true);
                setCatalogError(null);
                setCatalogAttempt((value) => value + 1);
              }}
              style={[styles.secondaryButton, { backgroundColor: theme.backgroundSelected }]}
            >
              <ThemedText style={[styles.secondaryButtonText, { color: theme.text }]}>
                {t("common.retry")}
              </ThemedText>
            </Pressable>
          </>
        )}
      </View>
    );
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

      {job.attempt && (
        <View style={{ gap: Spacing.two }}>
          <ThemedText style={styles.sectionLabel}>{job.attempt.templateName}</ThemedText>
          <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
            {t("ipGeneration.savedAttempt")}
          </ThemedText>
        </View>
      )}
      {!job.attempt && (
        <>
          {/* 1. Template picker */}
          <ThemedText style={[styles.sectionLabel, { color: theme.textSecondary }]}>
            {t("ipGeneration.templateLabel")}
          </ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.templateScroll}
          >
            <View style={styles.templateRow}>
              {templates.map((tpl) => {
                const isSelected = selectedTemplate?.id === tpl.id;
                return (
                  <Pressable
                    key={tpl.id}
                    onPress={() => {
                      if (selectedTemplate?.id !== tpl.id) {
                        cancelUpload();
                        setSelectedTemplate(tpl);
                      }
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

              {uploadError && (
                <ThemedText
                  accessibilityRole="alert"
                  style={[styles.errorText, { color: theme.brand }]}
                >
                  {uploadError}
                </ThemedText>
              )}
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
            style={[
              styles.costBox,
              { borderColor: theme.border, backgroundColor: theme.background },
            ]}
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
            {previewError && (
              <View style={{ gap: Spacing.two }}>
                {!!previewErrorMessage && (
                  <ThemedText style={[styles.errorText, { color: theme.brand }]}>
                    {previewErrorMessage}
                  </ThemedText>
                )}
                <Pressable
                  accessibilityRole="button"
                  onPress={retryPreview}
                  style={[styles.secondaryButton, { backgroundColor: theme.backgroundSelected }]}
                >
                  <ThemedText style={[styles.secondaryButtonText, { color: theme.text }]}>
                    {t("common.retry")}
                  </ThemedText>
                </Pressable>
              </View>
            )}
            {balanceError && (
              <View>
                <ThemedText type="small" accessibilityRole="alert">
                  {balanceError}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  disabled={balanceLoading}
                  onPress={refreshBalance}
                  style={{ paddingVertical: 8 }}
                >
                  <ThemedText>{t("common.retry")}</ThemedText>
                </Pressable>
              </View>
            )}
            {balance !== null && (
              <View style={styles.costRow}>
                <ThemedText style={[styles.costLabel, { color: theme.textSecondary }]}>
                  {t("ipGeneration.balanceLabel")}:
                </ThemedText>
                <ThemedText style={styles.costLabel}>{balance}</ThemedText>
              </View>
            )}
          </View>
        </>
      )}
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
          <Pressable
            accessibilityRole="button"
            disabled={job.submitting}
            onPress={job.stop}
            style={styles.cancelLink}
          >
            <ThemedText style={[styles.cancelText, { color: theme.textSecondary }]}>
              {t("ipGeneration.stopTracking")}
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
          {outputError && (
            <ThemedText
              accessibilityRole="alert"
              style={[styles.errorText, { color: theme.brand }]}
            >
              {outputError}
            </ThemedText>
          )}
          <View style={styles.actionRow}>
            {jobStatus.outputs?.[0]?.url && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ busy: savingOutput, disabled: savingOutput }}
                disabled={savingOutput}
                onPress={() => void handleSaveOutput()}
                style={[styles.primaryButton, { backgroundColor: theme.brand }]}
              >
                <ThemedText style={styles.primaryButtonText}>
                  {savingOutput ? t("ipGeneration.savingOutput") : t("ipGeneration.downloadButton")}
                </ThemedText>
              </Pressable>
            )}
            <Pressable
              disabled={savingOutput}
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

      {job.attempt && !generating && !job.terminal && (
        <Pressable
          accessibilityRole="button"
          onPress={() => void job.resume()}
          style={[styles.secondaryButton, { backgroundColor: theme.backgroundSelected }]}
        >
          <ThemedText style={[styles.secondaryButtonText, { color: theme.text }]}>
            {t("ipGeneration.recoverJob")}
          </ThemedText>
        </Pressable>
      )}
      {job.terminal && jobStatus?.status !== "completed" && (
        <Pressable
          accessibilityRole="button"
          onPress={handleReset}
          style={[styles.secondaryButton, { backgroundColor: theme.backgroundSelected }]}
        >
          <ThemedText style={[styles.secondaryButtonText, { color: theme.text }]}>
            {t("ipGeneration.retry")}
          </ThemedText>
        </Pressable>
      )}
      {!job.attempt && !job.blocked && !generating && jobStatus?.status !== "completed" && (
        <Pressable
          onPress={handleStartGeneration}
          disabled={
            uploading ||
            !active ||
            !selectedTemplate ||
            (selectedTemplate.requireReferenceImage && !refAssetId) ||
            !costPreview
          }
          style={[
            styles.generateButton,
            {
              backgroundColor: theme.brand,
              opacity:
                uploading ||
                !active ||
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
    flexWrap: "wrap",
    justifyContent: "center",
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
