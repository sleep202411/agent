import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuid } from "expo-modules-core";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useIsFocused } from "expo-router";
import { useTranslations } from "@/i18n";
import { useStoryChapterContext } from "../context/story-chapter-context";
import {
  referenceKinds,
  referenceSpecSchema,
  storyReferences,
  type ReferenceSlot,
  type ReferenceSpec,
  type ReferenceVersion,
  type ReferenceReviewInput,
  type ReferenceScope,
} from "../api/story-references-api";
import { referenceCommands, type ReferenceCommand } from "../api/story-reference-commands";
import { referenceUpload } from "../api/story-reference-upload";

function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 10,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
// Native document pickers may make the app inactive without leaving this route.
export function StoryReferenceEntry() {
  const t = useTranslations(),
    auth = useAuth(),
    context = useStoryChapterContext(),
    active = useIsFocused();
  const [open, setOpen] = useState(false);
  if (auth.status !== "authenticated") return null;
  const edit = context.capabilities.includes("story.edit"),
    review = context.capabilities.includes("story.review");
  return (
    <>
      <Action
        label={t("references.title")}
        disabled={context.loading || !!context.error}
        onPress={() => setOpen(true)}
      />
      {open && active && !context.loading && !context.error && (
        <ReferencePanel
          key={`${context.projectId}:${auth.generation}:${edit}:${review}`}
          scope={{ projectId: context.projectId, generation: auth.generation }}
          userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
          edit={edit}
          review={review}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
export function ReferencePanel({
  scope,
  userId,
  edit,
  review,
  close,
}: {
  scope: ReferenceScope;
  userId: string;
  edit: boolean;
  review: boolean;
  close: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const { projectId, generation } = scope;
  const client = useMemo(() => storyReferences({ projectId, generation }), [projectId, generation]);
  const commands = useMemo(
    () => referenceCommands({ projectId, generation }, userId),
    [projectId, generation, userId]
  );
  const uploads = useMemo(
    () => referenceUpload({ projectId, generation }, userId),
    [projectId, generation, userId]
  );
  const life = useRef<AbortController | null>(null),
    locked = useRef(false);
  const [rows, setRows] = useState<ReferenceSlot[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string>(),
    [editor, setEditor] = useState<ReferenceSlot | "new">(),
    [reviewing, setReviewing] = useState<ReferenceVersion>();
  const [pending, setPending] = useState<ReferenceCommand | null>(null),
    [uploadPending, setUploadPending] = useState(false),
    [storageError, setStorageError] = useState("");
  const current = useCallback(
    () => !!life.current && !life.current.signal.aborted && getAuthGeneration() === generation,
    [generation]
  );
  const recover = useCallback(() => {
    try {
      setPending(commands.read());
      setUploadPending(!!uploads.read());
      setStorageError("");
    } catch (cause) {
      setStorageError(String(cause));
    }
  }, [commands, uploads]);
  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      try {
        const next = await client.list(signal);
        if (!signal.aborted && current()) {
          setRows(next);
          setError("");
        }
      } catch (cause) {
        if (!signal.aborted && current())
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!signal.aborted && current()) setLoading(false);
      }
    },
    [client, current]
  );
  useLayoutEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      recover();
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load, recover]);
  const run = async (operation: (signal: AbortSignal) => Promise<unknown>) => {
    if (!current() || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await operation(life.current!.signal);
      if (current()) {
        setEditor(undefined);
        setReviewing(undefined);
        await load(life.current!.signal);
      }
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      locked.current = false;
      if (current()) {
        recover();
        setBusy(false);
      }
    }
  };
  const submit = (command: ReferenceCommand) =>
    void run((signal) => commands.submit(command, signal, { edit, review }));
  const blocked = busy || loading || !!pending || uploadPending || !!storageError || !!error;
  const slot = rows.find((row) => row.id === selected);
  const confirmClear = () =>
    Alert.alert(t("references.discard"), t("references.discardHelp"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("references.discard"),
        style: "destructive",
        onPress: () => {
          if (!current() || locked.current) return;
          try {
            commands.clear();
            const saved = uploads.read();
            if (saved) uploads.clear(saved.clientKey);
            recover();
          } catch (cause) {
            setError(String(cause));
          }
        },
      },
    ]);
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            padding: 12,
          }}
        >
          <ThemedText type="smallBold">{t("references.title")}</ThemedText>
          <Action label={t("agent.close")} onPress={close} />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Action
              label={t("references.refresh")}
              disabled={busy || loading}
              onPress={() => void run(async () => {})}
            />
            <Action
              label={t("references.create")}
              disabled={blocked || !edit}
              onPress={() => {
                setEditor("new");
                setReviewing(undefined);
              }}
            />
          </View>
          {loading && <ActivityIndicator />}
          {!loading && !error && rows.length > 0 && (
            <ThemedText type="small">
              {rows.filter((row) => row.status === "approved").length}/{rows.length}{" "}
              {t("references.status.approved")}
            </ThemedText>
          )}
          {!!storageError && <ThemedText accessibilityRole="alert">{storageError}</ThemedText>}
          {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
          {(pending || uploadPending) && (
            <View style={{ gap: 8 }}>
              <ThemedText type="small">{t("references.pending")}</ThemedText>
              <Action
                label={t("references.retry")}
                disabled={
                  busy ||
                  !!storageError ||
                  (pending
                    ? pending.action === "review" || pending.action === "approve"
                      ? !review
                      : !edit
                    : !edit)
                }
                onPress={() =>
                  pending ? submit(pending) : void run((signal) => uploads.resume(signal))
                }
              />
              <Action label={t("references.discard")} disabled={busy} onPress={confirmClear} />
            </View>
          )}
          {editor ? (
            <SlotEditor
              key={editor === "new" ? "new" : editor.id}
              slot={editor === "new" ? undefined : editor}
              disabled={blocked || !edit}
              cancel={() => setEditor(undefined)}
              save={(spec) =>
                submit(
                  editor === "new"
                    ? { action: "create", clientKey: uuid.v4(), slot: spec }
                    : {
                        action: "update",
                        clientKey: uuid.v4(),
                        slotId: editor.id,
                        version: editor.version,
                        slot: spec,
                      }
                )
              }
            />
          ) : null}
          {!loading && !error && rows.length === 0 && (
            <ThemedText type="small">{t("references.empty")}</ThemedText>
          )}
          {rows.map((row) => (
            <Action
              key={row.id}
              label={`${row.key} · ${row.label} · ${t(`references.status.${row.status}`)}`}
              onPress={() => {
                setSelected(row.id);
                setReviewing(undefined);
              }}
            />
          ))}
          {slot && (
            <View style={{ gap: 12 }}>
              <ThemedText type="smallBold">{slot.label}</ThemedText>
              <ThemedText type="small">{slot.description}</ThemedText>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Action
                  label={t("references.edit")}
                  disabled={blocked || !edit}
                  onPress={() => setEditor(slot)}
                />
                <Action
                  label={t("references.upload")}
                  disabled={blocked || !edit}
                  onPress={() => void run((signal) => uploads.pick(slot.id, slot.version, signal))}
                />
              </View>
              {slot.versions.map((version) => (
                <View
                  key={version.id}
                  style={{
                    gap: 8,
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: theme.backgroundElement,
                  }}
                >
                  {!!version.asset.previewUrl &&
                    version.asset.moderationStatus !== "blocked" &&
                    version.asset.status === "ready" && (
                      <Image
                        source={{ uri: version.asset.previewUrl }}
                        style={{ width: "100%", height: 180 }}
                        resizeMode="contain"
                      />
                    )}
                  <ThemedText type="small">
                    {t("references.version")} {version.number}
                    {version.approved ? ` · ${t("references.status.approved")}` : ""}
                  </ThemedText>
                  <Action
                    label={t("references.review")}
                    disabled={
                      blocked ||
                      !review ||
                      version.approved ||
                      version.asset.status !== "ready" ||
                      version.asset.moderationStatus === "blocked"
                    }
                    onPress={() => setReviewing(version)}
                  />
                </View>
              ))}
              {reviewing && reviewing.slotId === slot.id && (
                <ReviewEditor
                  key={reviewing.id}
                  disabled={blocked || !review}
                  cancel={() => setReviewing(undefined)}
                  save={(input) =>
                    submit({
                      action: "review",
                      clientKey: uuid.v4(),
                      slotId: slot.id,
                      slotVersion: slot.version,
                      versionId: reviewing.id,
                      input: { ...input, expectedReviewRevision: reviewing.reviewRevision },
                    })
                  }
                />
              )}
              <ThemedText type="smallBold">{t("references.reuse")}</ThemedText>
              {rows
                .flatMap((row) => row.versions)
                .filter(
                  (version) =>
                    version.slotId !== slot.id &&
                    version.asset.kind === "image" &&
                    version.asset.status === "ready" &&
                    version.asset.moderationStatus !== "blocked"
                )
                .map((version) => (
                  <Action
                    key={version.id}
                    label={`${rows.find((row) => row.id === version.slotId)?.label} · ${t("references.version")} ${version.number}`}
                    disabled={blocked || !edit}
                    onPress={() =>
                      submit({
                        action: "import",
                        clientKey: uuid.v4(),
                        slotId: slot.id,
                        input: {
                          expectedSlotVersion: slot.version,
                          source: "import",
                          assetId: version.asset.id,
                          variantId: version.variantId,
                        },
                      })
                    }
                  />
                ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
function Field({
  label,
  value,
  change,
  disabled,
  multiline = false,
}: {
  label: string;
  value: string;
  change: (v: string) => void;
  disabled: boolean;
  multiline?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        editable={!disabled}
        multiline={multiline}
        style={{
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          padding: 10,
          borderRadius: 8,
          minHeight: multiline ? 80 : 42,
        }}
      />
    </View>
  );
}
function SlotEditor({
  slot,
  disabled,
  save,
  cancel,
}: {
  slot?: ReferenceSlot;
  disabled: boolean;
  save: (s: ReferenceSpec) => void;
  cancel: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [key, setKey] = useState(slot?.key ?? ""),
    [label, setLabel] = useState(slot?.label ?? ""),
    [description, setDescription] = useState(slot?.description ?? ""),
    [kind, setKind] = useState<ReferenceSpec["kind"]>(slot?.kind ?? "character"),
    [required, setRequired] = useState(slot?.required ?? true),
    [rank, setRank] = useState(String(slot?.rank ?? 0)),
    [error, setError] = useState("");
  return (
    <View style={{ gap: 10 }}>
      <Field label={t("references.key")} value={key} change={setKey} disabled={disabled} />
      <Field label={t("references.label")} value={label} change={setLabel} disabled={disabled} />
      <Field
        label={t("references.description")}
        value={description}
        change={setDescription}
        disabled={disabled}
        multiline
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {referenceKinds.map((value) => (
          <Action
            key={value}
            label={`${kind === value ? "✓ " : ""}${t(`references.kind.${value}`)}`}
            disabled={disabled}
            onPress={() => setKind(value)}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ThemedText type="small">{t("references.required")}</ThemedText>
        <Switch
          trackColor={{ false: theme.backgroundElement, true: theme.brand }}
          accessibilityLabel={t("references.required")}
          value={required}
          onValueChange={setRequired}
          disabled={disabled}
        />
      </View>
      <Field label={t("references.rank")} value={rank} change={setRank} disabled={disabled} />
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Action
        label={t("references.save")}
        disabled={disabled}
        onPress={() => {
          const parsed = referenceSpecSchema.safeParse({
            key,
            label,
            description,
            kind,
            required,
            rank: rank.trim() ? Number(rank) : NaN,
          });
          if (parsed.success) save(parsed.data);
          else setError(t("references.invalid"));
        }}
      />
      <Action label={t("common.cancel")} disabled={disabled} onPress={cancel} />
    </View>
  );
}
function ReviewEditor({
  disabled,
  save,
  cancel,
}: {
  disabled: boolean;
  save: (v: Omit<ReferenceReviewInput, "expectedReviewRevision">) => void;
  cancel: () => void;
}) {
  const t = useTranslations();
  const [decision, setDecision] = useState<ReferenceReviewInput["decision"]>("request_changes"),
    [comment, setComment] = useState("");
  const [checklist, setChecklist] = useState<ReferenceReviewInput["checklist"]>({
    technical: "na",
    identityContinuity: "na",
    rights: "na",
    safety: "na",
  });
  return (
    <View style={{ gap: 8 }}>
      {(["technical", "identityContinuity", "rights", "safety"] as const).map((key) => (
        <View key={key} style={{ gap: 4 }}>
          <ThemedText type="small">{t(`references.check.${key}`)}</ThemedText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["pass", "fail", "na"] as const).map((value) => (
              <Action
                key={value}
                label={`${checklist[key] === value ? "✓ " : ""}${t(`references.check.${value}`)}`}
                disabled={disabled}
                onPress={() => setChecklist((old) => ({ ...old, [key]: value }))}
              />
            ))}
          </View>
        </View>
      ))}
      {(["approve", "reject", "request_changes"] as const).map((value) => (
        <Action
          key={value}
          label={`${decision === value ? "✓ " : ""}${t(`references.decision.${value}`)}`}
          disabled={disabled}
          onPress={() => setDecision(value)}
        />
      ))}
      <Field
        label={t("references.comment")}
        value={comment}
        change={setComment}
        disabled={disabled}
        multiline
      />
      <Action
        label={t("references.submitReview")}
        disabled={
          disabled ||
          (decision === "approve"
            ? [checklist.technical, checklist.rights, checklist.safety].some((v) => v !== "pass")
            : !comment.trim())
        }
        onPress={() => save({ decision, checklist, comment })}
      />
      <Action label={t("common.cancel")} disabled={disabled} onPress={cancel} />
    </View>
  );
}
