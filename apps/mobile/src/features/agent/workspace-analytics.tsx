import { useIsFocused } from "expo-router";
import { generationUsage } from "./workspace-analytics-summary";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
import {
  loadWorkspaceAnalytics,
  analyticsTotals,
  type WorkspaceAnalytics,
} from "./api/workspace-analytics-api";
type Props = { workspaceId: string; generation: number; onClose: () => void };
export function WorkspaceAnalyticsScreen(props: Props) {
  const focused = useIsFocused();
  if (!focused || props.generation !== getAuthGeneration()) return null;
  return <Analytics key={`${props.workspaceId}:${props.generation}`} {...props} />;
}
type Section = "daily" | "jobs" | "ledger" | "members";
function Analytics(props: Props) {
  const active = useScreenActive();
  const [projectId, setProjectId] = useState(""),
    [range, setRange] = useState<7 | 30 | 90>(30),
    [revision, setRevision] = useState(0);
  const [section, setSection] = useState<Section>("daily");
  const key = JSON.stringify([projectId, range, revision]);
  if (!active) return null;
  return (
    <Report
      key={key}
      {...props}
      projectId={projectId}
      setProjectId={setProjectId}
      range={range}
      setRange={setRange}
      section={section}
      setSection={setSection}
      refresh={() => setRevision((v) => v + 1)}
    />
  );
}
function Report({
  workspaceId,
  generation,
  onClose,
  projectId,
  setProjectId,
  range,
  setRange,
  section,
  setSection,
  refresh,
}: Props & {
  projectId: string;
  setProjectId: (value: string) => void;
  range: 7 | 30 | 90;
  setRange: (value: 7 | 30 | 90) => void;
  section: Section;
  setSection: (value: Section) => void;
  refresh: () => void;
}) {
  const theme = useTheme(),
    t = useTranslations(),
    locale = useLocale();
  const label = (key: string) => t(`workspaceAnalytics.${key}` as MessageKey);
  const key = JSON.stringify([projectId, range]);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    data?: WorkspaceAnalytics;
    error?: string;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    void loadWorkspaceAnalytics(workspaceId, generation, projectId, range, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ key, data });
      },
      (error) => {
        if (!controller.signal.aborted && generation === getAuthGeneration())
          setSnapshot({ key, error: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => controller.abort();
  }, [workspaceId, generation, projectId, range, key]);
  const current = snapshot?.key === key ? snapshot : undefined,
    data = current?.data;
  const visibleSection = section === "members" && !data?.memberUsage ? "daily" : section;
  const points = (value: string) => new Intl.NumberFormat(locale).format(BigInt(value));
  const totals = data ? analyticsTotals(data.ledger) : undefined;
  const usage = data ? generationUsage(data) : undefined;
  const box = { padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement, gap: 8 };
  const daily = data
    ? Array.from({ length: 30 }, (_, index) => {
        const day = new Date();
        day.setUTCDate(day.getUTCDate() - (29 - index));
        const date = day.toISOString().slice(0, 10);
        return { date, credits: data.daily.find((row) => row.date === date)?.credits ?? "0" };
      })
    : [];
  const max = daily.reduce(
    (value, row) => (BigInt(row.credits) > value ? BigInt(row.credits) : value),
    0n
  );
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
    >
      <ThemedText type="subtitle">{label("title")}</ThemedText>
      <Pressable accessibilityRole="button" onPress={onClose}>
        <ThemedText>{t("common.back")}</ThemedText>
      </Pressable>
      <ThemedText type="small">{label("historyLimit")}</ThemedText>
      <Pressable accessibilityRole="button" onPress={refresh}>
        <ThemedText>{label("refresh")}</ThemedText>
      </Pressable>
      {!current && <ActivityIndicator />}
      {current?.error && <ThemedText accessibilityRole="alert">{current.error}</ThemedText>}
      {current?.error && projectId !== "" && (
        <Pressable accessibilityRole="button" onPress={() => setProjectId("")}>
          <ThemedText>{label("allProjects")}</ThemedText>
        </Pressable>
      )}
      {data && (
        <>
          <ThemedText type="smallBold">{data.workspace.name}</ThemedText>
          <View style={box}>
            <ThemedText>
              {label("incoming")}: {points(totals!.incoming)}
            </ThemedText>
            <ThemedText>
              {label("outgoing")}: {points(totals!.outgoing)}
            </ThemedText>
            <ThemedText>
              {label("jobs")}: {data.jobs.length}
            </ThemedText>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {(
              [
                "daily",
                "jobs",
                "ledger",
                ...(data.memberUsage ? ["members" as const] : []),
              ] as const
            ).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: visibleSection === value }}
                style={box}
                onPress={() => setSection(value)}
              >
                <ThemedText type="small">{label(value)}</ThemedText>
              </Pressable>
            ))}
          </View>
          {(visibleSection === "daily" || visibleSection === "members") && (
            <>
              <ThemedText type="smallBold">{label("project")}</ThemedText>
              <ScrollView horizontal>
                {[{ id: "", name: label("allProjects") }, ...data.projects].map((project) => (
                  <Pressable
                    key={project.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: projectId === project.id }}
                    style={box}
                    onPress={() => setProjectId(project.id)}
                  >
                    <ThemedText type="small">{project.name}</ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
          {visibleSection === "daily" && (
            <>
              <ThemedText type="small">{label("dailyWindow")}</ThemedText>
              {daily.map((row) => (
                <View key={row.date} style={{ gap: 4 }}>
                  <ThemedText type="small">
                    {row.date} · {points(row.credits)}
                  </ThemedText>
                  <View style={{ height: 4, backgroundColor: theme.backgroundElement }}>
                    <View
                      style={{
                        height: 4,
                        backgroundColor: theme.text,
                        width: `${max > 0n ? Number((BigInt(row.credits) * 1000n) / max) / 10 : 0}%`,
                      }}
                    />
                  </View>
                </View>
              ))}
            </>
          )}
          {visibleSection === "jobs" && usage && (
            <View style={box}>
              <ThemedText type="smallBold">{label("models")}</ThemedText>
              {usage.models.map((model) => (
                <ThemedText key={model.modelId} type="small">
                  {model.modelId} · {model.count} {label("jobs")} ·{" "}
                  {points(model.credits.toString())} {label("settled")}
                </ThemedText>
              ))}
            </View>
          )}
          {visibleSection === "jobs" &&
            (data.jobs.length ? (
              data.jobs.map((job) => (
                <View key={job.id} style={box}>
                  <ThemedText type="smallBold">{job.modelId}</ThemedText>
                  <ThemedText type="small">
                    {job.type} · {job.status}
                  </ThemedText>
                  <ThemedText type="small">
                    {new Date(job.createdAt).toLocaleString(locale)}
                  </ThemedText>
                  <ThemedText type="small">
                    {label("settled")}:{" "}
                    {usage?.settled.has(job.id)
                      ? points(usage.settled.get(job.id)!.toString())
                      : "—"}
                  </ThemedText>
                  <ThemedText type="small">{job.id}</ThemedText>
                </View>
              ))
            ) : (
              <ThemedText>{label("empty")}</ThemedText>
            ))}
          {visibleSection === "ledger" &&
            (data.ledger.length ? (
              data.ledger.map((entry) => (
                <View key={entry.id} style={box}>
                  <ThemedText type="smallBold">
                    {entry.entryType} · {points(entry.amount)}
                  </ThemedText>
                  <ThemedText type="small">{entry.description ?? entry.reason}</ThemedText>
                  <ThemedText type="small">
                    {new Date(entry.createdAt).toLocaleString(locale)}
                  </ThemedText>
                  <ThemedText type="small">
                    {entry.sourceType} · {entry.sourceId ?? "—"}
                  </ThemedText>
                </View>
              ))
            ) : (
              <ThemedText>{label("empty")}</ThemedText>
            ))}
          {visibleSection === "members" && data.memberUsage && (
            <>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([7, 30, 90] as const).map((days) => (
                  <Pressable
                    key={days}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: range === days }}
                    style={box}
                    onPress={() => setRange(days)}
                  >
                    <ThemedText>
                      {days} {label("days")}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              {!data.memberUsage.length && <ThemedText>{label("empty")}</ThemedText>}
              {data.memberUsage.map((member) => (
                <View key={member.userId} style={box}>
                  <ThemedText type="smallBold">
                    {member.nickname?.trim() ||
                      (member.userId === "unknown" ? label("unknownMember") : member.userId)}
                  </ThemedText>
                  <ThemedText type="small">
                    {points(member.totalCredits)} · {member.totalJobs} {label("jobs")}
                  </ThemedText>
                  {member.projects.map((project, index) => (
                    <ThemedText key={`${project.projectId}:${index}`} type="small">
                      {project.projectName ?? project.projectId ?? label("unassigned")} ·{" "}
                      {points(project.credits)} · {project.jobs}
                    </ThemedText>
                  ))}
                </View>
              ))}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}
