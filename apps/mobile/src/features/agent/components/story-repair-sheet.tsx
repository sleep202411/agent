import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import {
  parseStoryRepairCommand,
  storyRepairPending,
  type StoryRepairCommand,
  type StoryRepairDraft,
  type StoryRepairScope,
} from "../api/story-draft-repair-api";
import { StoryRepairConditionEditor } from "./story-repair-condition-editor";
import { replaceChoiceCondition } from "../lib/story-repair-conditions";
import type { StoryPublicationDiagnostic } from "../api/story-publication-errors";
import {
  repairBranches,
  repairChoiceExit,
  repairChoicePrompt,
  addRepairChoice,
  arrangeRepairChoice,
  updateRepairChoiceText,
  repairTargets,
  replaceRepairTarget,
  replaceRepairEntry,
  type RepairContent,
  sameRepairTarget,
} from "../lib/story-repair-fields";

type Props = {
  scope: StoryRepairScope;
  userId: string;
  issues: StoryPublicationDiagnostic[];
  onClose: () => void;
  onSaved: () => void;
};
export function StoryRepairSheet(props: Props) {
  return (
    <Modal visible animationType="slide" onRequestClose={props.onClose}>
      <RepairSession key={JSON.stringify(props.scope)} {...props} />
    </Modal>
  );
}
function RepairSession({ scope, userId, issues, onClose, onSaved }: Props) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const pending = useMemo(() => storyRepairPending(scope, userId), [scope, userId]);
  const local = useMemo(
    () => durableRecord("story-repair-draft", userId, `${scope.projectId}:${scope.chapterId}`),
    [scope, userId]
  );
  const life = useRef<AbortController | null>(null),
    locked = useRef(false);
  const [loaded, setLoaded] = useState<{ draft: StoryRepairDraft; canEdit: boolean }>();
  const [command, setCommand] = useState<StoryRepairCommand>();
  const [showSaved, setShowSaved] = useState(false);
  const [choosingEntry, setChoosingEntry] = useState(false);
  const [conditionChoice, setConditionChoice] = useState<string>();
  const [uncertain, setUncertain] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0),
    [selected, setSelected] = useState(issues.find((i) => i.nodeId)?.nodeId ?? "");
  const current = () =>
    !!life.current && !life.current.signal.aborted && scope.generation === getAuthGeneration();
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    void pending
      .reconcile(controller.signal)
      .then((result) => {
        if (controller.signal.aborted || scope.generation !== getAuthGeneration()) return;
        const raw = local.read();
        const saved = raw === null ? null : JSON.parse(raw);
        const localCommand = saved === null ? undefined : parseStoryRepairCommand(saved);
        if (result.applied) local.write("null");
        setLoaded(result);
        setCommand(result.pending ?? (result.applied ? undefined : localCommand));
        setUncertain(!!result.pending);
        setError(undefined);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [scope, pending, local, revision]);
  const refresh = () => {
    setLoading(true);
    setLoaded(undefined);
    setRevision((v) => v + 1);
  };
  const content = showSaved
    ? loaded?.draft.content
    : (command?.input.content ?? loaded?.draft.content);
  const node = content?.graph.nodes.find((n) => n.nodeId === selected);
  const conflict =
    !!command && !!loaded && command.input.expectedRevision !== loaded.draft.revision;
  const edit = (change: (value: RepairContent) => RepairContent) => {
    if (
      !current() ||
      locked.current ||
      !loaded?.canEdit ||
      !content ||
      showSaved ||
      uncertain ||
      conflict
    )
      return false;
    try {
      const next: StoryRepairCommand = command
        ? {
            ...command,
            input: {
              ...command.input,
              content: change(content),
            },
          }
        : {
            clientKey: uuid.v4(),
            input: {
              schemaVersion: "interactive-story-draft-v1",
              expectedRevision: loaded.draft.revision,
              sessionId: uuid.v4(),
              content: change(content),
            },
          };
      local.write(JSON.stringify(next));
      setCommand(next);
      setError(undefined);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const save = async () => {
    if (!current() || locked.current || !command || !loaded?.canEdit || conflict) return;
    locked.current = true;
    setBusy(true);
    try {
      const next = await pending.save(command, life.current!.signal);
      if (!current()) return;
      local.write("null");
      setCommand(undefined);
      setUncertain(false);
      setLoaded({ draft: next, canEdit: true });
      setError(undefined);
      onSaved();
    } catch (e) {
      if (current()) {
        try {
          setUncertain(!!pending.read());
        } catch {
          // Storage cannot establish the write outcome; retain the draft and lock edits.
          setUncertain(true);
        }
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      locked.current = false;
      if (current()) setBusy(false);
    }
  };
  const discard = () =>
    Alert.alert(t("storyRepair.discard"), t("storyRepair.discardHelp"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("storyRepair.discard"),
        style: "destructive",
        onPress: () => {
          if (!current() || locked.current) return;
          try {
            const saved = pending.read();
            if (saved) pending.discard(saved.clientKey);
            local.write("null");
            setCommand(undefined);
            setUncertain(false);
            refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      },
    ]);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <View
        style={{ paddingHorizontal: 16, flexDirection: "row", justifyContent: "space-between" }}
      >
        <ThemedText type="smallBold">{t("storyRepair.title")}</ThemedText>
        <RepairAction label={t("agent.close")} onPress={onClose} disabled={busy} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {loading ? <ActivityIndicator /> : null}
        {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
        <RepairAction label={t("common.retry")} onPress={refresh} disabled={busy || loading} />
        {!loading && loaded && content ? (
          <>
            {command ? (
              <View style={{ flexDirection: "row", gap: 16 }}>
                <RepairAction label={t("storyRepair.local")} onPress={() => setShowSaved(false)} />
                <RepairAction label={t("storyRepair.remote")} onPress={() => setShowSaved(true)} />
              </View>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              {t("storyRepair.help")}
            </ThemedText>
            <RepairAction
              label={`${t("storyRepair.entry")}: ${repairTargets(content, locale).find((target) => target.value.kind === "node" && target.value.nodeId === content.graph.entryNodeId)?.label ?? t("storyRepair.entryMissing")}`}
              onPress={() => setChoosingEntry((value) => !value)}
              disabled={busy}
            />
            {choosingEntry
              ? content.graph.nodes.map((entry) => (
                  <Pressable
                    key={entry.nodeId}
                    accessibilityRole="radio"
                    aria-checked={content.graph.entryNodeId === entry.nodeId}
                    accessibilityState={{ checked: content.graph.entryNodeId === entry.nodeId }}
                    disabled={!loaded.canEdit || busy || uncertain || conflict || showSaved}
                    onPress={() => edit((value) => replaceRepairEntry(value, entry.nodeId))}
                    style={{ minHeight: 44, justifyContent: "center" }}
                  >
                    <ThemedText type="small">
                      {content.graph.entryNodeId === entry.nodeId ? "● " : "○ "}
                      {typeof entry.name === "string" && entry.name ? entry.name : entry.nodeId}
                    </ThemedText>
                  </Pressable>
                ))
              : null}
            {issues.map((issue, index) => (
              <View key={index}>
                <RepairAction
                  label={issue.message}
                  onPress={() => {
                    if (issue.nodeId) setSelected(issue.nodeId);
                  }}
                  disabled={!issue.nodeId || busy}
                />
              </View>
            ))}
            {!node ? (
              <ThemedText>{t("storyRepair.nodeMissing")}</ThemedText>
            ) : (
              <>
                <ThemedText type="smallBold">
                  {typeof node.name === "string" ? node.name : node.nodeId}
                </ThemedText>
                {repairChoiceExit(content, selected) ? (
                  <>
                    <ThemedText type="small">{t("storyRepair.prompt")}</ThemedText>
                    <TextInput
                      accessibilityLabel={t("storyRepair.prompt")}
                      value={repairChoicePrompt(content, selected, locale)}
                      editable={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
                      onChangeText={(text) =>
                        edit((value) => updateRepairChoiceText(value, selected, locale, text))
                      }
                      style={{
                        color: theme.text,
                        minHeight: 44,
                        borderColor: theme.border,
                        borderWidth: 1,
                        borderRadius: 8,
                        padding: 10,
                      }}
                    />
                    <RepairAction
                      label={t("storyRepair.addChoice")}
                      disabled={
                        !loaded.canEdit ||
                        busy ||
                        uncertain ||
                        conflict ||
                        showSaved ||
                        repairBranches(content, selected, locale).length >= 6
                      }
                      onPress={() =>
                        edit((value) =>
                          addRepairChoice(value, selected, `choice:${uuid.v4()}`, locale)
                        )
                      }
                    />
                  </>
                ) : null}
                {repairBranches(content, selected, locale).map((branch) => (
                  <View
                    key={branch.choiceId ?? branch.index}
                    style={{
                      gap: 6,
                      borderWidth: 1,
                      borderColor: theme.border,
                      borderRadius: 8,
                      padding: 10,
                    }}
                  >
                    <ThemedText type="smallBold">
                      {t("storyRepair.branch").replace("{number}", String(branch.index + 1))}
                    </ThemedText>
                    {repairChoiceExit(content, selected) ? (
                      <TextInput
                        accessibilityLabel={`${t("storyRepair.choiceLabel")} ${branch.index + 1}`}
                        value={branch.label ?? ""}
                        placeholder={t("storyRepair.choiceLabel")}
                        placeholderTextColor={theme.textSecondary}
                        editable={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
                        onChangeText={(text) =>
                          edit((value) =>
                            updateRepairChoiceText(value, selected, locale, text, branch.index)
                          )
                        }
                        style={{
                          color: theme.text,
                          minHeight: 44,
                          borderColor: theme.border,
                          borderWidth: 1,
                          borderRadius: 8,
                          padding: 10,
                        }}
                      />
                    ) : null}
                    {branch.choiceId ? (
                      <RepairAction
                        label={t("storyCondition.title")}
                        disabled={busy || uncertain || conflict || showSaved}
                        onPress={() => setConditionChoice(branch.choiceId!)}
                      />
                    ) : null}
                    {branch.choiceId ? (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
                        <RepairAction
                          label={t("storyRepair.moveUp")}
                          disabled={
                            !loaded.canEdit ||
                            busy ||
                            uncertain ||
                            conflict ||
                            showSaved ||
                            branch.index === 0
                          }
                          onPress={() =>
                            edit((value) =>
                              arrangeRepairChoice(value, selected, branch.choiceId!, "up")
                            )
                          }
                        />
                        <RepairAction
                          label={t("storyRepair.moveDown")}
                          disabled={
                            !loaded.canEdit ||
                            busy ||
                            uncertain ||
                            conflict ||
                            showSaved ||
                            branch.index === repairBranches(content, selected, locale).length - 1
                          }
                          onPress={() =>
                            edit((value) =>
                              arrangeRepairChoice(value, selected, branch.choiceId!, "down")
                            )
                          }
                        />
                        <RepairAction
                          label={t("storyRepair.removeChoice")}
                          disabled={!loaded.canEdit || busy || uncertain || conflict || showSaved}
                          onPress={() =>
                            Alert.alert(
                              t("storyRepair.removeChoice"),
                              t("storyRepair.removeChoiceHelp"),
                              [
                                { text: t("common.cancel"), style: "cancel" },
                                {
                                  text: t("storyRepair.removeChoice"),
                                  style: "destructive",
                                  onPress: () =>
                                    edit((value) =>
                                      arrangeRepairChoice(
                                        value,
                                        selected,
                                        branch.choiceId!,
                                        "remove"
                                      )
                                    ),
                                },
                              ]
                            )
                          }
                        />
                      </View>
                    ) : null}
                    {repairTargets(content, locale).map((target) => {
                      const checked = sameRepairTarget(branch.target, target.value);
                      return (
                        <Pressable
                          key={JSON.stringify(target.value)}
                          accessibilityRole="radio"
                          aria-checked={checked}
                          accessibilityState={{
                            checked,
                            disabled: !loaded.canEdit || busy || uncertain || conflict || showSaved,
                          }}
                          disabled={!loaded.canEdit || busy || uncertain || conflict || showSaved}
                          onPress={() =>
                            edit((value) =>
                              replaceRepairTarget(value, selected, branch.index, target.value)
                            )
                          }
                          style={{ minHeight: 44, justifyContent: "center" }}
                        >
                          <ThemedText type="small">
                            {checked ? "● " : "○ "}
                            {target.label}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
                {!repairChoiceExit(content, selected) &&
                !repairBranches(content, selected, locale).length ? (
                  <ThemedText>{t("storyRepair.noBranches")}</ThemedText>
                ) : null}
              </>
            )}
            {!loaded.canEdit ? <ThemedText>{t("storyRepair.readOnly")}</ThemedText> : null}
            {command ? (
              <ThemedText>
                {t(
                  conflict
                    ? "storyRepair.conflict"
                    : uncertain
                      ? "storyRepair.uncertain"
                      : "storyRepair.savedLocally"
                )}
              </ThemedText>
            ) : null}
            <RepairAction
              label={t("documentEditor.save")}
              onPress={() => void save()}
              disabled={!command || !loaded.canEdit || busy || conflict}
            />
            {command ? (
              <RepairAction label={t("storyRepair.discard")} onPress={discard} disabled={busy} />
            ) : null}
          </>
        ) : null}
      </ScrollView>
      {conditionChoice && content && loaded ? (
        <StoryRepairConditionEditor
          key={`${selected}:${conditionChoice}`}
          content={content}
          condition={
            (
              repairChoiceExit(content, selected)?.choices as Record<string, unknown>[] | undefined
            )?.find((choice) => choice.choiceId === conditionChoice)?.visibleWhen
          }
          userId={userId}
          storageKey={`${scope.projectId}:${scope.chapterId}:${selected}:${conditionChoice}`}
          canEdit={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
          onApply={(value) =>
            edit((currentContent) =>
              replaceChoiceCondition(currentContent, selected, conditionChoice, value)
            )
          }
          onClose={() => setConditionChoice(undefined)}
        />
      ) : null}
    </View>
  );
}

function RepairAction({
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
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
