import { resultDetails, resultCreatedAt } from "./result-details";
import { setStringAsync } from "expo-clipboard";
import { saveOutput } from "./save-output";
import {
  loadProjectSkills,
  skillRows,
  skillSnapshot,
  toggleSkill,
  unavailableSkillIds,
  type ProjectSkills,
} from "./project-skills";
import { getGenerationProject, type GenerationProject } from "./projects-api";
import { matchesGenerationScope } from "./generation-scope";
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
import { useTranslations, useLocale } from "@/i18n";
import { ConversationAudio } from "@/features/services/conversation-audio";
import { ConversationVideo } from "@/features/services/conversation-video";
import { ApiRequestError } from "@/lib/api-client";
import { canUseGeneration, loadGenerationCatalog, planRank } from "./catalog-api";
import {
  canCreateStudioProject,
  type StudioWorkspace,
} from "@/features/agent/api/studio-projects-api";
import { prepareFormValues, unsupportedFormFields } from "./form-values";
import {
  buildReferenceContract,
  imageReferences,
  identifiedReferences,
  referenceLabel,
  nextReferenceLabel,
  objectVideoField,
  objectAudioField,
  type ReferenceKind,
  objectImageField,
  replaceImageUrl,
  referenceInputValues,
} from "./reference-contract";
import {
  acceptsReferenceImage,
  confirmReferenceUpload,
  pickReferenceImage,
  type ReferenceCheckpoint,
} from "./reference-image";
import { acceptsReferenceAudio, pickReferenceAudio } from "./reference-audio";
import { acceptsReferenceVideo, pickReferenceVideo } from "./reference-video";
import {
  referenceValues,
  referenceSnapshots,
  validateReferenceMedia,
} from "./reference-validation";
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
  project?: GenerationProject;
  onBusyChange?: (busy: boolean) => void;
};
export function GenerationPanel(props: PanelProps) {
  return useScreenActive() && props.generation === getAuthGeneration() ? (
    <Session
      key={`${props.userId}:${props.generation}:${props.workspace?.id ?? "personal"}:${props.workspace?.role}:${props.workspace?.crewRole}:${props.project?.kind}:${props.project?.id}:${props.project?.canGenerate}`}
      {...props}
    />
  ) : null;
}
function Session({ userId, generation, workspace, project, onBusyChange }: PanelProps) {
  const locale = useLocale();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation("ai-lab", true);
  const workspaceId = workspace?.id,
    storageScope = project ?? (workspace?.isDefault ? undefined : workspaceId);
  const jobScope = project ?? workspaceId;
  const canGenerate = project
    ? project.canGenerate
    : !workspace || canCreateStudioProject(workspace);
  async function assertProjectWrite() {
    if (!project) return;
    const fresh = await getGenerationProject(
      project.workspaceId,
      project,
      generation,
      controller.current!.signal
    );
    if (!fresh.canGenerate) throw new Error(t("aiLab.projectReadOnly"));
  }
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
    [skills, setSkills] = useState<ProjectSkills>(),
    [skillsOpen, setSkillsOpen] = useState(false),
    [jobs, setJobs] = useState<GenerationJob[]>([]),
    [selected, setSelected] = useState<GenerationJob>(),
    [referencePreview, setReferencePreview] = useState<string>(),
    [copiedPrompt, setCopiedPrompt] = useState<string>(),
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
  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ApiRequestError && [401, 403].includes(e.status ?? 0)) {
        denied.current = true;
        setPrivateDenied(true);
        setJobs([]);
        setSelected(undefined);
        setData(undefined);
        setSkills(undefined);
      }
      setError(e instanceof Error ? e.message : String(e));
    },
    [setPrivateDenied, setJobs, setSelected, setData, setSkills, setError]
  );
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    denied.current = false;
    // This effect begins a fresh catalog read after explicit refresh.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setSkills(undefined);
    void Promise.all([
      loadGenerationCatalog(generation, c.signal, workspaceId),
      project ? loadProjectSkills(project, generation, c.signal) : Promise.resolve(undefined),
    ])
      .then(([v, projectSkills]) => {
        if (c.signal.aborted || denied.current) return;
        setData(v);
        setSkills(projectSkills);
        setPrivateDenied(false);
      })
      .catch((e) => {
        if (!c.signal.aborted) fail(e);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [generation, epoch, fail, workspaceId, project]);
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
        const value = await listGenerationJobs(mode, generation, c.signal, jobScope);
        if (c.signal.aborted || denied.current) return;
        setJobs(value.jobs);
        setHistoryError("");
        const requested = selection.current;
        if (requested) {
          try {
            const detail = await getGenerationJob(requested, generation, c.signal, jobScope);
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
  }, [mode, generation, epoch, fail, jobScope]);
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
  const unsupportedFields =
    model && draft ? unsupportedFormFields(model.input_schema, draft.values) : [];
  function requestChoose(presetId: string, modelId?: string) {
    if (draft && (draft.presetId !== presetId || (modelId && draft.modelId !== modelId))) {
      setNextChoice({ presetId, modelId });
      setConfirm("reset");
    } else if (!draft) choose(presetId, modelId);
  }
  function choose(presetId: string, modelId?: string) {
    const p = data?.catalog.presets.find((p) => p.id === presetId),
      m = data?.catalog.models.find((m) => m.id === (modelId ?? p?.modelIds[0]));
    if (!p || !m) return;
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
    await assertProjectWrite();
    const receipt = await confirmReferenceUpload(value, generation, controller.current!.signal);
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
      const kind =
        value.kind === "ai_reference_audio"
          ? "audio"
          : value.kind === "ai_reference_video"
            ? "video"
            : "image";
      const rows = identifiedReferences(imageReferences(current), kind);
      next = rows.some((r) => r.assetId === receipt.mediaAssetId)
        ? rows
        : [
            ...rows,
            {
              url: receipt.url,
              assetId: receipt.mediaAssetId,
              refId: receipt.mediaAssetId,
              label: nextReferenceLabel(rows, latest.values.prompt, kind),
              ...(value.kind !== "ai_reference_image"
                ? {
                    durationSeconds: value.durationSeconds,
                    bytes: value.bytes,
                    ...(value.kind === "ai_reference_video"
                      ? { width: value.width, height: value.height }
                      : {}),
                  }
                : {}),
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
          ...(value.kind !== "ai_reference_image"
            ? {
                kind: value.kind === "ai_reference_audio" ? ("audio" as const) : ("video" as const),
                durationSeconds: value.durationSeconds,
                bytes: value.bytes,
                ...(value.kind === "ai_reference_video"
                  ? { width: value.width, height: value.height }
                  : {}),
              }
            : {}),
        },
      ],
    });
  }
  function uploadReference(
    field: string,
    multiple: boolean,
    objectItems = false,
    kind: ReferenceKind = "image"
  ) {
    if (!draft || draft.upload || !canGenerate || !model) return;
    run(async () => {
      await assertProjectWrite();
      const persist = (value: ReferenceCheckpoint) => {
        const latest = store.read();
        if (
          !latest ||
          latest.modelId !== draft.modelId ||
          latest.schemaVersion !== draft.schemaVersion
        )
          throw new Error(t("aiLab.uploadChanged"));
        save({ ...latest, upload: value });
      };
      const checkpoint =
        kind !== "image"
          ? await (kind === "audio" ? pickReferenceAudio : pickReferenceVideo)(
              model.input_schema,
              draft.values,
              field,
              generation,
              controller.current!.signal,
              persist,
              (draft.uploadedReferences ?? [])
                .filter(
                  (row) =>
                    (row.kind === "video" || row.kind === "audio") &&
                    keyHasUrl(referenceValues(model.input_schema, draft.values)[row.field], row.url)
                )
                .map((row) => ({
                  field: row.field,
                  kind: row.kind as "video" | "audio",
                  url: row.url,
                  assetId: row.mediaAssetId,
                  durationSeconds: row.durationSeconds,
                  bytes: row.bytes,
                }))
            )
          : await pickReferenceImage(
              field,
              multiple,
              generation,
              controller.current!.signal,
              persist,
              objectItems
            );
      if (checkpoint) await finishUpload(checkpoint);
    });
  }
  function prepare() {
    if (project && (!skills || loading)) throw new Error(t("aiLab.skillsNotReady"));
    if (skills && unavailableSkillIds(skills, mode, draft?.skillSelection).length)
      throw new Error(t("aiLab.skillsUnavailable"));
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
    const activeRaw = Object.fromEntries(
      Object.keys(values).map((key) => [key, draft.values[key]])
    );
    const media = referenceSnapshots(
      model.input_schema,
      activeRaw,
      (draft.uploadedReferences ?? [])
        .filter(
          (row) =>
            (row.kind === "video" || row.kind === "audio") && keyHasUrl(values[row.field], row.url)
        )
        .map((row) => ({
          field: row.field,
          kind: row.kind as "video" | "audio",
          url: row.url,
          assetId: row.mediaAssetId,
          durationSeconds: row.durationSeconds,
          bytes: row.bytes,
        }))
    );
    validateReferenceMedia(model.input_schema, values, media);
    const structured = ["referenceImages", "referenceVideos", "referenceAudios"].filter((name) => {
      const field = model.input_schema.properties[name];
      return field?.type === "array" && field.items.type === "object";
    });
    return generationCommand.parse({
      clientKey: uuid.v4(),
      workspaceId,
      projectId: project?.projectId,
      storyProjectId: project?.storyProjectId,
      skillSelection: draft.skillSelection,
      modelId: model.id,
      presetId: preset.id,
      campaignId: preset.campaignId,
      schemaVersion: model.schemaVersion,
      input: values,
      ...(structured.length > 0
        ? buildReferenceContract(
            {
              ...values,
              referenceImages:
                structured.includes("referenceImages") && values.referenceImages
                  ? draft.values.referenceImages
                  : [],
              referenceAudios:
                structured.includes("referenceAudios") && values.referenceAudios
                  ? draft.values.referenceAudios
                  : [],
              referenceVideos:
                structured.includes("referenceVideos") && values.referenceVideos
                  ? draft.values.referenceVideos
                  : [],
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
      if (pending && !matchesGenerationScope(pending, jobScope))
        throw new Error(t("aiLab.workspaceRequestMismatch"));
      const command = pending ?? prepare();
      setConfirm(null);
      run(
        async () => {
          await assertProjectWrite();
          if (!pending) {
            const fresh = await loadGenerationCatalog(
              generation,
              controller.current!.signal,
              workspaceId
            );
            const freshModel = fresh.catalog.models.find((item) => item.id === command.modelId);
            const freshPreset = fresh.catalog.presets.find((item) => item.id === command.presetId);
            setData(fresh);
            if (
              !freshModel ||
              !freshPreset ||
              !canUseGeneration(freshModel, freshPreset, fresh.rank) ||
              freshModel.schemaVersion !== command.schemaVersion ||
              JSON.stringify(freshModel.input_schema) !== JSON.stringify(model?.input_schema) ||
              JSON.stringify(freshPreset.billingPolicy) !== JSON.stringify(preset?.billingPolicy) ||
              freshPreset.campaignId !== command.campaignId ||
              fresh.rank !== data?.rank
            ) {
              throw new Error(t("aiLab.catalogChanged"));
            }
          }
          if (project && !pending) {
            const fresh = await loadProjectSkills(project, generation, controller.current!.signal);
            if (!skills || skillSnapshot(fresh) !== skillSnapshot(skills)) {
              setSkills(fresh);
              setSkillsOpen(true);
              throw new Error(t("aiLab.skillsChanged"));
            }
          }
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
  function refresh() {
    setError("");
    setEpoch((value) => value + 1);
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
        <Button label={t("common.retry")} onPress={refresh} />
      </View>
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        <Button label={t("aiLab.create")} onPress={() => setTab("create")} />
        <Button label={t("aiLab.history")} onPress={() => setTab("history")} />
        <Button label={t("common.retry")} disabled={op.busy} onPress={refresh} />
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
            {(["image", "video", "audio"] as const).map((value) => (
              <Button
                key={value}
                label={t(`aiLab.${value}`)}
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
          {project ? (
            <View style={{ gap: 6 }}>
              <Button
                label={`${t("aiLab.skills")} (${skills ? skillRows(skills, mode, draft?.skillSelection).filter((row) => row.selected).length : "…"})`}
                disabled={op.busy}
                onPress={() => setSkillsOpen((value) => !value)}
              />
              {skillsOpen ? (
                <>
                  <ThemedText type="small">{t("aiLab.skillsHint")}</ThemedText>
                  {!skills ? <ThemedText>{t("aiLab.skillsNotReady")}</ThemedText> : null}
                  {skills && !skillRows(skills, mode).length ? (
                    <ThemedText>{t("aiLab.noSkills")}</ThemedText>
                  ) : null}
                  {skills
                    ? skillRows(skills, mode, draft?.skillSelection).map((row) => (
                        <Button
                          key={row.id}
                          label={`${row.selected ? "✓ " : ""}${row.name ?? row.slug ?? row.id} · ${row.version.version}${row.defaultEnabled ? ` · ${t("aiLab.skillDefault")}` : ""}`}
                          disabled={
                            op.busy || !draft || !canGenerate || !!pending || !!retryPending
                          }
                          onPress={() => {
                            if (draft) {
                              try {
                                save({
                                  ...draft,
                                  skillSelection: toggleSkill(
                                    draft.skillSelection,
                                    row.id,
                                    !row.selected
                                  ),
                                });
                              } catch (e) {
                                fail(e);
                              }
                            }
                          }}
                        />
                      ))
                    : null}
                  {skills && unavailableSkillIds(skills, mode, draft?.skillSelection).length ? (
                    <ThemedText>{t("aiLab.skillsUnavailable")}</ThemedText>
                  ) : null}
                  {draft?.skillSelection ? (
                    <Button
                      label={t("aiLab.skillsReset")}
                      disabled={op.busy || !!pending || !!retryPending || !canGenerate}
                      onPress={() => save({ ...draft, skillSelection: undefined })}
                    />
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}
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
          {draft && unsupportedFields.length > 0 && (
            <View style={{ gap: 8 }}>
              <ThemedText accessibilityRole="alert">
                {t("aiLab.unsupportedSavedSettings")}
              </ThemedText>
              {unsupportedFields.map((name) => (
                <View key={name} style={{ gap: 4 }}>
                  <ThemedText type="small">
                    {name}: {JSON.stringify(draft.values[name])}
                  </ThemedText>
                  <Button
                    label={t("aiLab.removeSavedSetting").replace("{field}", name)}
                    disabled={op.busy || !!pending || !!retryPending || !!draft.upload}
                    onPress={() => {
                      if (
                        getAuthGeneration() !== generation ||
                        op.busy ||
                        pending ||
                        retryPending ||
                        draft.upload
                      )
                        return;
                      const values = { ...draft.values };
                      delete values[name];
                      try {
                        save({ ...draft, values });
                      } catch (e) {
                        fail(e);
                      }
                    }}
                  />
                </View>
              ))}
            </View>
          )}
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
                const video = acceptsReferenceVideo(descriptor);
                const audio = acceptsReferenceAudio(descriptor);
                const kind = audio ? "audio" : video ? "video" : "image";
                const objectImages =
                  objectImageField(descriptor) ||
                  objectVideoField(descriptor) ||
                  objectAudioField(descriptor);
                let rows: ReturnType<typeof imageReferences> | undefined;
                if (objectImages) {
                  try {
                    rows = identifiedReferences(imageReferences(value), kind);
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
                    {video || audio ? (
                      <ThemedText type="small">
                        {t(audio ? "aiLab.audioHelp" : "aiLab.videoHelp")}
                      </ThemedText>
                    ) : null}
                    {acceptsReferenceImage(descriptor) || video || audio ? (
                      <Button
                        label={t(
                          audio
                            ? "aiLab.uploadAudio"
                            : video
                              ? "aiLab.uploadVideo"
                              : "aiLab.uploadImage"
                        )}
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
                        onPress={() =>
                          uploadReference(name, field.type === "array", objectImages, kind)
                        }
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
                            <ThemedText type="smallBold">
                              {referenceLabel(row, index, kind)}
                            </ThemedText>
                            {kind === "image" && /^https?:\/\//.test(row.url) ? (
                              <Image
                                source={{ uri: row.url }}
                                style={{ width: 64, height: 64 }}
                                contentFit="cover"
                              />
                            ) : null}
                            {(video || audio) && typeof row.durationSeconds === "number" ? (
                              <ThemedText type="small">
                                {t(audio ? "aiLab.audioFacts" : "aiLab.videoFacts")
                                  .replace("{seconds}", String(row.durationSeconds))
                                  .replace("{width}", String(row.width ?? "—"))
                                  .replace("{height}", String(row.height ?? "—"))}
                              </ThemedText>
                            ) : null}
                            {(video || audio) && /^https:\/\//.test(row.url) ? (
                              <Button
                                label={t(
                                  audio ? "aiLab.previewAudioReference" : "aiLab.previewReference"
                                )}
                                disabled={op.busy}
                                onPress={() =>
                                  setReferencePreview(
                                    referencePreview === row.url ? undefined : row.url
                                  )
                                }
                              />
                            ) : null}
                            {audio && referencePreview === row.url ? (
                              <ConversationAudio url={row.url} />
                            ) : null}
                            {video && referencePreview === row.url ? (
                              <View style={{ height: 200 }}>
                                <ConversationVideo
                                  url={row.url}
                                  onRetry={() => setReferencePreview(undefined)}
                                />
                              </View>
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
                              {["referenceImages", "referenceVideos", "referenceAudios"].includes(
                                name
                              ) && model.input_schema.properties.prompt?.type === "string" ? (
                                <Button
                                  label={t("aiLab.mention").replace(
                                    "{label}",
                                    referenceLabel(row, index, kind)
                                  )}
                                  disabled={disabled}
                                  onPress={() => {
                                    try {
                                      save({
                                        ...draft,
                                        values: {
                                          ...draft.values,
                                          [name]: rows,
                                          prompt: `${typeof draft.values.prompt === "string" ? draft.values.prompt : ""}${draft.values.prompt ? " " : ""}@${referenceLabel(row, index, kind)}`,
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
                                label: nextReferenceLabel(rows, draft.values.prompt, kind),
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
            disabled={
              op.busy ||
              !!pending ||
              !!retryPending ||
              !!draft?.upload ||
              !usable ||
              (project !== undefined && (!skills || loading))
            }
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
                      jobScope
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
              <ThemedText type="smallBold">
                {data?.catalog.models.find((model) => model.id === selected.modelId)?.name ??
                  selected.modelId}
              </ThemedText>
              {resultCreatedAt(selected.createdAt, locale) ? (
                <ThemedText type="small">
                  {t("aiLab.resultCreated")}: {resultCreatedAt(selected.createdAt, locale)}
                </ThemedText>
              ) : null}
              <ThemedText type="small" selectable>
                {selected.prompt}
              </ThemedText>
              {selected.prompt ? (
                <Button
                  label={t(
                    copiedPrompt === `${selected.id}:${selected.prompt}`
                      ? "aiLab.promptCopied"
                      : "aiLab.copyPrompt"
                  )}
                  disabled={op.busy}
                  onPress={() => {
                    setCopiedPrompt(undefined);
                    run(
                      async () => {
                        if (!(await setStringAsync(selected.prompt)))
                          throw new Error(t("aiLab.copyPromptFailed"));
                      },
                      () => setCopiedPrompt(`${selected.id}:${selected.prompt}`)
                    );
                  }}
                />
              ) : null}
              <ThemedText>
                {selected.error?.userMessage ?? t(`aiLab.status.${selected.status}` as const)}
              </ThemedText>
              {selected.status === "completed" &&
              selected.type === "audio" &&
              !selected.outputs.some(
                (output) => output.type === "audio" && /^https?:\/\//i.test(output.url)
              ) ? (
                <ThemedText accessibilityRole="alert">{t("aiLab.audioNoOutput")}</ThemedText>
              ) : null}
              {selected.outputs.map((result) => (
                <View key={result.id}>
                  {resultDetails(result, locale).map(([label, value]) => (
                    <ThemedText key={label} type="small">
                      {t(label)}: {value}
                    </ThemedText>
                  ))}
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
                  {result.type === "audio" && /^https?:\/\//i.test(result.url) ? (
                    <ConversationAudio url={result.url} />
                  ) : null}
                  <Button
                    label={t("aiLab.saveResult")}
                    disabled={op.busy}
                    onPress={() =>
                      run(async () => {
                        const signal = controller.current!.signal;
                        await saveOutput(
                          result,
                          signal,
                          () => !signal.aborted && generation === getAuthGeneration()
                        );
                      })
                    }
                  />
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
                const command = {
                  clientKey: uuid.v4(),
                  jobId: selected.id,
                  workspaceId,
                  projectId: project?.projectId,
                  storyProjectId: project?.storyProjectId,
                };
                setConfirm(null);
                run(
                  async () => {
                    await assertProjectWrite();
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
                    await assertProjectWrite();
                    const v = await cancelGeneration(
                      id,
                      generation,
                      controller.current!.signal,
                      jobScope
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

function keyHasUrl(value: unknown, url: string): boolean {
  if (Array.isArray(value)) return value.some((row) => keyHasUrl(row, url));
  return typeof value === "string"
    ? value === url
    : !!value && typeof value === "object" && "url" in value && value.url === url;
}
