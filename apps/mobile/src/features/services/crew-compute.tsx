import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { COMPUTE_POINTS_PER_USD_CENT } from "@repo/shared";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  fetchCompute,
  createCompute,
  computeInput,
  type ComputePage,
  type ComputeInput,
} from "./crew-compute-api";
import { formatFinanceMoney } from "./crew-finance-api";
type Props = {
  initialTaskId?: string;
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
};
export function CrewCompute(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  return (
    <View style={{ flex: 1 }}>
      <Panel key={revision} {...props} onSaved={() => setRevision((n) => n + 1)} />
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => setRevision((n) => n + 1)}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={props.onClose}>
        <ThemedText>{t("crewFinance.backToRecord")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Panel(props: Props & { onSaved: () => void }) {
  const t = useTranslations();
  const [page, setPage] = useState<ComputePage>(),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(true);
  const seen = useRef(new Set<string>()),
    pending = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    pending.current = true;
    void fetchCompute(props.crewId, props.userId, cursor, c.signal)
      .then((next) => {
        if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
        if (next.nextCursor && seen.current.has(next.nextCursor))
          throw new Error("Repeated compute request cursor. Refresh to reload.");
        if (cursor) seen.current.add(cursor);
        setPage(next);
      })
      .catch((e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          setPage(undefined);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          pending.current = false;
          setBusy(false);
        }
      });
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, cursor]);
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t("crewComputeFinance.title")}</ThemedText>
      {busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {page && (
        <>
          <ThemedText>
            {t(page.isOwner ? "crewComputeFinance.crewScope" : "crewComputeFinance.myScope")}
          </ThemedText>
          {page.projectBudget && (
            <View>
              <ThemedText>
                {t("crewComputeFinance.projectBudgetSummary")
                  .replace("{total}", page.projectBudget.totalPoints)
                  .replace("{released}", page.projectBudget.releasedPoints)}
              </ThemedText>
              {page.projectBudget.closed && (
                <ThemedText>{t("crewComputeFinance.projectBudgetClosed")}</ThemedText>
              )}
              {page.projectBudget.producerSettlement && (
                <ThemedText>
                  {t("crewComputeFinance.producerDeduction")
                    .replace("{amount}", page.projectBudget.producerSettlement.deductionMinor)
                    .replace("{currency}", page.projectBudget.producerSettlement.currency)}{" "}
                  · {page.projectBudget.producerSettlement.note}
                </ThemedText>
              )}
            </View>
          )}
          {(["pending", "approved", "rejected"] as const).map((status) => (
            <ThemedText key={status}>
              {t(`crewComputeFinance.${status}`)} · {page.totals[status] ?? 0}{" "}
              {t("crewComputeFinance.points")}
            </ThemedText>
          ))}
          <ThemedText>
            {t("crewComputeFinance.consumed")} · {page.consumedPoints}{" "}
            {t("crewComputeFinance.points")} (
            {formatFinanceMoney(
              (BigInt(page.consumedPoints) / BigInt(COMPUTE_POINTS_PER_USD_CENT)).toString(),
              "USD"
            )}
            )
          </ThemedText>
          <ThemedText>{t("crewComputeFinance.equivalent")}</ThemedText>
          {page.taskUsage
            ?.filter((row) => !props.initialTaskId || row.taskId === props.initialTaskId)
            .map((row) => (
              <View key={`${row.taskId}:${row.userId}`}>
                <ThemedText>
                  {row.taskTitle} · {row.userId}
                </ThemedText>
                <ThemedText>
                  {t("crewComputeFinance.approvedTotal")}: {row.approvedPoints} ·{" "}
                  {t("crewComputeFinance.pending")}: {row.pendingPoints}
                </ThemedText>
                <ThemedText>
                  {t("crewComputeFinance.consumed")}: {row.consumedPoints} ·{" "}
                  {t("crewComputeFinance.committed")}: {row.committedPoints}
                </ThemedText>
              </View>
            ))}
          <RequestForm {...props} tasks={page.tasks} />
          {!page.items.length && <ThemedText>{t("crewComputeFinance.empty")}</ThemedText>}
          {page.items.map((row) => (
            <View key={row.id} style={{ paddingVertical: 12, gap: 6 }}>
              <ThemedText>
                {row.taskTitle} · {t(`crewComputeFinance.${row.status}`)}
              </ThemedText>
              <ThemedText>
                {t("crewComputeFinance.applicant")} · {row.userId}
              </ThemedText>
              <ThemedText>
                {row.points} {t("crewComputeFinance.points")}
              </ThemedText>
              <ThemedText>{row.reason}</ThemedText>
              <ThemedText>{new Date(row.createdAt).toLocaleString()}</ThemedText>
              {row.decidedByAdminId ? (
                <ThemedText>{t("crewComputeFinance.adminReviewer")}</ThemedText>
              ) : row.decidedByUserId ? (
                <ThemedText>{row.decidedByUserId}</ThemedText>
              ) : null}
              {row.decisionNote && <ThemedText>{row.decisionNote}</ThemedText>}
            </View>
          ))}
          {page.nextCursor && (
            <Pressable
              accessibilityRole="button"
              style={{ padding: 12 }}
              disabled={busy}
              onPress={() => {
                if (pending.current || props.generation !== getAuthGeneration()) return;
                pending.current = true;
                setPage(undefined);
                setBusy(true);
                setCursor(page.nextCursor);
              }}
            >
              <ThemedText>{t("crewComputeFinance.older")}</ThemedText>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}
function RequestForm(props: Props & { tasks: ComputePage["tasks"]; onSaved: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(props.crewId, true);
  const [taskId, setTaskId] = useState(props.initialTaskId ?? ""),
    [points, setPoints] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState<string>(),
    [attempted, setAttempted] = useState(false);
  const request = useRef<ComputeInput | null>(null);
  if (!props.tasks.length) return <ThemedText>{t("crewComputeFinance.noTasks")}</ThemedText>;
  return (
    <View style={{ gap: 12 }}>
      <ThemedText>{t("crewComputeFinance.task")}</ThemedText>
      {props.tasks.map((task) => (
        <Pressable
          key={task.id}
          accessibilityRole="radio"
          accessibilityState={{ checked: taskId === task.id }}
          disabled={attempted || op.busy}
          style={{ padding: 12 }}
          onPress={() => setTaskId(task.id)}
        >
          <ThemedText>
            {taskId === task.id ? "✓ " : ""}TASK-{task.number} · {task.title}
          </ThemedText>
        </Pressable>
      ))}
      {(["points", "reason"] as const).map((field) => (
        <View key={field}>
          <ThemedText>{t(`crewComputeFinance.${field}`)} *</ThemedText>
          <TextInput
            accessibilityLabel={t(`crewComputeFinance.${field}`)}
            value={field === "points" ? points : reason}
            onChangeText={field === "points" ? setPoints : setReason}
            keyboardType={field === "points" ? "number-pad" : "default"}
            multiline={field === "reason"}
            maxLength={field === "points" ? 10 : 2000}
            editable={!attempted && !op.busy}
            style={{
              color: theme.text,
              borderColor: theme.text,
              borderWidth: 1,
              borderRadius: 8,
              padding: 12,
            }}
          />
        </View>
      ))}
      <ThemedText>{t("mobileCompute.reviewHelp")}</ThemedText>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        disabled={op.busy}
        onPress={() => {
          if (props.generation !== getAuthGeneration()) return;
          void op.run(
            async () => {
              if (!request.current) {
                if (!/^\d+$/.test(points) || !props.tasks.some((task) => task.id === taskId))
                  throw new Error(t("mobileCompute.invalid"));
                const parsed = computeInput.safeParse({
                  taskId,
                  points: Number(points),
                  reason,
                  requestKey: uuid.v4(),
                });
                if (!parsed.success) throw new Error(t("mobileCompute.invalid"));
                request.current = parsed.data;
              }
              setAttempted(true);
              return createCompute(props.crewId, props.userId, request.current, props.generation);
            },
            props.onSaved,
            (e) => setError(e instanceof Error ? e.message : String(e))
          );
        }}
      >
        <ThemedText>
          {t(attempted ? "mobileCompute.retry" : "crewComputeFinance.request")}
        </ThemedText>
      </Pressable>
      {op.busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {attempted && <ThemedText>{t("mobileCompute.retryHelp")}</ThemedText>}
    </View>
  );
}
