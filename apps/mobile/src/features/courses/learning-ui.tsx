import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, TextInput, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";
import { useRouter } from "expo-router";
import { useCourseRead } from "./use-course-read";
import { learningApi } from "./learning-api";
import { pickHomework } from "./homework-upload";

export function LearningButton({
  children,
  onPress,
  disabled = false,
  primary = false,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        padding: 12,
        borderRadius: 8,
        justifyContent: "center",
        backgroundColor: primary ? theme.brand : theme.backgroundSelected,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText type="smallBold">{children}</ThemedText>
    </Pressable>
  );
}
export function LearningInput({
  label,
  value,
  onChange,
  disabled = false,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  numeric?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        value={value}
        onChangeText={onChange}
        multiline={!numeric}
        keyboardType={numeric ? "number-pad" : "default"}
        maxLength={numeric ? 3 : 10000}
        style={{
          minHeight: numeric ? 44 : 100,
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.border,
          color: theme.text,
          textAlignVertical: "top",
        }}
      />
    </View>
  );
}
/** Cancel all upload/mutation steps when the owning screen or account disappears. */
export function useLearningAction() {
  const operation = useRef<AbortController | null>(null);
  const [owner] = useState(getAuthGeneration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => operation.current?.abort(), []);
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current || owner !== getAuthGeneration()) return;
    const controller = new AbortController();
    const generation = getAuthGeneration();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await action(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted && generation === getAuthGeneration())
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (operation.current === controller) operation.current = null;
    }
  };
  return { busy, error, run };
}
export function HomeworkAttachment({
  enrollmentId,
  assetId,
  number,
}: {
  enrollmentId: string;
  assetId: string;
  number: number;
}) {
  const t = useTranslations();
  const action = useLearningAction();
  return (
    <View>
      <LearningButton
        disabled={action.busy}
        onPress={() =>
          void action.run(async (signal) => {
            const result = await learningApi.attachment(enrollmentId, assetId, signal);
            signal.throwIfAborted();
            await Linking.openURL(result.url);
          })
        }
      >
        {t("academyLearning.attachment").replace("{number}", String(number))}
      </LearningButton>
      {action.error ? <ThemedText accessibilityRole="alert">{action.error}</ThemedText> : null}
    </View>
  );
}
export function CourseLearning({
  courseId,
  onEnrolled,
}: {
  courseId: string;
  onEnrolled: () => void;
}) {
  const auth = useAuth();
  const gate = useAuthGate();
  const t = useTranslations();
  if (auth.status !== "authenticated")
    return <LearningButton onPress={() => gate.openLogin()}>{t("courses.signIn")}</LearningButton>;
  return (
    <EnrollmentForm
      key={`${auth.generation}:${auth.user?.id ?? auth.user?.userId}:${courseId}`}
      courseId={courseId}
      onEnrolled={onEnrolled}
    />
  );
}
function EnrollmentForm({ courseId, onEnrolled }: { courseId: string; onEnrolled: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const action = useLearningAction();
  const read = useCourseRead(
    useCallback((signal) => learningApi.course(courseId, signal), [courseId]),
    15000
  );
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const row = read.data?.enrollment;
  const offer = read.data?.offering;
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("academyLearning.learning")}</ThemedText>
      <LearningButton onPress={() => router.push("/academy-teaching")}>
        {t("academyLearning.teacherWorkspace")}
      </LearningButton>
      {action.error || read.error ? (
        <ThemedText accessibilityRole="alert">{action.error || read.error}</ThemedText>
      ) : null}
      {read.error ? (
        <LearningButton onPress={read.retry}>{t("academyLearning.retry")}</LearningButton>
      ) : !read.data ? (
        <ActivityIndicator />
      ) : read.data.instructor ? (
        <ThemedText>{t("academyLearning.instructorAccess")}</ThemedText>
      ) : row ? (
        <>
          <ThemedText>{t(`academyLearning.${row.status}` as MessageKey)}</ThemedText>
          {row.feedback ? (
            <ThemedText>
              {row.score}/100 · {row.feedback}
            </ThemedText>
          ) : null}
          {row.status === "approved" ? (
            <ThemedText>
              {t(
                row.badgeIssuedAt ? "academyLearning.badgeIssued" : "academyLearning.badgePending"
              )}
            </ThemedText>
          ) : null}
          {row.assetIds.map((assetId, index) => (
            <HomeworkAttachment
              key={assetId}
              enrollmentId={row.id}
              assetId={assetId}
              number={index + 1}
            />
          ))}
          {["enrolled", "revision"].includes(row.status) ? (
            <>
              <LearningInput
                label={t("academyLearning.description")}
                value={description}
                onChange={setDescription}
                disabled={action.busy}
              />
              <ThemedText type="small">{t("academyLearning.attachments")}</ThemedText>
              {files.map((file) => (
                <View key={file.id}>
                  <ThemedText>{file.name}</ThemedText>
                  <LearningButton
                    disabled={action.busy}
                    onPress={() =>
                      setFiles((current) => current.filter((value) => value.id !== file.id))
                    }
                  >
                    {t("academyLearning.remove")}
                  </LearningButton>
                </View>
              ))}
              <LearningButton
                disabled={action.busy || files.length >= 10}
                onPress={() =>
                  void action.run(async (signal) => {
                    const file = await pickHomework(signal);
                    signal.throwIfAborted();
                    if (file) setFiles((current) => [...current, file]);
                  })
                }
              >
                {t("academyLearning.add")}
              </LearningButton>
              <LearningButton
                primary
                disabled={action.busy || !description.trim() || !files.length}
                onPress={() =>
                  void action.run(async (signal) => {
                    await learningApi.submit(
                      row.id,
                      {
                        expectedVersion: row.version,
                        description,
                        assetIds: files.map((file) => file.id),
                      },
                      signal
                    );
                    signal.throwIfAborted();
                    setFiles([]);
                    setDescription("");
                    read.retry();
                  })
                }
              >
                {t(action.busy ? "academyLearning.working" : "academyLearning.submit")}
              </LearningButton>
            </>
          ) : null}
        </>
      ) : offer?.enabled ? (
        <>
          <ThemedText>
            {t("academyLearning.price").replace("{amount}", offer.priceCredits)}
          </ThemedText>
          <LearningButton
            primary
            disabled={action.busy}
            onPress={() =>
              void action.run(async (signal) => {
                await learningApi.enroll(courseId, offer.version, signal);
                signal.throwIfAborted();
                read.retry();
                onEnrolled();
              })
            }
          >
            {t(action.busy ? "academyLearning.working" : "academyLearning.enroll")}
          </LearningButton>
        </>
      ) : offer ? (
        <ThemedText>{t("academyLearning.unavailable")}</ThemedText>
      ) : null}
    </View>
  );
}
