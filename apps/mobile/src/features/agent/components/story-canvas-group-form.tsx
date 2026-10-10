import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { uuid } from "expo-modules-core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import {
  canvasGroups,
  CANVAS_GROUP_COLORS,
  type CanvasGroupEdit,
} from "../../../../canvas-editor/group-schema";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import { canvasOverview } from "../lib/story-canvas-overview";
import {
  canvasGroupBaseline,
  canvasGroupDraftStore,
  type CanvasGroupDraft,
} from "../lib/story-canvas-group-draft";
import { canvasUpdatePending, type CanvasUpdateCommand } from "../api/story-canvas-update";
import type { CanvasEditScope } from "../lib/story-canvas-draft";
import {
  openPlatformCanvasDocument,
  platformCanvasUpdatePending,
} from "../api/platform-canvas-document";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasEncoder } from "./story-canvas-encoder";

export function StoryCanvasGroupForm({
  scope,
  userId,
  loaded,
  canEdit,
  close,
  saved,
}: {
  scope: CanvasEditScope;
  userId: string;
  loaded: CanvasLoaded;
  canEdit: boolean;
  close(): void;
  saved(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const store = useMemo(() => canvasGroupDraftStore(scope, userId), [scope, userId]);
  const client = useMemo(
    () =>
      "kind" in scope
        ? platformCanvasUpdatePending(scope, userId)
        : canvasUpdatePending(scope, userId),
    [scope, userId]
  );
  const [initial] = useState(() => {
    try {
      return { draft: store.read() };
    } catch (cause) {
      return { error: String(cause) };
    }
  });
  const [draft, setDraft] = useState<CanvasGroupDraft | null>(initial.draft ?? null),
    [error, setError] = useState(initial.error);
  const [phase, setPhase] = useState<"idle" | "refresh" | "encode" | "save">("idle");
  const [fresh, setFresh] = useState<CanvasLoaded>(),
    [expanded, setExpanded] = useState<string>();
  const life = useRef<AbortController | null>(null),
    busy = useRef(false);
  useLayoutEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    return () => controller.abort();
  }, []);
  const current = () =>
    !!life.current && !life.current.signal.aborted && getAuthGeneration() === scope.generation;
  const failed = (cause: unknown) => {
    if (!current()) return;
    busy.current = false;
    setPhase("idle");
    setError(cause instanceof Error ? cause.message : String(cause));
  };
  const groups = useMemo(
    () => canvasGroups(loaded.snapshot.groups, Object.keys(loaded.snapshot.nodes)),
    [loaded]
  );
  const nodes = useMemo(() => canvasOverview(loaded.snapshot).nodes, [loaded]);
  const selected = draft?.stage === "selection" ? draft.nodeIds : [];
  const completeGroup = groups.find(
    (group) =>
      group.nodeIds.length === selected.length && group.nodeIds.every((id) => selected.includes(id))
  );
  const action = canEdit && draft?.stage === "action" ? draft : undefined;
  const actionGroupId = action && "groupId" in action.edit ? action.edit.groupId : undefined;
  const choose = (edit: CanvasGroupEdit) => {
    if (!current() || !canEdit || busy.current || action || initial.error) return;
    try {
      const next = {
        stage: "action" as const,
        edit,
        baseline: canvasGroupBaseline(loaded.snapshot, edit),
      };
      store.write(next);
      setDraft(next);
      setError(undefined);
    } catch (cause) {
      failed(cause);
    }
  };
  const select = (ids: string[]) => {
    if (!current() || !canEdit || busy.current || action || initial.error) return;
    try {
      const next = ids.length ? { stage: "selection" as const, nodeIds: ids } : null;
      store.write(next);
      setDraft(next);
      setError(undefined);
    } catch (cause) {
      failed(cause);
    }
  };
  const submit = async (command: CanvasUpdateCommand) => {
    if (!current() || !canEdit) return;
    setPhase("save");
    try {
      await client.submit(command, life.current!.signal);
      if (!current()) return;
      store.write(null);
      saved();
    } catch (cause) {
      failed(cause);
    }
  };
  const save = () => {
    if (!current() || !canEdit || !action || busy.current) return;
    busy.current = true;
    setError(undefined);
    try {
      store.write(action);
      const pending = client.read();
      if (
        pending &&
        (!action.command ||
          pending.clientKey !== action.command.clientKey ||
          pending.yjsUpdateBase64 !== action.command.yjsUpdateBase64)
      )
        throw Error(t("storyCanvas.pendingMismatch"));
      if (action.command) void submit(action.command);
      else setPhase("refresh");
    } catch (cause) {
      failed(cause);
    }
  };
  const discard = () =>
    Alert.alert(t("storyCanvas.discard"), t("storyCanvas.discardBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("storyCanvas.discard"),
        style: "destructive",
        onPress: () => {
          if (!current() || !canEdit || busy.current || action?.command) return;
          try {
            if (client.read()) throw Error(t("storyCanvas.pendingMismatch"));
            store.write(null);
            setDraft(null);
            setError(undefined);
          } catch (cause) {
            failed(cause);
          }
        },
      },
    ]);
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          padding: 16,
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 16,
          gap: 12,
        }}
      >
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <ThemedText type="smallBold">{t("storyCanvas.groups.title")}</ThemedText>
          <GroupAction label={t("agent.close")} onPress={close} />
        </View>
        {error && (
          <ThemedText type="small" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}
        {action ? (
          <>
            <ThemedText type="smallBold">
              {t(`storyCanvas.groups.${action.edit.operation}`)}
            </ThemedText>
            {"nodeIds" in action.edit && (
              <ThemedText type="small">
                {action.edit.nodeIds
                  .map((id) => nodes.find((node) => node.id === id)?.title ?? id)
                  .join(" · ")}
              </ThemedText>
            )}
            {"groupId" in action.edit && action.edit.operation !== "create" && (
              <ThemedText type="small">
                {t("storyCanvas.groups.group")}{" "}
                {groups.findIndex((group) => group.id === actionGroupId) + 1 || "—"}
              </ThemedText>
            )}
            {action.edit.operation === "color" && (
              <ThemedText type="small">
                {t(`storyCanvas.groups.color.${action.edit.color}`)}
              </ThemedText>
            )}
            {action.edit.operation === "move" && (
              <ThemedText type="small">
                {t("storyCanvas.groups.move")}: {action.edit.delta.x}, {action.edit.delta.y}
              </ThemedText>
            )}
            <ThemedText type="small">
              {t(action.command ? "storyCanvas.pending" : "storyCanvas.draftSaved")}
            </ThemedText>
            {phase !== "idle" ? (
              <ActivityIndicator />
            ) : (
              canEdit && (
                <GroupAction
                  label={t(action.command ? "common.retry" : "storyCanvas.save")}
                  onPress={save}
                />
              )
            )}
            {canEdit && !action.command && phase === "idle" && (
              <GroupAction label={t("storyCanvas.discard")} onPress={discard} />
            )}
          </>
        ) : (
          <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
            {canEdit && (
              <>
                <ThemedText type="small">{t("storyCanvas.groups.select")}</ThemedText>
                {selected.some((id) => !loaded.snapshot.nodes[id]) && (
                  <ThemedText type="small" accessibilityRole="alert">
                    {t("storyCanvas.changed")}
                  </ThemedText>
                )}
                {nodes.map((node) => (
                  <Pressable
                    key={node.id}
                    accessibilityRole="checkbox"
                    aria-checked={selected.includes(node.id)}
                    accessibilityState={{ checked: selected.includes(node.id) }}
                    disabled={!!initial.error}
                    onPress={() =>
                      select(
                        selected.includes(node.id)
                          ? selected.filter((id) => id !== node.id)
                          : [...selected, node.id]
                      )
                    }
                    style={{
                      padding: 12,
                      borderWidth: 1,
                      borderRadius: 8,
                      borderColor: selected.includes(node.id) ? theme.brand : theme.border,
                    }}
                  >
                    <ThemedText type="small">{node.title}</ThemedText>
                  </Pressable>
                ))}
                {selected.length > 0 && (
                  <GroupAction label={t("storyCanvas.groups.clear")} onPress={() => select([])} />
                )}
                <GroupAction
                  label={t(
                    completeGroup ? "storyCanvas.groups.ungroup" : "storyCanvas.groups.create"
                  )}
                  disabled={selected.length < 2 || !!initial.error}
                  onPress={() =>
                    choose(
                      completeGroup
                        ? { operation: "ungroup", groupId: completeGroup.id }
                        : {
                            operation: "create",
                            groupId: `group-${uuid.v4()}`,
                            nodeIds: selected,
                          }
                    )
                  }
                />
                {selected.some((id) => groups.some((group) => group.nodeIds.includes(id))) && (
                  <GroupAction
                    label={t("storyCanvas.groups.remove")}
                    onPress={() => choose({ operation: "remove", nodeIds: selected })}
                  />
                )}
              </>
            )}
            {groups.length === 0 && (
              <ThemedText type="small">{t("storyCanvas.groups.empty")}</ThemedText>
            )}
            {groups.map((group, index) => (
              <View
                key={group.id}
                style={{
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 8,
                  padding: 12,
                  gap: 8,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: expanded === group.id }}
                  onPress={() => setExpanded(expanded === group.id ? undefined : group.id)}
                  style={{ paddingVertical: 8 }}
                >
                  <ThemedText type="smallBold">
                    {t("storyCanvas.groups.group")} {index + 1}
                  </ThemedText>
                  <ThemedText type="small">
                    {group.nodeIds
                      .map((id) => nodes.find((node) => node.id === id)?.title ?? id)
                      .join(" · ")}
                  </ThemedText>
                </Pressable>
                {expanded === group.id && (
                  <>
                    <ThemedText type="small">
                      {t(`storyCanvas.groups.color.${group.color}`)}
                    </ThemedText>
                    {canEdit && !initial.error && (
                      <>
                        <GroupAction
                          label={t("storyCanvas.groups.add")}
                          disabled={!selected.some((id) => !group.nodeIds.includes(id))}
                          onPress={() =>
                            choose({ operation: "add", groupId: group.id, nodeIds: selected })
                          }
                        />
                        <GroupAction
                          label={t("storyCanvas.groups.ungroup")}
                          onPress={() => choose({ operation: "ungroup", groupId: group.id })}
                        />
                        <ThemedText type="smallBold">{t("storyCanvas.groups.color")}</ThemedText>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          {CANVAS_GROUP_COLORS.map((color) => (
                            <Pressable
                              key={color}
                              accessibilityRole="radio"
                              aria-checked={group.color === color}
                              accessibilityState={{ checked: group.color === color }}
                              onPress={() =>
                                choose({ operation: "color", groupId: group.id, color })
                              }
                              style={{
                                padding: 10,
                                borderWidth: 1,
                                borderRadius: 8,
                                borderColor: group.color === color ? theme.brand : theme.border,
                              }}
                            >
                              <ThemedText type="small">
                                {t(`storyCanvas.groups.color.${color}`)}
                              </ThemedText>
                            </Pressable>
                          ))}
                        </View>
                        <ThemedText type="small">{t("storyCanvas.groups.moveStep")}</ThemedText>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
                          {(
                            [
                              ["left", -80, 0],
                              ["right", 80, 0],
                              ["up", 0, -80],
                              ["down", 0, 80],
                            ] as const
                          ).map(([direction, x, y]) => (
                            <GroupAction
                              key={direction}
                              label={t(`storyCanvas.groups.${direction}`)}
                              onPress={() =>
                                choose({ operation: "move", groupId: group.id, delta: { x, y } })
                              }
                            />
                          ))}
                        </View>
                      </>
                    )}
                  </>
                )}
              </View>
            ))}
          </ScrollView>
        )}
        {phase === "refresh" && action && (
          <StoryCanvasReader
            scope={scope}
            platform={"kind" in scope ? { scope, load: openPlatformCanvasDocument } : undefined}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={failed}
            onResult={(value) => {
              if (!current()) return;
              try {
                if (
                  value.documentId !== scope.documentId ||
                  canvasGroupBaseline(value.snapshot, action.edit) !== action.baseline
                )
                  throw Error(t("storyCanvas.changed"));
                setFresh(value);
                setPhase("encode");
              } catch (cause) {
                failed(cause);
              }
            }}
          />
        )}
        {phase === "encode" && fresh && action && (
          <StoryCanvasEncoder
            loaded={fresh}
            edit={action.edit}
            generation={scope.generation}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={failed}
            onResult={(update) => {
              if (!current()) return;
              try {
                if (!update) {
                  store.write(null);
                  saved();
                  return;
                }
                const command = { clientKey: uuid.v4(), yjsUpdateBase64: update };
                const next = { ...action, command };
                store.write(next);
                setDraft(next);
                void submit(command);
              } catch (cause) {
                failed(cause);
              }
            }}
          />
        )}
      </View>
    </Modal>
  );
}
function GroupAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 10, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
