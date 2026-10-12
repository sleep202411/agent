import { CastingInvitesPanel } from "./casting-invites-panel";
import { SkillManagementPanel } from "./skill-management-panel";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { durableRecord } from "@/lib/durable-record";
import {
  canCreateStudioProject,
  type StudioWorkspace,
} from "@/features/agent/api/studio-projects-api";
import { GenerationPanel } from "./panel";
import {
  getGenerationProject,
  listGenerationProjects,
  projectSelection,
  type GenerationProject,
  type ProjectSelection,
} from "./projects-api";

export function ProjectGenerationPanel({
  userId,
  generation,
  workspace,
  onBusyChange,
}: {
  userId: string;
  generation: number;
  workspace: StudioWorkspace;
  onBusyChange: (value: boolean) => void;
}) {
  const t = useTranslations();
  const [record] = useState(() => durableRecord("ai-lab-project", userId, workspace.id));
  const [initial] = useState(() => {
    try {
      const raw = record.read();
      return {
        selected: raw && raw !== "null" ? projectSelection.parse(JSON.parse(raw)) : null,
        error: "",
      };
    } catch (e) {
      return { selected: null, error: String(e) };
    }
  });
  const [selected, setSelected] = useState<ProjectSelection | null>(initial.selected),
    [project, setProject] = useState<GenerationProject>(),
    [rows, setRows] = useState<Awaited<ReturnType<typeof listGenerationProjects>>>([]),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(!!initial.selected),
    [error, setError] = useState(initial.error),
    [epoch, setEpoch] = useState(0),
    [busy, setBusy] = useState(false),
    [manageSkills, setManageSkills] = useState(false),
    [manageCasting, setManageCasting] = useState(false);
  const reportBusy = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusyChange(value);
    },
    [onBusyChange]
  );
  const workspaceAccess = workspace.accessScope === "workspace" || !!workspace.crewRole;
  useEffect(() => {
    if (!open && !selected) return;
    const c = new AbortController();
    // Re-read access before mounting a project composer; never retain stale role data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setProject(undefined);
    setError("");
    void Promise.all([
      open ? listGenerationProjects(workspace.id, generation, c.signal) : Promise.resolve(null),
      selected
        ? getGenerationProject(workspace.id, selected, generation, c.signal)
        : Promise.resolve(undefined),
    ])
      .then(([list, value]) => {
        if (c.signal.aborted || generation !== getAuthGeneration()) return;
        if (list) setRows(list);
        setProject(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setRows([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [generation, workspace.id, selected, open, epoch]);
  const current =
    selected && project?.id === selected.id && project.kind === selected.kind ? project : undefined;
  function choose(value: ProjectSelection | null) {
    if (busy || generation !== getAuthGeneration()) return;
    try {
      record.write(JSON.stringify(value));
      setProject(undefined);
      setSelected(value);
      setManageCasting(false);
      setManageSkills(false);
      setOpen(false);
      setError("");
      setLoading(!!value);
    } catch (e) {
      setError(String(e));
    }
  }
  const canRender = !loading && !error && (selected ? !!current : workspaceAccess);
  const button = (label: string, onPress: () => void, key?: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={{ padding: 10 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, gap: 4 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {button(
            `${t("aiLab.project")}: ${current?.title ?? (selected ? t("aiLab.chooseProject") : t("aiLab.noProject"))}`,
            () => setOpen((v) => !v)
          )}
          {selected || open
            ? button(t("aiLab.refreshProjects"), () => {
                setProject(undefined);
                setEpoch((v) => v + 1);
              })
            : null}
        </View>
        {current ? (
          <ThemedText type="small">
            {t(current.canGenerate ? "aiLab.projectBilling" : "aiLab.projectReadOnly")}
          </ThemedText>
        ) : !selected && workspaceAccess ? (
          <ThemedText type="small">
            {canCreateStudioProject(workspace)
              ? t("aiLab.workspaceBilling").replace("{name}", workspace.name)
              : t("aiLab.workspaceReadOnly")}
          </ThemedText>
        ) : (
          <ThemedText type="small">{t("aiLab.chooseProject")}</ThemedText>
        )}
        {loading ? <ActivityIndicator /> : null}
        {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
        {open ? (
          <ScrollView style={{ maxHeight: 220 }}>
            {workspaceAccess ? button(t("aiLab.noProject"), () => choose(null)) : null}
            {rows.map((row) =>
              button(
                `${row.title} · ${t(row.kind === "story" ? "aiLab.storyProject" : "aiLab.creativeProject")}`,
                () => choose({ kind: row.kind, id: row.id }),
                `${row.kind}:${row.id}`
              )
            )}
            {!loading && !error && !rows.length ? (
              <ThemedText type="small">{t("aiLab.noProjects")}</ThemedText>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
      {current && !manageSkills && !manageCasting
        ? button(t("aiLab.manageSkills"), () => setManageSkills(true))
        : null}
      {current?.kind === "platform" && current.canGenerate && !manageCasting && !manageSkills
        ? button(t("casting.title"), () => setManageCasting(true))
        : null}
      {canRender && current?.kind === "platform" && manageCasting ? (
        <CastingInvitesPanel
          key={current.id}
          userId={userId}
          generation={generation}
          project={current}
          onBack={() => setManageCasting(false)}
          onBusyChange={reportBusy}
        />
      ) : canRender && current && manageSkills ? (
        <SkillManagementPanel
          key={`${current.kind}:${current.id}`}
          userId={userId}
          generation={generation}
          project={current}
          onBack={() => setManageSkills(false)}
          onBusyChange={reportBusy}
        />
      ) : canRender ? (
        <GenerationPanel
          key={current ? `${current.kind}:${current.id}:${current.canGenerate}` : "workspace"}
          userId={userId}
          generation={generation}
          workspace={workspace}
          project={current}
          onBusyChange={reportBusy}
        />
      ) : null}
    </View>
  );
}
