import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { router } from "expo-router";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ConversationVideo } from "@/features/services/conversation-video";
import { ApiRequestError } from "@/lib/api-client";
import { canUseGeneration, loadGenerationCatalog, planRank } from "./catalog-api";
import {
  canCreateStudioProject,
  type StudioWorkspace,
} from "@/features/agent/api/studio-projects-api";
import { prepareFormValues } from "./form-values";
import {
  buildReferenceContract,
  imageReferences,
  identifiedImages,
  imageLabel,
  nextImageLabel,
  objectImageField,
  replaceImageUrl,
  referenceInputValues,
} from "./reference-contract";
import {
  acceptsReferenceImage,
  confirmReferenceImage,
  pickReferenceImage,
  type ReferenceCheckpoint,
} from "./reference-image";
import { generationDraft, type GenerationDraft } from "./draft";
import {
  generationRetryOutbox,
  retryGenerationOnce,
  type GenerationRetry,
  cancelGeneration,
  generationCommand,
  generationOutbox,
  getGenerationJob,
  listGenerationJobs,
  submitPendingGeneration,
  type GenerationJob,
  type GenerationCommand,
} from "./jobs-api";
import {
  deriveInitialValues,
  fieldDescription,
  fieldDescriptors,
  fieldLabel,
  optionLocked,
  readOptions,
  serializeFieldValue,
} from "./schema";
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12, opacity: disabled ? 0.45 : 1 }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
const terminal = (job: GenerationJob) => !["in_queue", "in_progress"].includes(job.status);
type PanelProps = {
  userId: string;
  generation: number;
  workspace?: StudioWorkspace;
  onBusyChange?: (busy: boolean) => void;
};
export function GenerationPanel(props: PanelProps) {
  return useScreenActive() && props.generation === getAuthGeneration() ? (
    <Session
      key={`${props.userId}:${props.generation}:${props.workspace?.id ?? "personal"}:${props.workspace?.role}:${props.workspace?.crewRole}`}
      {...props}
    />
  ) : null;
}
function Session({ userId, generation, workspace, onBusyChange }: PanelProps) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation("ai-lab", true);
  const workspaceId = workspace?.id,
    storageScope = workspace?.isDefault ? undefined : workspaceId;
  const canGenerate = !workspace || canCreateStudioProject(workspace);
  useEffect(() => {
    onBusyChange?.(op.busy);
    return () => onBusyChange?.(false);
  }, [op.busy, onBusyChange]);
  const [store] = useState(() => generationDraft(userId, generation, storageScope)),
    [box] = useState(() => generationOutbox(userId, generation, storageScope)),
    [retryBox] = useState(() => generationRetryOutbox(userId, generation, storageScope));
  const [initial] = useState(() => {
    try {
      return { draft: store.read(), pending: box.read(), retry: retryBox.read(), error: "" };
    } catch (e) {
      return { draft: null, pending: null, retry: null, error: String(e) };
    }
  });
  const [draft, setDraft] = useState<GenerationDraft | null>(initial.draft),
    [pending, setPending] = useState<GenerationCommand | null>(initial.pending ?? null),
    [retryPending, setRetryPending] = useState<GenerationRetry | null>(initial.retry ?? null),
    [data, setData] = useState<Awaited<ReturnType<typeof loadGenerationCatalog>>>(),
    [jobs, setJobs] = useState<GenerationJob[]>([]),
    [selected, setSelected] = useState<GenerationJob>(),
    [error, setError] = useState(initial.error),
    [historyError, setHistoryError] = useState(""),
    [historyLoading, setHistoryLoading] = useState(true),
    [nextChoice, setNextChoice] = useState<{ presetId: string; modelId?: string }>(),
    [loading, setLoading] = useState(true),
    [tab, setTab] = useState<"create" | "history">("create"),
    [confirm, setConfirm] = useState<
      "generate" | "reset" | "clear" | "cancel" | "retry" | "clearRetry" | "discardUpload" | null
    >(null),
    [privateDenied, setPrivateDenied] = useState(false),
    [epoch, setEpoch] = useState(0);
  const controller = useRef<AbortController | null>(null),
    denied = useRef(false),
    selection = useRef<string | null>(null);
  const mode = draft?.mode ?? "image";
  function save(value: GenerationDraft) {
    store.save(value);
    setDraft(value);
    setError("");
  }
  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiRequestError && [401, 403].includes(e.status ?? 0)) {
      denied.current = true;
      setPrivateDenied(true);
      setJobs([]);
      setSelected(undefined);
      setData(undefined);
    }
    setError(e instanceof Error ? e.message : String(e));
  }, []);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    denied.current = false;
    // This effect begins a fresh catalog read after explicit refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void loadGenerationCatalog(generation, c.signal, workspaceId)
      .then((v) => {
        if (c.signal.aborted || denied.current) return;
        setData(v);
        setPrivateDenied(false);
      })
      .catch((e) => {
        if (!c.signal.aborted) fail(e);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [generation, epoch, fail, workspaceId]);
  useEffect(() => {
    const c = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Reset the displayed list when its media type changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoryLoading(true);
    setJobs([]);
    setSelected(undefined);
    selection.current = null;
    async function read() {
      try {
        const value = await listGenerationJobs(mode, generation, c.signal, workspaceId);
        if (c.signal.aborted || denied.current) return;
        setJobs(value.jobs);
        setHistoryError("");
        const requested = selection.current;
        if (requested) {
          try {
            const detail = await getGenerationJob(requested, generation, c.signal, workspaceId);
            if (!c.signal.aborted && selection.current === requested) setSelected(detail);
          } catch (e) {
            if (!c.signal.aborted && selection.current === requested) {
              selection.current = null;
              setSelected(undefined);
            }
            throw e;
          }
        }
      } catch (e) {
        if (c.signal.aborted) return;
        if (e instanceof ApiRequestError && [401, 403].includes(e.status ?? 0)) fail(e);
        else setHistoryError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!c.signal.aborted) setHistoryLoading(false);
        if (!c.signal.aborted && !denied.current) timer = setTimeout(() => void read(), 8000);
      }
    }
    void read();
    return () => {
      c.abort();
      if (timer) clearTimeout(timer);
    };
  }, [mode, generation, epoch, fail, workspaceId]);
  const preset = data?.catalog.presets.find((p) => p.id === draft?.presetId),
    model = data?.catalog.models.find((m) => m.id === draft?.modelId),
    schemaChanged = !!model && draft?.schemaVersion !== model.schemaVersion,
    usable =
      canGenerate &&
      !!data &&
      !!model &&
      !!preset &&
      canUseGeneration(model, preset, data.rank) &&
      !schemaChanged;
  function requestChoose(presetId: string, modelId?: string) {
    if (draft && (draft.presetId !== presetId || (modelId && draft.modelId !== modelId))) {
      setNextChoice({ presetId, modelId });
      setConfirm("reset");
    } else if (!draft) choose(presetId, modelId);
  }
  function choose(presetId: string, modelId?: string) {
    const p = data?.catalog.presets.find((p) => p.id === presetId),
      m = data?.catalog.models.find((m) => m.id === (modelId ?? p?.modelIds[0]));
    if (!p || !m || m.type === "audio") return;
    try {
      save({
        mode: m.type,
        presetId: p.id,
        modelId: m.id,
        schemaVersion: m.schemaVersion,
        values: deriveInitialValues(m.input_schema),
      });
    } catch (e) {
      fail(e);
    }
  }
  function run(request: () => Promise<unknown>, success: () => void = () => {}) {
    const c = controller.current;
    if (!c || c.signal.aborted) return;
    void op.run(
      request,
      () => {
        setError("");
        success();
      },
      (e) => {
        fail(e);
        try {
          setPending(box.read() ?? null);
          setRetryPending(retryBox.read() ?? null);
        } catch {
          /* Preserve existing pending display. */
        }
      }
    );
  }
  async function finishUpload(value: ReferenceCheckpoint) {
    const original = store.read();
    if (!original || original.upload?.storageKey !== value.storageKey)
      throw new Error(t("aiLab.uploadChanged"));
    const receipt = await confirmReferenceImage(value, generation, controller.current!.signal);
    const latest = store.read();
    if (
      !latest ||
      latest.modelId !== original.modelId ||
      latest.schemaVersion !== original.schemaVersion ||
      latest.upload?.storageKey !== value.storageKey
    )
      throw new Error(t("aiLab.uploadChanged"));
    const current = latest.values[value.field];
    const urls = Array.isArray(current)
      ? current.map(String)
      : typeof current === "string"
        ? current
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    let next: unknown = value.multiple
      ? [...new Set([...urls, receipt.url])].join("\n")
      : receipt.url;
    if (value.objectItems) {
      const rows = identifiedImages(imageReferences(current));
      next = rows.some((r) => r.assetId === receipt.mediaAssetId)
        ? rows
        : [
            ...rows,
            {
              url: receipt.url,
              assetId: receipt.mediaAssetId,
              refId: receipt.mediaAssetId,
              label: nextImageLabel(rows, latest.values.prompt),
            },
          ];
    }
    save({
      ...latest,
      upload: undefined,
      values: { ...latest.values, [value.field]: next },
      uploadedReferences: [
        ...(latest.uploadedReferences ?? []).filter(
          (r) =>
            r.field !== value.field || (value.multiple && r.mediaAssetId !== receipt.mediaAssetId)
        ),
        {
          field: value.field,
          mediaAssetId: receipt.mediaAssetId,
          url: receipt.url,
          fileName: value.fileName,
        },
      ],
    });
  }
  function uploadImage(field: string, multiple: boolean, objectItems = false) {
    if (!draft || draft.upload || !canGenerate) return;
    run(async () => {
      const checkpoint = await pickReferenceImage(
        field,
        multiple,
        generation,
        controller.current!.signal,
        (value) => {
          const latest = store.read();
          if (
            !latest ||
            latest.modelId !== draft.modelId ||
            latest.schemaVersion !== draft.schemaVersion
          )
            throw new Error(t("aiLab.uploadChanged"));
          save({ ...latest, upload: value });
        },
        objectItems
      );
      if (checkpoint) await finishUpload(checkpoint);
    });
  }
  function prepare() {
    if (!model || !draft || draft.upload || !data || !preset || !usable)
      throw new Error(t("aiLab.unavailable"));
    const values = prepareFormValues(
      model.input_schema,
      referenceInputValues(fieldDescriptors(model.input_schema, draft.values), draft.values),
      {
        required: (label) => t("aiLab.required").replace("{label}", label),
        minLength: (label, min) =>
          t("aiLab.minLength").replace("{label}", label).replace("{min}", String(min)),
        maxLength: (label, max) =>
          t("aiLab.maxLength").replace("{label}", label).replace("{max}", String(max)),
        minItems: (label, min) =>
          t("aiLab.minItems").replace("{label}", label).replace("{min}", String(min)),
        maxItems: (label, max) =>
          t("aiLab.maxItems").replace("{label}", label).replace("{max}", String(max)),
        minimum: (label, min) =>
          t("aiLab.minimum").replace("{label}", label).replace("{min}", String(min)),
        maximum: (label, max) =>
          t("aiLab.maximum").replace("{label}", label).replace("{max}", String(max)),
        unsupportedOption: (label) => t("aiLab.unsupported").replace("{label}", label),
        invalidUrl: (label) => t("aiLab.fieldUrl").replace("{label}", label),
      }
    );
    for (const descriptor of fieldDescriptors(model.input_schema, draft.values)) {
      const chosen = readOptions(descriptor.field).find((o) => o.value === values[descriptor.name]);
      if (chosen && optionLocked(chosen, data.rank, planRank))
        throw new Error(t("aiLab.unavailable"));
    }
    return generationCommand.parse({
      clientKey: uuid.v4(),
      workspaceId,
      modelId: model.id,
      presetId: preset.id,
      campaignId: preset.campaignId,
      schemaVersion: model.schemaVersion,
      input: values,
      ...(model.input_schema.properties.referenceImages?.type === "array" &&
      model.input_schema.properties.referenceImages.items.type === "object"
        ? buildReferenceContract(
            {
              ...values,
              referenceImages: values.referenceImages ? draft.values.referenceImages : [],
            },
            {
              missing: (label) => t("aiLab.missingReference").replace("{label}", label),
              duplicate: t("aiLab.duplicateReference"),
            }
          )
        : {}),
    });
  }
  function submit() {
    try {
      if (!canGenerate) throw new Error(t("aiLab.workspaceReadOnly"));
      if (workspaceId && pending?.workspaceId && pending.workspaceId !== workspaceId)
        throw new Error(t("aiLab.workspaceRequestMismatch"));
      const command = pending ?? prepare();
      setConfirm(null);
      run(
        async () => {
          await submitPendingGeneration(
            command,
            userId,
            generation,
            controller.current!.signal,
            storageScope
          );
        },
        () => {
          setPending(null);
          setTab("history");
          setEpoch((x) => x + 1);
        }
      );
    } catch (e) {
      fail(e);
    }
  }
  const inputStyle = {
    color: theme.text,
    backgroundColor: theme.backgroundElement,
    borderRadius: 8,
    padding: 12,
  };
  if (privateDenied)
    return (
      <View style={{ padding: 16 }}>
        <ThemedText>{error}</ThemedText>
        <Button label={t("common.retry")} onPress={() => setEpoch((x) => x + 1)} />
      </View>
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        <Button label={t("aiLab.create")} onPress={() => setTab("create")} />
        <Button label={t("aiLab.history")} onPress={() => setTab("history")} />
        <Button
          label={t("common.retry")}
          disabled={op.busy}
          onPress={() => setEpoch((x) => x + 1)}
        />
      </View>
      {loading ? <ActivityIndicator /> : null}
      {error ? <ThemedText>{error}</ThemedText> : null}
      {pending ? (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("aiLab.pending")}</ThemedText>
          <Button label={t("aiLab.recover")} disabled={op.busy || !canGenerate} onPress={submit} />
          <Button label={t("aiLab.clear")} disabled={op.busy} onPress={() => setConfirm("clear")} />
        </View>
      ) : null}
      {draft?.upload ? (
        <View style={{ gap: 8 }}>
          <ThemedText>
            {t("aiLab.uploadPending")} {draft.upload.fileName}
          </ThemedText>
          <Button
            label={t("aiLab.confirmUpload")}
            disabled={op.busy}
            onPress={() => run(() => finishUpload(draft.upload!))}
          />
          <Button
            label={t("aiLab.discardUpload")}
            disabled={op.busy}
            onPress={() => setConfirm("discardUpload")}
          />
        </View>
      ) : null}
      {retryPending ? (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("aiLab.retryPending")}</ThemedText>
          <Button
            label={t("aiLab.clear")}
            disabled={op.busy}
            onPress={() => setConfirm("clearRetry")}
          />
        </View>
      ) : null}
      {tab === "create" ? (
        <>
          <View style={{ flexDirection: "row" }}>
            {(["image", "video"] as const).map((value) => (
              <Button
                key={value}
                label={t(value === "image" ? "aiLab.image" : "aiLab.video")}
                disabled={
                  op.busy ||
                  !!pending ||
                  !!retryPending ||
                  !!draft?.upload ||
                  !data?.catalog.presets.some((p) => p.type === value)
                }
                onPress={() => {
                  const p = data?.catalog.presets.find((p) => p.type === value);
                  if (p) requestChoose(p.id);
                }}
              />
            ))}
          </View>
          {data?.catalog.presets
            .filter((p) => p.type === mode)
            .map((p) => (
              <Button
                key={p.id}
                label={`${p.id === preset?.id ? "✓ " : ""}${p.label}`}
                disabled={op.busy || !!pending || !!retryPending || !!draft?.upload}
                onPress={() => requestChoose(p.id)}
              />
            ))}
          {preset?.description ? <ThemedText type="small">{preset.description}</ThemedText> : null}
          {preset?.modelIds
            .map((id) => data?.catalog.models.find((m) => m.id === id))
            .filter((m) => !!m)
            .map((m) => (
              <Button
                key={m.id}
                label={`${m.id === model?.id ? "✓ " : ""}${m.name}`}
                disabled={op.busy || !!pending || !!retryPending || !!draft?.upload}
                onPress={() => requestChoose(preset!.id, m.id)}
              />
            ))}
          {schemaChanged ? <ThemedText>{t("aiLab.schemaChanged")}</ThemedText> : null}
          {draft && data && (!model || !preset) ? (
            <ThemedText>{t("aiLab.unavailable")}</ThemedText>
          ) : null}
          {model && !usable ? (
            <>
              <ThemedText>
                {model.disabledReason ?? preset?.disabledReason ?? t("aiLab.unavailable")}
              </ThemedText>
              {canGenerate ? (
                <Button label={t("aiLab.membership")} onPress={() => router.push("/pay")} />
              ) : null}
            </>
          ) : null}
          {model && draft
            ? fieldDescriptors(model.input_schema, draft.values).map((descriptor) => {
                const { name, field, enabled } = descriptor,
                  options = readOptions(field),
                  value = draft.values[name],
                  disabled =
                    op.busy ||
                    !!pending ||
                    !!retryPending ||
                    !!draft?.upload ||
                    !enabled ||
                    schemaChanged;
                const objectImages = objectImageField(descriptor);
                let rows: ReturnType<typeof imageReferences> | undefined;
                if (objectImages) {
                  try {
                    rows = identifiedImages(imageReferences(value));
                  } catch {
                    /* Keep malformed saved JSON visible for correction. */
                  }
                }
                const update = (next: unknown) => {
                  try {
                    save({ ...draft, values: { ...draft.values, [name]: next } });
                  } catch (e) {
                    fail(e);
                  }
                };
                return (
                  <View key={name} style={{ gap: 6 }}>
                    <ThemedText type="smallBold">
                      {fieldLabel(field, name)}
                      {descriptor.required ? " *" : ""}
                    </ThemedText>
                    {fieldDescription(field) ? (
                      <ThemedText type="small">{fieldDescription(field)}</ThemedText>
                    ) : null}
                    {acceptsReferenceImage(descriptor) ? (
                      <Button
                        label={t("aiLab.uploadImage")}
                        disabled={
                          disabled ||
                          !canGenerate ||
                          (objectImages && !rows) ||
                          (field.type === "array" &&
                            typeof field.maxItems === "number" &&
                            (
                              rows ??
                              (Array.isArray(value)
                                ? value
                                : typeof value === "string"
                                  ? value.split(/\r?\n/).filter((v) => v.trim())
                                  : [])
                            ).length >= field.maxItems)
                        }
                        onPress={() => uploadImage(name, field.type === "array", objectImages)}
                      />
                    ) : null}
                    {rows ? (
                      <View style={{ gap: 8 }}>
                        {rows.map((row, index) => (
                          <View
                            key={row.refId}
                            style={{
                              gap: 6,
                              padding: 8,
                              borderWidth: 1,
                              borderColor: theme.backgroundElement,
                            }}
                          >
                            <ThemedText type="smallBold">{imageLabel(row, index)}</ThemedText>
                            {/^https?:\/\//.test(row.url) ? (
                              <Image
                                source={{ uri: row.url }}
                                style={{ width: 64, height: 64 }}
                                contentFit="cover"
                              />
                            ) : null}
                            <TextInput
                              accessibilityLabel={`${fieldLabel(field, name)} ${index + 1}`}
                              value={row.url}
                              editable={!disabled}
                              style={inputStyle}
                              onChangeText={(url) =>
                                update(
                                  rows.map((r, i) => (i === index ? replaceImageUrl(r, url) : r))
                                )
                              }
                            />
                            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                              {name === "referenceImages" &&
                              model.input_schema.properties.prompt?.type === "string" ? (
                                <Button
                                  label={t("aiLab.mention").replace(
                                    "{label}",
                                    imageLabel(row, index)
                                  )}
                                  disabled={disabled}
                                  onPress={() => {
                                    try {
                                      save({
                                        ...draft,
                                        values: {
                                          ...draft.values,
                                          [name]: rows,
                                          prompt: `${typeof draft.values.prompt === "string" ? draft.values.prompt : ""}${draft.values.prompt ? " " : ""}@${imageLabel(row, index)}`,
                                        },
                                      });
                                    } catch (e) {
                                      fail(e);
                                    }
                                  }}
                                />
                              ) : null}
                              <Button
                                label={t("aiLab.removeReference")}
                                disabled={disabled}
                                onPress={() => update(rows.filter((_, i) => i !== index))}
                              />
                              <Button
                                label={t("aiLab.moveUp")}
                                disabled={disabled || index === 0}
                                onPress={() => {
                                  const next = [...rows];
                                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                                  update(next);
                                }}
                              />
                            </View>
                          </View>
                        ))}
                        <Button
                          label={t("aiLab.addReferenceUrl")}
                          disabled={
                            disabled ||
                            (field.type === "array" &&
                              typeof field.maxItems === "number" &&
                              rows.length >= field.maxItems)
                          }
                          onPress={() =>
                            update([
                              ...rows,
                              {
                                url: "",
                                refId: uuid.v4(),
                                label: nextImageLabel(rows, draft.values.prompt),
                              },
                            ])
                          }
                        />
                      </View>
                    ) : options.length ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                        {options.map((option) => (
                          <Button
                            key={String(option.value)}
                            label={`${value === option.value ? "✓ " : ""}${option.label}`}
                            disabled={disabled || optionLocked(option, data?.rank ?? 0, planRank)}
                            onPress={() => update(option.value)}
                          />
                        ))}
                      </View>
                    ) : field.type === "boolean" ? (
                      <Button
                        label={t(value ? "aiLab.on" : "aiLab.off")}
                        disabled={disabled}
                        onPress={() => update(!value)}
                      />
                    ) : (
                      <TextInput
                        accessibilityLabel={fieldLabel(field, name)}
                        style={inputStyle}
                        editable={!disabled}
                        multiline={
                          field.type === "array" ||
                          field.type === "object" ||
                          descriptor.ui.control === "textarea"
                        }
                        value={
                          typeof value === "string"
                            ? value
                            : field.type === "object"
                              ? JSON.stringify(value ?? {})
                              : serializeFieldValue(field, value)
                        }
                        onChangeText={(raw) => update(raw)}
                      />
                    )}
                  </View>
                );
              })
            : null}
          {preset ? (
            <ThemedText type="small">
              {t("aiLab.estimate")}{" "}
              {preset.billingPolicy.mode === "free"
                ? t("aiLab.free")
                : `${preset.billingPolicy.preflightCost ?? "—"} ${preset.billingPolicy.displayCurrency ?? ""}`}
            </ThemedText>
          ) : null}
          <Button
            label={t("aiLab.generate")}
            disabled={op.busy || !!pending || !!retryPending || !!draft?.upload || !usable}
            onPress={() => {
              try {
                prepare();
                setConfirm("generate");
              } catch (e) {
                fail(e);
              }
            }}
          />
          {draft ? (
            <Button
              label={t("aiLab.reset")}
              disabled={op.busy || !!pending || !!retryPending || !!draft?.upload}
              onPress={() => {
                setNextChoice(undefined);
                setConfirm("reset");
              }}
            />
          ) : null}
        </>
      ) : (
        <>
          <ThemedText type="small">{t("aiLab.historyLimit")}</ThemedText>
          {historyLoading ? <ActivityIndicator /> : null}
          {historyError ? <ThemedText>{historyError}</ThemedText> : null}
          {!jobs.length && !historyError && !historyLoading ? (
            <ThemedText>{t("aiLab.empty")}</ThemedText>
          ) : null}
          {jobs.map((job) => (
            <View
              key={job.id}
              style={{
                padding: 12,
                borderRadius: 8,
                backgroundColor: theme.backgroundElement,
                gap: 6,
              }}
            >
              <Button
                label={`${data?.catalog.models.find((m) => m.id === job.modelId)?.name ?? job.modelId} · ${t(`aiLab.status.${job.status}` as const)}`}
                disabled={op.busy}
                onPress={() =>
                  run(async () => {
                    const full = await getGenerationJob(
                      job.id,
                      generation,
                      controller.current!.signal,
                      workspaceId
                    );
                    selection.current = full.id;
                    setSelected(full);
                  })
                }
              />
              <ThemedText type="small">{job.prompt}</ThemedText>
              <ThemedText type="small">
                {t(`aiLab.status.${job.status}` as const)}
                {job.progress == null ? "" : ` · ${job.progress}%`}
              </ThemedText>
            </View>
          ))}
          {selected ? (
            <View style={{ gap: 8 }}>
              <ThemedText type="smallBold">{selected.modelId}</ThemedText>
              <ThemedText>
                {selected.error?.userMessage ?? t(`aiLab.status.${selected.status}` as const)}
              </ThemedText>
              {selected.outputs.map((result) => (
                <View key={result.id}>
                  {result.type === "image" ? (
                    <Image
                      source={{ uri: result.url }}
                      style={{ width: "100%", height: 200 }}
                      contentFit="contain"
                    />
                  ) : null}
                  {result.type === "video" && /^https?:\/\//i.test(result.url) ? (
                    <View style={{ height: 220 }}>
                      <ConversationVideo url={result.url} onRetry={() => setSelected(undefined)} />
                    </View>
                  ) : null}
                  <Button
                    label={t("aiLab.openResult")}
                    onPress={() =>
                      run(async () => {
                        if (!/^https?:\/\//i.test(result.url))
                          throw new Error(t("aiLab.invalidUrl"));
                        await Linking.openURL(result.url);
                      })
                    }
                  />
                </View>
              ))}
              {terminal(selected) &&
              selected.status !== "completed" &&
              selected.error?.retryable ? (
                <Button
                  label={t("aiLab.retryJob")}
                  disabled={
                    op.busy || !canGenerate || !!pending || !!retryPending || !!draft?.upload
                  }
                  onPress={() => setConfirm("retry")}
                />
              ) : null}
              {!terminal(selected) ? (
                <Button
                  label={t("aiLab.cancel")}
                  disabled={op.busy || !canGenerate}
                  onPress={() => setConfirm("cancel")}
                />
              ) : null}
            </View>
          ) : null}
        </>
      )}
      {confirm ? (
        <View style={{ padding: 12, gap: 8, backgroundColor: theme.backgroundElement }}>
          <ThemedText>
            {t(
              confirm === "generate" || confirm === "retry"
                ? "aiLab.confirmGenerate"
                : confirm === "cancel"
                  ? "aiLab.confirmCancel"
                  : confirm === "clear" || confirm === "clearRetry"
                    ? "aiLab.confirmClear"
                    : confirm === "discardUpload"
                      ? "aiLab.confirmDiscardUpload"
                      : "aiLab.confirmReset"
            )}
          </ThemedText>
          <Button
            label={t("aiLab.confirm")}
            disabled={op.busy}
            onPress={() => {
              if (confirm === "generate") submit();
              else if (confirm === "retry" && selected) {
                const command = { clientKey: uuid.v4(), jobId: selected.id, workspaceId };
                setConfirm(null);
                run(
                  async () => {
                    await retryGenerationOnce(
                      command,
                      userId,
                      generation,
                      controller.current!.signal,
                      storageScope
                    );
                  },
                  () => {
                    setRetryPending(null);
                    setEpoch((x) => x + 1);
                  }
                );
              } else if (confirm === "clearRetry" && retryPending) {
                try {
                  retryBox.clear(retryPending.clientKey);
                  setRetryPending(null);
                  setConfirm(null);
                } catch (e) {
                  fail(e);
                }
              } else if (confirm === "cancel" && selected) {
                const id = selected.id;
                setConfirm(null);
                run(
                  async () => {
                    const v = await cancelGeneration(
                      id,
                      generation,
                      controller.current!.signal,
                      workspaceId
                    );
                    setSelected(v);
                  },
                  () => setEpoch((x) => x + 1)
                );
              } else if (confirm === "discardUpload") {
                try {
                  const latest = store.read();
                  if (!latest || latest.upload?.storageKey !== draft?.upload?.storageKey)
                    throw new Error(t("aiLab.uploadChanged"));
                  save({ ...latest, upload: undefined });
                  setConfirm(null);
                } catch (e) {
                  fail(e);
                }
              } else if (confirm === "reset") {
                setConfirm(null);
                if (nextChoice) choose(nextChoice.presetId, nextChoice.modelId);
                else if (preset) choose(preset.id, model?.id);
                setNextChoice(undefined);
              } else if (confirm === "clear" && pending) {
                try {
                  box.clear(pending.clientKey);
                  setPending(null);
                  setConfirm(null);
                } catch (e) {
                  fail(e);
                }
              }
            }}
          />
          <Button label={t("aiLab.back")} disabled={op.busy} onPress={() => setConfirm(null)} />
        </View>
      ) : null}
    </ScrollView>
  );
}
