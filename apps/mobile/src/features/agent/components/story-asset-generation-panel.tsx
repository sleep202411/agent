import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { z } from "zod";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { deriveInitialValues, fieldDescriptors } from "@/features/ai-lab/schema";
import { prepareFormValues } from "@/features/ai-lab/form-values";
import type { GenerationModel } from "@/features/ai-lab/catalog-api";
import { loadTimelineModels, timelineModelOptions } from "../api/story-timeline-models";
import {
  getAssetGeneration,
  assetGenerationPending,
  type AssetGeneration,
  type AssetGenerationCommand,
  type AssetGenerationScope,
} from "../api/story-asset-generation";
export function AssetGenerationPanel({
  scope,
  userId,
  version,
  kind,
  latestId,
  canGenerate,
  newGenerationDisabledReason,
  onClose,
}: {
  scope: AssetGenerationScope;
  userId: string;
  version: number;
  kind: "image" | "video";
  latestId?: string;
  canGenerate: boolean;
  newGenerationDisabledReason?: string;
  onClose: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const store = useMemo(() => assetGenerationPending(scope, userId), [scope, userId]);
  const initialized = useRef(false);
  const op = useAuthFormOperation(`${scope.assetId}:${scope.purpose}`, active);
  const [models, setModels] = useState<GenerationModel[]>([]),
    [modelId, setModelId] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [pending, setPending] = useState<AssetGenerationCommand | null>(null),
    [review, setReview] = useState<AssetGenerationCommand | null>(null);
  const [job, setJob] = useState<AssetGeneration>(),
    [jobId, setJobId] = useState(latestId);
  const [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const model = models.find((m) => m.id === modelId),
    schema = useMemo(() => (model ? timelineModelOptions(model) : undefined), [model]);
  useEffect(() => {
    const controller = new AbortController();
    if (!active) return;
    void Promise.resolve()
      .then(async () => {
        if (controller.signal.aborted) return;
        const saved = store.read();
        setPending(saved ?? null);
        if (!canGenerate) return;
        const result = await loadTimelineModels(scope, kind, controller.signal, {
          imageReference: scope.purpose === "turnaround",
        });
        if (controller.signal.aborted) return;
        setModels(result.models);
        if (!initialized.current) {
          setModelId(result.selectedId);
          const selected = result.models.find((m) => m.id === result.selectedId);
          setValues(selected ? deriveInitialValues(timelineModelOptions(selected)) : {});
          initialized.current = true;
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [scope, kind, store, canGenerate, active, revision]);
  useEffect(() => {
    if (!active || !jobId || op.busy) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await getAssetGeneration(
          scope,
          z.string().uuid().parse(jobId),
          controller.signal
        );
        if (controller.signal.aborted) return;
        setJob(value);
        if (
          ["created", "in_queue", "in_progress"].includes(value.aiJob.status) ||
          (value.aiJob.status === "completed" && value.materialization.status === "pending")
        )
          timer = setTimeout(() => void load(), 2000);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [scope, jobId, active, op.busy, revision]);
  const needsReload = job?.materialization.status === "completed" && job.targetVersion === version;
  const submit = (command: AssetGenerationCommand) => {
    if (!canGenerate) return;
    void op.run(
      async () => {
        store.save(command);
        setPending(command);
        setReview(null);
        setError(undefined);
        return store.submit(command);
      },
      (value) => {
        setPending(null);
        setJob(value);
        setJobId(value.id);
      },
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  };
  const button = (label: string, run: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || op.busy}
      onPress={run}
      style={{ paddingVertical: 12, opacity: disabled || op.busy ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold" style={{ color: theme.brand }}>
        {label}
      </ThemedText>
    </Pressable>
  );
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("assetEdit.generation")}</ThemedText>
      {(loading || op.busy) && <ActivityIndicator />}
      {newGenerationDisabledReason && <ThemedText>{newGenerationDisabledReason}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {pending ? (
        <>
          <ThemedText>{t("timeline.pendingHelp")}</ThemedText>
          {button(t("timeline.retry"), () => submit(pending), !canGenerate)}
          {button(t("timeline.clear"), () =>
            Alert.alert(t("timeline.clear"), t("timeline.clearHelp"), [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("timeline.clear"),
                style: "destructive",
                onPress: () => {
                  try {
                    store.clear(pending.clientKey);
                    onClose();
                  } catch (e) {
                    setError(String(e));
                  }
                },
              },
            ])
          )}
        </>
      ) : review ? (
        <>
          <ThemedText>{t("timeline.generationCharge")}</ThemedText>
          <ThemedText>
            {review.action === "create" ? review.input.modelId : job?.aiJob.modelId}
          </ThemedText>
          {button(
            t("timeline.confirmGeneration"),
            () => submit(review),
            !canGenerate || !!newGenerationDisabledReason
          )}
          {button(t("common.cancel"), () => setReview(null))}
        </>
      ) : (
        <>
          {!loading && !models.length && canGenerate && (
            <ThemedText>{t("timeline.noModels")}</ThemedText>
          )}
          {models.map((m) =>
            button(
              `${m.id === modelId ? "✓ " : ""}${m.name}`,
              () => {
                setModelId(m.id);
                setValues(deriveInitialValues(timelineModelOptions(m)));
              },
              !canGenerate
            )
          )}
          {schema &&
            fieldDescriptors(schema, values).map(({ name, field, enabled }) => (
              <View key={name} style={{ gap: 4 }}>
                <ThemedText type="small">
                  {field.title ?? name}
                  {"enum" in field ? ` (${field.enum?.join(", ")})` : ""}
                </ThemedText>
                {field.type === "boolean" ? (
                  button(
                    String(values[name] ?? false),
                    () => setValues((v) => ({ ...v, [name]: !v[name] })),
                    !enabled || !canGenerate
                  )
                ) : (
                  <TextInput
                    accessibilityLabel={field.title ?? name}
                    value={
                      typeof values[name] === "string"
                        ? (values[name] as string)
                        : values[name] === undefined
                          ? ""
                          : Array.isArray(values[name])
                            ? field.type === "array" && field.items.type === "string"
                              ? (values[name] as unknown[]).join("\n")
                              : JSON.stringify(values[name])
                            : String(values[name])
                    }
                    editable={enabled && canGenerate && !op.busy}
                    multiline={field.type === "array"}
                    keyboardType={
                      field.type === "number" || field.type === "integer"
                        ? "decimal-pad"
                        : "default"
                    }
                    onChangeText={(value) => setValues((v) => ({ ...v, [name]: value }))}
                    style={{
                      color: theme.text,
                      borderWidth: 1,
                      borderColor: theme.border,
                      padding: 10,
                      borderRadius: 8,
                    }}
                  />
                )}
              </View>
            ))}
          {button(
            t("assetEdit.generate"),
            () => {
              try {
                if (!model || !schema) return;
                setReview({
                  action: "create",
                  clientKey: uuid.v4(),
                  input: {
                    expectedVersion: version,
                    purpose: scope.purpose,
                    outputKind: scope.outputKind,
                    modelId: model.id,
                    schemaVersion: model.schemaVersion,
                    options: prepareFormValues(schema, values) as Record<
                      string,
                      boolean | number | string | (boolean | number | string)[]
                    >,
                  },
                });
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            },
            !canGenerate || loading || !model || needsReload || !!newGenerationDisabledReason
          )}
          {job && (
            <>
              <ThemedText>
                {t(`aiLab.status.${job.aiJob.status}`)} · {job.aiJob.stage}
              </ThemedText>
              <ThemedText>{t(`timeline.materialization.${job.materialization.status}`)}</ThemedText>
              {job.aiJob.progress !== null && <ThemedText>{job.aiJob.progress}</ThemedText>}
              {job.aiJob.error != null && (
                <ThemedText accessibilityRole="alert">
                  {typeof job.aiJob.error === "string"
                    ? job.aiJob.error
                    : JSON.stringify(job.aiJob.error)}
                </ThemedText>
              )}
              {job.materialization.error != null && (
                <ThemedText accessibilityRole="alert">
                  {typeof job.materialization.error === "string"
                    ? job.materialization.error
                    : JSON.stringify(job.materialization.error)}
                </ThemedText>
              )}
              {["created", "in_queue", "in_progress"].includes(job.aiJob.status) &&
                button(
                  t("timeline.cancelGeneration"),
                  () => submit({ action: "cancel", clientKey: uuid.v4(), generationId: job.id }),
                  !canGenerate
                )}
              {["failed", "cancelled", "expired"].includes(job.aiJob.status) &&
                button(
                  t("timeline.retryGeneration"),
                  () =>
                    setReview({
                      action: "retry",
                      clientKey: uuid.v4(),
                      generationId: job.id,
                      input: { expectedVersion: version },
                    }),
                  !canGenerate || !!newGenerationDisabledReason
                )}
              {job.materialization.canRetry &&
                button(
                  t("timeline.retryAttachment"),
                  () => submit({ action: "attach", clientKey: uuid.v4(), generationId: job.id }),
                  !canGenerate
                )}
            </>
          )}
        </>
      )}
      {needsReload && button(t("assetEdit.reloadAsset"), onClose)}
      {button(
        t("assetEdit.refreshGeneration"),
        () => {
          setError(undefined);
          setRevision((n) => n + 1);
        },
        !!pending
      )}
    </View>
  );
}
