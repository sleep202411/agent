import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, useAuthGate } from "@/auth";
import { useTranslations, type MessageKey } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth } from "@/constants/theme";
import { formatFinanceMoney } from "@/features/services/crew-finance-api";
import { instructorEarnedCredits } from "./instructor-income";
import { learningApi, type Enrollment } from "./learning-api";
import { useCourseRead } from "./use-course-read";
import {
  HomeworkAttachment,
  LearningButton,
  LearningInput,
  useLearningAction,
} from "./learning-ui";

export function TeachingIncome() {
  const t = useTranslations();
  const router = useRouter();
  const read = useCourseRead(
    useCallback((signal) => learningApi.summary(signal), []),
    15000
  );
  return (
    <View style={{ gap: 8 }}>
      <LearningButton onPress={() => router.push("/academy-teaching")}>
        {t("academyLearning.income")}
      </LearningButton>
      {read.error ? (
        <>
          <ThemedText accessibilityRole="alert">{read.error}</ThemedText>
          <LearningButton onPress={read.retry}>{t("academyLearning.retry")}</LearningButton>
        </>
      ) : read.data ? (
        <ThemedText>{formatFinanceMoney(read.data.earnedCredits, "USD")}</ThemedText>
      ) : (
        <ActivityIndicator />
      )}
      <ThemedText type="small" themeColor="textSecondary">
        {t("academyLearning.creditIncomeNote")}
      </ThemedText>
    </View>
  );
}
export function TeachingScreen() {
  const auth = useAuth();
  const gate = useAuthGate();
  const t = useTranslations();
  if (auth.status !== "authenticated")
    return (
      <LearningButton onPress={() => gate.openLogin()}>
        {t("academyLearning.signIn")}
      </LearningButton>
    );
  return <Workspace key={`${auth.generation}:${auth.user?.id ?? auth.user?.userId}`} />;
}
function Workspace() {
  const auth = useAuth();
  const t = useTranslations();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState<Enrollment | null>(null);
  const read = useCourseRead(
    useCallback(
      async (signal: AbortSignal) => {
        const summary = await learningApi.summary(signal);
        let cursor: string | null = null;
        const rows = new Map<string, Enrollment>();
        const seen = new Set<string>();
        for (let index = 0; index < pages; index++) {
          const result = await learningApi.teaching(cursor, signal);
          result.items.forEach((row) => rows.set(row.id, row));
          cursor = result.nextCursor;
          if (!cursor) break;
          if (seen.has(cursor)) throw new Error("Invalid Academy pagination response.");
          seen.add(cursor);
        }
        return { summary, items: [...rows.values()], nextCursor: cursor };
      },
      [pages]
    ),
    15000
  );
  return (
    <ThemedView style={{ flex: 1 }}>
      <ScrollView
        key={selected?.id ?? "list"}
        contentContainerStyle={{
          width: "100%",
          maxWidth: MaxContentWidth,
          alignSelf: "center",
          padding: 16,
          paddingBottom: insets.bottom + 24,
          gap: 16,
        }}
      >
        <ThemedText type="smallBold">{t("academyLearning.teacherWorkspace")}</ThemedText>
        <LearningButton onPress={() => router.push("/crew-income")}>
          {t("academyLearning.myIncome")}
        </LearningButton>
        {!selected &&
          (read.error ? (
            <>
              <ThemedText accessibilityRole="alert">{read.error}</ThemedText>
              <LearningButton onPress={read.retry}>{t("academyLearning.retry")}</LearningButton>
            </>
          ) : !read.data ? (
            <ActivityIndicator />
          ) : (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {(["courses", "students", "pending", "earnedCredits"] as const).map((metric) => (
                  <View key={metric} style={{ minWidth: "45%", gap: 4 }}>
                    <ThemedText type="small">
                      {t(`academyLearning.${metric}` as MessageKey)}
                    </ThemedText>
                    <ThemedText type="smallBold">{String(read.data!.summary[metric])}</ThemedText>
                  </View>
                ))}
              </View>
              <ThemedText type="small">{t("academyLearning.creditIncomeNote")}</ThemedText>
              {!read.data.items.length ? (
                <ThemedText>{t("academyLearning.empty")}</ThemedText>
              ) : null}
              {read.data.items.map((row) => (
                <View key={row.id} style={{ gap: 8, paddingVertical: 12 }}>
                  <ThemedText type="smallBold">
                    {row.courseTitle || `${t("academyLearning.course")} ${row.courseId}`}
                  </ThemedText>
                  <ThemedText>
                    {row.studentName || row.studentId} ·{" "}
                    {t(`academyLearning.${row.status}` as MessageKey)}
                  </ThemedText>
                  <ThemedText type="small">
                    {t("academyLearning.yourShare").replace(
                      "{amount}",
                      instructorEarnedCredits(row, String(auth.user?.id ?? auth.user?.userId ?? ""))
                    )}
                  </ThemedText>
                  <LearningButton onPress={() => setSelected(row)}>
                    {t("academyLearning.review")}
                  </LearningButton>
                </View>
              ))}
              {read.data.nextCursor ? (
                <LearningButton onPress={() => setPages((value) => value + 1)}>
                  {t("academyLearning.more")}
                </LearningButton>
              ) : null}
            </>
          ))}
        {selected ? (
          <Review
            key={`${selected.id}:${selected.version}`}
            row={selected}
            close={() => setSelected(null)}
            saved={() => {
              setSelected(null);
              read.retry();
            }}
          />
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}
function Review({ row, close, saved }: { row: Enrollment; close: () => void; saved: () => void }) {
  const t = useTranslations();
  const action = useLearningAction();
  const [score, setScore] = useState(row.score === null ? "" : String(row.score));
  const [feedback, setFeedback] = useState(row.feedback ?? "");
  const valid = /^\d{1,3}$/.test(score) && Number(score) <= 100 && feedback.trim().length > 0;
  const decide = (decision: "approved" | "revision") =>
    void action.run(async (signal) => {
      if (!valid) throw new Error(t("academyLearning.invalidReview"));
      await learningApi.review(
        row.id,
        { expectedVersion: row.version, decision, score: Number(score), feedback },
        signal
      );
      signal.throwIfAborted();
      saved();
    });
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">
        {t("academyLearning.review")} · {row.studentName || row.studentId}
      </ThemedText>
      <LearningButton disabled={action.busy} onPress={close}>
        {t("academyLearning.close")}
      </LearningButton>
      <ThemedText>{row.description}</ThemedText>
      {row.assetIds.map((assetId, index) => (
        <HomeworkAttachment
          key={assetId}
          enrollmentId={row.id}
          assetId={assetId}
          number={index + 1}
        />
      ))}
      {row.status === "submitted" ? (
        <>
          <LearningInput
            label={t("academyLearning.score")}
            value={score}
            onChange={setScore}
            disabled={action.busy}
            numeric
          />
          <LearningInput
            label={t("academyLearning.feedback")}
            value={feedback}
            onChange={setFeedback}
            disabled={action.busy}
          />
          <LearningButton
            primary
            disabled={action.busy || !valid}
            onPress={() => decide("approved")}
          >
            {t("academyLearning.approve")}
          </LearningButton>
          <LearningButton disabled={action.busy || !valid} onPress={() => decide("revision")}>
            {t("academyLearning.return")}
          </LearningButton>
        </>
      ) : row.feedback ? (
        <ThemedText>
          {row.score}/100 · {row.feedback}
        </ThemedText>
      ) : null}
      {action.error ? <ThemedText accessibilityRole="alert">{action.error}</ThemedText> : null}
    </View>
  );
}
