import { useIsFocused } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { durableRecord } from "@/lib/durable-record";
import {
  loadAgentWorkspaces,
  type StudioWorkspace,
} from "@/features/agent/api/studio-projects-api";
import { ProjectGenerationPanel } from "./project-panel";
export function canReadGenerationWorkspace(workspace: StudioWorkspace) {
  return (
    (workspace.status === undefined || workspace.status === "active") &&
    ((workspace.accessScope === "workspace" && !!workspace.role) ||
      workspace.accessScope === "project_only" ||
      !!workspace.crewRole)
  );
}
export function WorkspaceGenerationPanel(props: { userId: string; generation: number }) {
  return useIsFocused() && props.generation === getAuthGeneration() ? (
    <WorkspaceSession key={`${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function WorkspaceSession({ userId, generation }: { userId: string; generation: number }) {
  const active = useScreenActive();
  const t = useTranslations();
  const [record] = useState(() => durableRecord("ai-lab-workspace", userId, "selection"));
  const [rows, setRows] = useState<StudioWorkspace[]>([]),
    [selected, setSelected] = useState<string>(),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [epoch, setEpoch] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    // Refresh hides prior permissions until the official roster is read again.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setRows([]);
    setError("");
    void loadAgentWorkspaces(controller.signal)
      .then((all) => {
        if (controller.signal.aborted || generation !== getAuthGeneration()) return;
        const available = all.filter(canReadGenerationWorkspace),
          saved = record.read();
        const next = saved || available.find((w) => w.isDefault)?.id;
        setRows(available);
        setSelected(next);
        setOpen(!available.some((w) => w.id === next));
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [generation, epoch, record]);
  const workspace = rows.find((w) => w.id === selected);
  return (
    <View style={{ flex: 1, display: active ? "flex" : "none" }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            disabled={busy || loading}
            onPress={() => setOpen((v) => !v)}
            style={{ padding: 8, flexShrink: 1 }}
          >
            <ThemedText type="smallBold">
              {t("aiLab.workspace")}: {workspace?.name ?? t("aiLab.chooseWorkspace")}
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy || loading}
            onPress={() => setEpoch((v) => v + 1)}
            style={{ padding: 8 }}
          >
            <ThemedText type="small">{t("aiLab.refreshWorkspaces")}</ThemedText>
          </Pressable>
        </View>
        {loading ? (
          <ActivityIndicator />
        ) : error ? (
          <ThemedText>{error}</ThemedText>
        ) : !workspace ? (
          <ThemedText>{t("aiLab.workspaceUnavailable")}</ThemedText>
        ) : null}
        {open && !loading ? (
          <ScrollView style={{ maxHeight: 240 }}>
            {rows.map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                disabled={busy}
                style={{ padding: 10 }}
                onPress={() => {
                  try {
                    if (generation !== getAuthGeneration()) return;
                    record.write(row.id);
                    setSelected(row.id);
                    setOpen(false);
                    setError("");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                <ThemedText type="small">
                  {row.id === selected ? "✓ " : ""}
                  {row.name}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
      {!loading && workspace && !error ? (
        <ProjectGenerationPanel
          key={workspace.id}
          userId={userId}
          generation={generation}
          workspace={workspace}
          onBusyChange={setBusy}
        />
      ) : null}
    </View>
  );
}
