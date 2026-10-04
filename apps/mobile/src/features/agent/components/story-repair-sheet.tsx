import { StoryCoverEditor } from "./story-cover-editor";
import { StoryRepairFoundation } from "./story-repair-foundation";
import { updateRepairFoundation } from "../lib/story-repair-foundation";
import {
  emptyRepairHistory,
  captureRepairHistory,
  stepRepairHistory,
  type RepairHistory,
} from "../lib/story-repair-history";
import { StoryRepairPriceEditor } from "./story-repair-price-editor";
import { replaceRepairPointPrice } from "../lib/story-repair-price";
import { repairNodeLabels } from "../lib/story-repair-fields";
import {
  createRepairNode,
  updateRepairNodeText,
  removeRepairAttachedChoice,
} from "../lib/story-repair-nodes";
import { deleteRepairNode } from "../lib/story-repair-delete-node";
import { StoryRepairDuplicatePicker } from "./story-repair-duplicate-picker";
import { duplicateRepairNodes } from "../lib/story-repair-duplicate";
import { StoryRepairInteractionsEditor } from "./story-repair-interactions-editor";
import {
  readRepairInteractions,
  replaceRepairInteractions,
} from "../lib/story-repair-interactions";
import {
  createRepairEnding,
  renameRepairEnding,
  removeRepairEnding,
} from "../lib/story-repair-endings";
import { StoryRepairVariablesEditor } from "./story-repair-variables-editor";
import { readRepairVariables, replaceRepairVariables } from "../lib/story-repair-variables";
import { StoryRepairEffectsEditor } from "./story-repair-effects-editor";
import {
  repairEffects,
  replaceRepairEffects,
  type EffectTarget,
} from "../lib/story-repair-effects";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
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
import { TimelineEditor } from "./story-timeline-editor";
import { StoryRepairConditionEditor } from "./story-repair-condition-editor";
import type { StoryExitRoute } from "@repo/shared/story-stats";
import {
  replaceChoiceCondition,
  repairAutoRoutes,
  addRepairAutoRoute,
  replaceRepairAutoRoutes,
  moveRepairAutoRoute,
  repairVariables,
  replaceRepairAutoCondition,
} from "../lib/story-repair-conditions";
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
  const [loaded, setLoaded] = useState<{
    draft: StoryRepairDraft;
    canEdit: boolean;
    canGenerate?: boolean;
    defaultLocale: string;
    frameProfile?: "landscape_16_9" | "portrait_9_16";
  }>();
  const [coverOpen, setCoverOpen] = useState(false);
  const [foundationOpen, setFoundationOpen] = useState(false);
  const [history, setHistory] = useState(emptyRepairHistory);
  const [command, setCommand] = useState<StoryRepairCommand>();
  const [showSaved, setShowSaved] = useState(false);
  const [choosingEntry, setChoosingEntry] = useState(false);
  const [choosingNode, setChoosingNode] = useState(false);
  const [nodeSearch, setNodeSearch] = useState("");
  const [mediaNode, setMediaNode] = useState<string>();
  const [conditionChoice, setConditionChoice] = useState<string>();
  const [editingVariables, setEditingVariables] = useState(false);
  const [priceNode, setPriceNode] = useState<string>();
  const [duplicating, setDuplicating] = useState(false);
  const [interactionNode, setInteractionNode] = useState<string>();
  const [effectTarget, setEffectTarget] = useState<EffectTarget>();
  const [conditionRoute, setConditionRoute] = useState<{ index: number; route: StoryExitRoute }>();
  const [uncertain, setUncertain] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0),
    [selected, setSelected] = useState(issues.find((i) => i.nodeId)?.nodeId ?? "");
  const notifyReconciledSave = useEffectEvent(onSaved);
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
        setHistory(emptyRepairHistory());
        setLoaded(result);
        setCommand(result.pending ?? (result.applied ? undefined : localCommand));
        setUncertain(!!result.pending);
        setError(undefined);
        if (result.applied) notifyReconciledSave();
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
  const nodeLabels = content ? repairNodeLabels(content) : new Map<string, string>();
  const node = content?.graph.nodes.find((n) => n.nodeId === selected);
  const autoRoutes = content ? repairAutoRoutes(content, selected) : null;
  const matchingNodes =
    content?.graph.nodes.filter((candidate) =>
      `${candidate.nodeId} ${nodeLabels.get(candidate.nodeId) ?? ""}`
        .toLowerCase()
        .includes(nodeSearch.toLowerCase())
    ) ?? [];
  const conflict =
    !!command && !!loaded && command.input.expectedRevision !== loaded.draft.revision;
  const edit = (
    change: (value: RepairContent) => RepairContent,
    options?: { mergeKey?: string; history?: RepairHistory }
  ) => {
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
      const changed = change(content);
      if (JSON.stringify(changed) === JSON.stringify(content)) return true;
      const next: StoryRepairCommand = command
        ? {
            ...command,
            input: {
              ...command.input,
              content: changed,
            },
          }
        : {
            clientKey: uuid.v4(),
            input: {
              schemaVersion: "interactive-story-draft-v1",
              expectedRevision: loaded.draft.revision,
              sessionId: uuid.v4(),
              content: changed,
            },
          };
      local.write(JSON.stringify(next));
      setHistory(options?.history ?? captureRepairHistory(history, content, options?.mergeKey));
      setCommand(next);
      setError(undefined);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const restoreHistory = (direction: "undo" | "redo") => {
    if (!content) return;
    const next = stepRepairHistory(history, content, direction);
    if (!next) return;
    if (
      edit(() => next.content, { history: next.history }) &&
      !next.content.graph.nodes.some((node) => node.nodeId === selected)
    ) {
      setSelected(next.content.graph.entryNodeId ?? next.content.graph.nodes[0]?.nodeId ?? "");
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
      setLoaded({
        draft: next,
        canEdit: true,
        canGenerate: loaded.canGenerate,
        defaultLocale: loaded.defaultLocale,
        frameProfile: loaded.frameProfile,
      });
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
            <View style={{ flexDirection: "row", gap: 16 }}>
              <RepairAction
                label={t("storyHistory.undo")}
                onPress={() => restoreHistory("undo")}
                disabled={
                  !loaded.canEdit ||
                  busy ||
                  uncertain ||
                  conflict ||
                  showSaved ||
                  !history.past.length
                }
              />
              <RepairAction
                label={t("storyHistory.redo")}
                onPress={() => restoreHistory("redo")}
                disabled={
                  !loaded.canEdit ||
                  busy ||
                  uncertain ||
                  conflict ||
                  showSaved ||
                  !history.future.length
                }
              />
            </View>
            {command ? (
              <View style={{ flexDirection: "row", gap: 16 }}>
                <RepairAction label={t("storyRepair.local")} onPress={() => setShowSaved(false)} />
                <RepairAction label={t("storyRepair.remote")} onPress={() => setShowSaved(true)} />
              </View>
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
              {(["clip", "decision"] as const).map((kind) => (
                <RepairAction
                  key={kind}
                  label={t(kind === "clip" ? "storyNode.addScene" : "storyNode.addDecision")}
                  disabled={!loaded.canEdit || busy || uncertain || conflict || showSaved}
                  onPress={() => {
                    let nodeId: string | undefined;
                    const applied = edit((value) => {
                      const created = createRepairNode(
                        value,
                        kind,
                        locale,
                        loaded.defaultLocale,
                        uuid.v4(),
                        [t("storyNode.optionOne"), t("storyNode.optionTwo")]
                      );
                      nodeId = created.nodeId;
                      return created.content;
                    });
                    if (applied && nodeId) setSelected(nodeId);
                  }}
                />
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("storyFoundation.title")}
              accessibilityState={{ expanded: foundationOpen }}
              aria-expanded={foundationOpen}
              onPress={() => setFoundationOpen((value) => !value)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <ThemedText type="smallBold">
                {foundationOpen ? "▾ " : "▸ "}
                {t("storyFoundation.title")}
              </ThemedText>
            </Pressable>
            {foundationOpen ? (
              <StoryRepairFoundation
                content={content}
                canEdit={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
                onChange={(field, text) =>
                  edit((value) => updateRepairFoundation(value, field, text), {
                    mergeKey: `foundation:${field}`,
                  })
                }
              />
            ) : null}
            <RepairAction
              label={t("storyCover.title")}
              onPress={() => setCoverOpen(true)}
              disabled={busy || uncertain}
            />
            <RepairAction
              label={t("storyVariables.title")}
              onPress={() => setEditingVariables(true)}
              disabled={busy || uncertain || conflict || showSaved}
            />
            <RepairAction
              label={t("storyDuplicate.title")}
              disabled={!loaded.canEdit || busy || uncertain || conflict || showSaved}
              onPress={() => setDuplicating(true)}
            />
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
            <RepairAction
              label={`${t("storyRepair.inspectNode")}: ${node ? nodeLabels.get(node.nodeId) : t("storyRepair.entryMissing")}`}
              disabled={busy}
              onPress={() => setChoosingNode((value) => !value)}
            />
            {choosingNode ? (
              <View style={{ gap: 8 }}>
                <TextInput
                  accessibilityLabel={t("storyRepair.searchNodes")}
                  placeholder={t("storyRepair.searchNodes")}
                  placeholderTextColor={theme.textSecondary}
                  value={nodeSearch}
                  onChangeText={setNodeSearch}
                  style={{
                    minHeight: 44,
                    color: theme.text,
                    padding: 10,
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 8,
                  }}
                />
                {matchingNodes.length > 50 ? (
                  <ThemedText type="small">{t("storyRepair.refineSearch")}</ThemedText>
                ) : null}
                <ScrollView
                  nestedScrollEnabled
                  style={{ maxHeight: 200 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {!matchingNodes.length ? (
                    <ThemedText type="small">{t("storyRepair.noMatchingNode")}</ThemedText>
                  ) : null}
                  {matchingNodes.slice(0, 50).map((item) => (
                    <RepairAction
                      key={item.nodeId}
                      label={nodeLabels.get(item.nodeId)!}
                      onPress={() => {
                        setSelected(item.nodeId);
                        setChoosingNode(false);
                      }}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}
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
                <ThemedText type="smallBold">{nodeLabels.get(node.nodeId)}</ThemedText>
                <RepairAction
                  label={t("storyNode.remove")}
                  disabled={!loaded.canEdit || busy || uncertain || conflict || showSaved}
                  onPress={() =>
                    Alert.alert(t("storyNode.remove"), t("storyNode.removeHelp"), [
                      { text: t("common.cancel"), style: "cancel" },
                      {
                        text: t("storyNode.remove"),
                        style: "destructive",
                        onPress: () => {
                          if (edit((value) => deleteRepairNode(value, selected))) {
                            setSelected("");
                            setChoosingNode(true);
                          }
                        },
                      },
                    ])
                  }
                />
                <RepairAction
                  label={t("storyEffects.onEnter")}
                  disabled={busy || uncertain || conflict || showSaved}
                  onPress={() => setEffectTarget({ nodeId: selected })}
                />
                {node.kind === "clip" && repairChoiceExit(content, selected) ? (
                  <RepairAction
                    label={t("storyNode.removeAttachedChoice")}
                    disabled={!loaded.canEdit || busy || uncertain || conflict || showSaved}
                    onPress={() =>
                      Alert.alert(
                        t("storyNode.removeAttachedChoice"),
                        t("storyNode.removeAttachedChoiceHelp"),
                        [
                          { text: t("common.cancel"), style: "cancel" },
                          {
                            text: t("storyNode.removeAttachedChoice"),
                            style: "destructive",
                            onPress: () =>
                              edit((value) => removeRepairAttachedChoice(value, selected)),
                          },
                        ]
                      )
                    }
                  />
                ) : null}
                {node.kind === "clip" ? (
                  <>
                    <RepairAction
                      label={`${t("storyPrice.title")}: ${String(node.communityPointPrice ?? 0)}`}
                      disabled={busy || uncertain || conflict || showSaved}
                      onPress={() => setPriceNode(selected)}
                    />
                    <RepairAction
                      label={t("storyHotspot.title")}
                      disabled={busy || uncertain || conflict || showSaved}
                      onPress={() => setInteractionNode(selected)}
                    />
                    {(["name", "description"] as const).map((field) => (
                      <View key={field}>
                        <ThemedText type="small">
                          {t(field === "name" ? "storyNode.name" : "storyNode.description")}
                        </ThemedText>
                        <TextInput
                          accessibilityLabel={t(
                            field === "name" ? "storyNode.name" : "storyNode.description"
                          )}
                          value={typeof node[field] === "string" ? (node[field] as string) : ""}
                          multiline={field === "description"}
                          maxLength={field === "name" ? 120 : 4000}
                          editable={
                            loaded.canEdit && !busy && !uncertain && !conflict && !showSaved
                          }
                          onChangeText={(text) =>
                            edit((value) => updateRepairNodeText(value, selected, field, text), {
                              mergeKey: `${selected}:${field}`,
                            })
                          }
                          style={{
                            color: theme.text,
                            borderColor: theme.border,
                            borderWidth: 1,
                            borderRadius: 8,
                            minHeight: 44,
                            padding: 10,
                          }}
                        />
                      </View>
                    ))}
                    {command &&
                    !loaded.draft.content.graph.nodes.some((item) => item.nodeId === selected) ? (
                      <ThemedText type="small">{t("storyNode.saveForMedia")}</ThemedText>
                    ) : null}
                  </>
                ) : null}
                {node.kind === "clip" ? (
                  <RepairAction
                    label={t("storyRepair.media")}
                    disabled={busy || uncertain || conflict || showSaved}
                    onPress={() => {
                      if (
                        loaded.draft.content.graph.nodes.some((item) => item.nodeId === node.nodeId)
                      )
                        setMediaNode(node.nodeId);
                      else setError(t("storyNode.saveForMedia"));
                    }}
                  />
                ) : null}
                {autoRoutes ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t("storyRoute.help")}
                    </ThemedText>
                    {repairVariables(content, locale).length ? (
                      <RepairAction
                        label={t("storyRoute.add")}
                        disabled={
                          !loaded.canEdit ||
                          busy ||
                          uncertain ||
                          conflict ||
                          showSaved ||
                          autoRoutes.length >= 8
                        }
                        onPress={() => edit((value) => addRepairAutoRoute(value, selected))}
                      />
                    ) : (
                      <ThemedText type="small">{t("storyCondition.noVariables")}</ThemedText>
                    )}
                  </>
                ) : null}
                {repairChoiceExit(content, selected) ? (
                  <>
                    <ThemedText type="small">{t("storyRepair.prompt")}</ThemedText>
                    <TextInput
                      accessibilityLabel={t("storyRepair.prompt")}
                      value={repairChoicePrompt(content, selected, locale)}
                      editable={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
                      onChangeText={(text) =>
                        edit((value) => updateRepairChoiceText(value, selected, locale, text), {
                          mergeKey: `prompt:${selected}:${locale}`,
                        })
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
                    {loaded.defaultLocale && loaded.defaultLocale !== locale ? (
                      <View>
                        <ThemedText type="small">
                          {t("storyRepair.prompt")} ({loaded.defaultLocale})
                        </ThemedText>
                        <TextInput
                          accessibilityLabel={`${t("storyRepair.prompt")} (${loaded.defaultLocale})`}
                          value={repairChoicePrompt(content, selected, loaded.defaultLocale)}
                          maxLength={4000}
                          editable={
                            loaded.canEdit && !busy && !uncertain && !conflict && !showSaved
                          }
                          onChangeText={(text) =>
                            edit(
                              (value) =>
                                updateRepairChoiceText(value, selected, loaded.defaultLocale, text),
                              { mergeKey: `prompt:${selected}:${loaded.defaultLocale}` }
                            )
                          }
                          style={{
                            color: theme.text,
                            borderWidth: 1,
                            borderColor: theme.border,
                            borderRadius: 8,
                            minHeight: 44,
                            padding: 10,
                          }}
                        />
                      </View>
                    ) : null}
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
                      {autoRoutes && branch.index === autoRoutes.length - 1
                        ? t("storyRoute.fallback")
                        : t("storyRepair.branch").replace("{number}", String(branch.index + 1))}
                    </ThemedText>
                    {repairChoiceExit(content, selected) ? (
                      <TextInput
                        accessibilityLabel={`${t("storyRepair.choiceLabel")} ${branch.index + 1}`}
                        value={branch.label ?? ""}
                        placeholder={t("storyRepair.choiceLabel")}
                        placeholderTextColor={theme.textSecondary}
                        editable={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
                        onChangeText={(text) =>
                          edit(
                            (value) =>
                              updateRepairChoiceText(value, selected, locale, text, branch.index),
                            { mergeKey: `choice:${selected}:${branch.choiceId}:${locale}` }
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
                    {branch.choiceId && loaded.defaultLocale && loaded.defaultLocale !== locale ? (
                      <View>
                        <ThemedText type="small">
                          {t("storyRepair.choiceLabel")} ({loaded.defaultLocale})
                        </ThemedText>
                        <TextInput
                          accessibilityLabel={`${t("storyRepair.choiceLabel")} ${branch.index + 1} (${loaded.defaultLocale})`}
                          value={
                            repairBranches(content, selected, loaded.defaultLocale)[branch.index]
                              ?.label ?? ""
                          }
                          maxLength={4000}
                          editable={
                            loaded.canEdit && !busy && !uncertain && !conflict && !showSaved
                          }
                          onChangeText={(text) =>
                            edit(
                              (value) =>
                                updateRepairChoiceText(
                                  value,
                                  selected,
                                  loaded.defaultLocale,
                                  text,
                                  branch.index
                                ),
                              {
                                mergeKey: `choice:${selected}:${branch.choiceId}:${loaded.defaultLocale}`,
                              }
                            )
                          }
                          style={{
                            color: theme.text,
                            borderWidth: 1,
                            borderColor: theme.border,
                            borderRadius: 8,
                            minHeight: 44,
                            padding: 10,
                          }}
                        />
                      </View>
                    ) : null}
                    {autoRoutes && branch.index < autoRoutes.length - 1 ? (
                      <>
                        <RepairAction
                          label={t("storyRoute.condition")}
                          disabled={busy || uncertain || conflict || showSaved}
                          onPress={() =>
                            setConditionRoute({
                              index: branch.index,
                              route: autoRoutes[branch.index],
                            })
                          }
                        />
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
                                replaceRepairAutoRoutes(
                                  value,
                                  selected,
                                  moveRepairAutoRoute(
                                    repairAutoRoutes(value, selected)!,
                                    branch.index,
                                    branch.index - 1
                                  )
                                )
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
                              branch.index === autoRoutes.length - 2
                            }
                            onPress={() =>
                              edit((value) =>
                                replaceRepairAutoRoutes(
                                  value,
                                  selected,
                                  moveRepairAutoRoute(
                                    repairAutoRoutes(value, selected)!,
                                    branch.index,
                                    branch.index + 1
                                  )
                                )
                              )
                            }
                          />
                          <RepairAction
                            label={t("storyRoute.remove")}
                            disabled={!loaded.canEdit || busy || uncertain || conflict || showSaved}
                            onPress={() =>
                              Alert.alert(t("storyRoute.remove"), t("storyRoute.removeHelp"), [
                                { text: t("common.cancel"), style: "cancel" },
                                {
                                  text: t("storyRoute.remove"),
                                  style: "destructive",
                                  onPress: () =>
                                    edit((value) =>
                                      replaceRepairAutoCondition(
                                        value,
                                        selected,
                                        branch.index,
                                        autoRoutes[branch.index],
                                        undefined
                                      )
                                    ),
                                },
                              ])
                            }
                          />
                        </View>
                      </>
                    ) : null}
                    {branch.choiceId ? (
                      <RepairAction
                        label={t("storyEffects.onChoice")}
                        disabled={busy || uncertain || conflict || showSaved}
                        onPress={() =>
                          setEffectTarget({ nodeId: selected, choiceId: branch.choiceId! })
                        }
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
                    <RepairAction
                      label={t("storyEnding.create")}
                      disabled={!loaded.canEdit || busy || uncertain || conflict || showSaved}
                      onPress={() =>
                        edit((value) =>
                          createRepairEnding(
                            value,
                            selected,
                            branch.index,
                            locale,
                            loaded.defaultLocale,
                            t("storyEnding.new")
                          )
                        )
                      }
                    />
                    {repairTargets(content, locale)
                      .filter(
                        (target) =>
                          target.value.kind === "ending" &&
                          sameRepairTarget(branch.target, target.value)
                      )
                      .map((target) => {
                        const endingId = (target.value as { kind: "ending"; endingId: string })
                          .endingId;
                        const endings = (
                          content.storyBible as {
                            endings: { endingId: string; title: Record<string, string> }[];
                          }
                        ).endings;
                        const ending = endings.find((item) => item.endingId === endingId)!;
                        return (
                          <View key={endingId} style={{ gap: 8 }}>
                            {[...new Set([loaded.defaultLocale, locale])].map((language) => (
                              <View key={language}>
                                <ThemedText type="small">
                                  {t("storyEnding.title")} ({language})
                                </ThemedText>
                                <TextInput
                                  accessibilityLabel={`${t("storyEnding.title")} (${language})`}
                                  value={ending.title?.[language] ?? ""}
                                  maxLength={4000}
                                  editable={
                                    loaded.canEdit && !busy && !uncertain && !conflict && !showSaved
                                  }
                                  onChangeText={(title) =>
                                    edit(
                                      (value) =>
                                        renameRepairEnding(value, endingId, language, title),
                                      { mergeKey: `ending:${endingId}:${language}` }
                                    )
                                  }
                                  style={{
                                    color: theme.text,
                                    minHeight: 44,
                                    borderWidth: 1,
                                    borderColor: theme.border,
                                    borderRadius: 8,
                                    padding: 10,
                                  }}
                                />
                              </View>
                            ))}
                            <RepairAction
                              label={t("storyEnding.remove")}
                              disabled={
                                !loaded.canEdit || busy || uncertain || conflict || showSaved
                              }
                              onPress={() =>
                                Alert.alert(t("storyEnding.remove"), t("storyEnding.removeHelp"), [
                                  { text: t("common.cancel"), style: "cancel" },
                                  {
                                    text: t("storyEnding.remove"),
                                    style: "destructive",
                                    onPress: () =>
                                      edit((value) => removeRepairEnding(value, endingId)),
                                  },
                                ])
                              }
                            />
                          </View>
                        );
                      })}
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
      {coverOpen ? (
        <StoryCoverEditor
          key={`${scope.projectId}:${scope.generation}`}
          scope={scope}
          userId={userId}
          onClose={() => setCoverOpen(false)}
          onSaved={onSaved}
        />
      ) : null}
      {mediaNode && loaded ? (
        <TimelineEditor
          key={`${scope.chapterId}:${mediaNode}`}
          scope={scope}
          userId={userId}
          initialNodeId={mediaNode}
          canEdit={loaded.canEdit}
          canGenerate={loaded.canGenerate}
          onClose={() => {
            setMediaNode(undefined);
            onSaved();
          }}
        />
      ) : null}
      {priceNode && content && loaded ? (
        <StoryRepairPriceEditor
          key={priceNode}
          content={content}
          nodeId={priceNode}
          userId={userId}
          storageKey={`${scope.projectId}:${scope.chapterId}:${priceNode}`}
          canEdit={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
          applyError={error}
          onApply={(expected, price) =>
            edit((value) => replaceRepairPointPrice(value, priceNode, expected, price))
          }
          onClose={() => setPriceNode(undefined)}
        />
      ) : null}
      {duplicating && content && loaded ? (
        <StoryRepairDuplicatePicker
          content={content}
          initialNodeId={selected}
          canEdit={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
          error={error}
          onApply={(sources) => {
            let first: string | undefined;
            const applied = edit((value) => {
              const result = duplicateRepairNodes(value, sources, () => uuid.v4());
              first = result.created[0];
              return result.content;
            });
            if (applied && first) setSelected(first);
            return applied;
          }}
          onClose={() => setDuplicating(false)}
        />
      ) : null}
      {interactionNode && content && loaded ? (
        <StoryRepairInteractionsEditor
          key={interactionNode}
          scope={scope}
          frameProfile={loaded.frameProfile}
          content={content}
          nodeId={interactionNode}
          defaultLocale={loaded.defaultLocale}
          userId={userId}
          storageKey={`${scope.projectId}:${scope.chapterId}:${interactionNode}`}
          canEdit={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
          applyError={error}
          onApply={(interactions) =>
            edit((value) =>
              replaceRepairInteractions(
                value,
                interactionNode,
                readRepairInteractions(content, interactionNode),
                interactions
              )
            )
          }
          onClose={() => setInteractionNode(undefined)}
        />
      ) : null}
      {editingVariables && content && loaded ? (
        <StoryRepairVariablesEditor
          content={content}
          defaultLocale={loaded.defaultLocale}
          userId={userId}
          storageKey={`${scope.projectId}:${scope.chapterId}`}
          canEdit={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
          applyError={error}
          onApply={(variables) =>
            edit((value) =>
              replaceRepairVariables(
                value,
                readRepairVariables(content),
                variables,
                loaded.defaultLocale
              )
            )
          }
          onClose={() => setEditingVariables(false)}
        />
      ) : null}
      {effectTarget && content && loaded ? (
        <StoryRepairEffectsEditor
          key={`${effectTarget.nodeId}:${effectTarget.choiceId ?? "entry"}`}
          content={content}
          effects={repairEffects(content, effectTarget)}
          userId={userId}
          storageKey={`${scope.projectId}:${scope.chapterId}:${effectTarget.nodeId}:${effectTarget.choiceId ?? "entry"}`}
          canEdit={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
          applyError={error}
          onApply={(effects) =>
            edit((value) =>
              replaceRepairEffects(
                value,
                effectTarget,
                repairEffects(content, effectTarget),
                effects
              )
            )
          }
          onClose={() => setEffectTarget(undefined)}
        />
      ) : null}
      {conditionRoute && content && loaded ? (
        <StoryRepairConditionEditor
          context="route"
          key={`${selected}:route:${conditionRoute.index}`}
          content={content}
          condition={conditionRoute.route.when}
          userId={userId}
          storageKey={`${scope.projectId}:${scope.chapterId}:${selected}:route:${JSON.stringify(conditionRoute.route)}:${autoRoutes?.slice(0, conditionRoute.index).filter((route) => JSON.stringify(route) === JSON.stringify(conditionRoute.route)).length ?? 0}`}
          canEdit={loaded.canEdit && !busy && !uncertain && !conflict && !showSaved}
          applyError={error}
          onApply={(when) =>
            edit((value) =>
              replaceRepairAutoCondition(
                value,
                selected,
                conditionRoute.index,
                conditionRoute.route,
                when
              )
            )
          }
          onClose={() => setConditionRoute(undefined)}
        />
      ) : null}
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
          applyError={error}
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
