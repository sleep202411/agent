import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import {
  analyzePdf,
  fetchPdfPreview,
  applyPdfTasks,
  loadPdfRecovery,
  savePdfRecovery,
  pickPdfFile,
  type PdfFile,
  type PdfPreview,
  type PdfRecovery,
} from "./pdf-task-api";

type Props = {
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  onCreated: (id: string) => void;
};
export function PdfTaskImport(props: Props) {
  const t = useTranslations();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const op = useAuthFormOperation(props.crewId, true);
  const [file, setFile] = useState<PdfFile | null>(null);
  const [recovery, setRecovery] = useState<PdfRecovery | null>(null);
  const [preview, setPreview] = useState<PdfPreview | null>(null);
  const [selection, setSelection] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const abort = useRef(new AbortController());
  const polling = useRef(false);
  const current = () => !abort.current.signal.aborted && props.generation === getAuthGeneration();
  useEffect(() => {
    let active = true;
    abort.current = new AbortController();
    void loadPdfRecovery(props.crewId, props.userId)
      .then((value) => {
        if (!active || props.generation !== getAuthGeneration()) return;
        setRecovery(value);
        if (value?.indices) setSelection(value.indices);
        setLoaded(true);
      })
      .catch((e) => {
        if (active && props.generation === getAuthGeneration()) {
          setError(String(e));
          setLoaded(true);
        }
      });
    return () => {
      active = false;
      abort.current.abort();
    };
  }, [props.crewId, props.userId, props.generation, abort]);
  useEffect(() => {
    if (
      !recovery ||
      op.busy ||
      preview?.status === "applied" ||
      preview?.status === "failed" ||
      preview?.status === "ready"
    )
      return;
    const controller = new AbortController();
    const poll = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const result = await fetchPdfPreview(
          props.crewId,
          recovery.id,
          props.generation,
          controller.signal
        );
        if (!controller.signal.aborted) {
          setPreview(result);
          setError(undefined);
          if (!recovery.indices && result.status === "ready")
            setSelection(result.tasks.map((_, i) => i));
        }
      } catch (e) {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        polling.current = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [recovery, preview?.status, op.busy, props.crewId, props.generation, revision]);
  function run<T>(work: () => Promise<T>, success: (value: T) => void) {
    if (!current()) return;
    setError(undefined);
    void op.run(work, success, (e) => setError(e instanceof Error ? e.message : String(e)));
  }
  const frozen = !!recovery?.indices;
  const expired = preview && Date.parse(preview.createdAt) + 86400_000 <= now;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("mobileProduction.pdfTitle")}</ThemedText>
      <ThemedText>{t("mobileProduction.pdfHelp")}</ThemedText>
      {!loaded && <ActivityIndicator />}
      {loaded && !recovery && (
        <>
          <Action
            disabled={op.busy}
            label={t("mobileProduction.pdfChoose")}
            onPress={() =>
              run(
                () => pickPdfFile(props.generation),
                (value) => {
                  if (value) setFile(value);
                }
              )
            }
          />
          {file && <ThemedText>{file.name}</ThemedText>}
          <Action
            disabled={op.busy || !file}
            label={t("mobileProduction.pdfAnalyze")}
            onPress={() =>
              run(
                async () => {
                  const value = { id: uuid.v4() };
                  await savePdfRecovery(props.crewId, props.userId, value);
                  if (!current()) throw new Error("Document import session expired");
                  setRecovery(value);
                  return analyzePdf(
                    props.crewId,
                    value.id,
                    file!,
                    props.generation,
                    abort.current.signal
                  );
                },
                (value) => {
                  setPreview(value);
                  if (value.status === "ready") setSelection(value.tasks.map((_, i) => i));
                }
              )
            }
          />
        </>
      )}
      {recovery && !preview && (
        <>
          <Action
            disabled={op.busy}
            label={t("mobileProduction.pdfChoose")}
            onPress={() =>
              run(
                () => pickPdfFile(props.generation),
                (value) => {
                  if (value) setFile(value);
                }
              )
            }
          />
          {file && (
            <Action
              disabled={op.busy}
              label={t("mobileProduction.retryUpload")}
              onPress={() =>
                run(
                  () =>
                    analyzePdf(
                      props.crewId,
                      recovery.id,
                      file,
                      props.generation,
                      abort.current.signal
                    ),
                  (value) => {
                    setPreview(value);
                    if (value.status === "ready" && !frozen)
                      setSelection(value.tasks.map((_, i) => i));
                  }
                )
              }
            />
          )}
        </>
      )}
      {recovery && (!preview || ["queued", "analyzing"].includes(preview.status)) && (
        <>
          <ThemedText>{t("mobileProduction.pdfPending")}</ThemedText>
          <Action
            disabled={op.busy}
            label={t("mobileProduction.pdfCheck")}
            onPress={() => setRevision((v) => v + 1)}
          />
        </>
      )}
      {preview?.status === "failed" && (
        <View>
          <ThemedText accessibilityRole="alert">
            {preview.failure?.message || t("mobileProduction.pdfFailed")}
          </ThemedText>
          <ThemedText type="small">
            {t("mobileProduction.pdfAnalysisId").replace("{id}", preview.id)}
          </ThemedText>
        </View>
      )}
      {preview?.status === "ready" && (
        <>
          <ThemedText>
            {t("mobileProduction.pdfReview").replace("{count}", String(preview.tasks.length))}
          </ThemedText>
          {preview.tasks.map((task, index) => (
            <View key={index} style={{ gap: 8, padding: 12 }}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: selection.includes(index),
                  disabled: frozen || op.busy,
                }}
                disabled={frozen || op.busy}
                onPress={() =>
                  setSelection((value) =>
                    value.includes(index) ? value.filter((i) => i !== index) : [...value, index]
                  )
                }
              >
                <ThemedText>
                  {selection.includes(index) ? "✓ " : ""}
                  {task.title}
                </ThemedText>
              </Pressable>
              <ThemedText>{task.description}</ThemedText>
              <ThemedText>{task.evidence}</ThemedText>
            </View>
          ))}
          {frozen && <ThemedText>{t("mobileProduction.pdfRetryHelp")}</ThemedText>}
          {expired && <ThemedText>{t("mobileProduction.expired")}</ThemedText>}
          <Action
            disabled={op.busy || !selection.length || (!!expired && !frozen)}
            label={
              frozen
                ? t("mobileProduction.pdfRetry")
                : t("mobileProduction.pdfCreate").replace("{count}", String(selection.length))
            }
            onPress={() =>
              run(
                async () => {
                  const value = {
                    id: preview.id,
                    indices: recovery?.indices ?? [...selection].sort((a, b) => a - b),
                  };
                  await savePdfRecovery(props.crewId, props.userId, value);
                  if (!current()) throw new Error("Document import session expired");
                  setRecovery(value);
                  return applyPdfTasks(
                    props.crewId,
                    preview.id,
                    value.indices,
                    props.generation,
                    abort.current.signal
                  );
                },
                (result) => setPreview({ ...preview, status: "applied", taskIds: result.taskIds })
              )
            }
          />
        </>
      )}
      {preview?.status === "applied" && (
        <>
          <ThemedText>
            {t("mobileProduction.pdfCreated").replace("{count}", String(preview.taskIds.length))}
          </ThemedText>
          {preview.taskIds.map((id, index) => (
            <Action
              key={id}
              label={`${t("taskWorkbench.open")} ${index + 1}`}
              onPress={() => props.onCreated(id)}
            />
          ))}
        </>
      )}
      {recovery &&
        (preview?.status === "applied" || preview?.status === "failed" || (expired && !frozen)) && (
          <Action
            disabled={op.busy}
            label={t("mobileProduction.pdfNewAnalysis")}
            onPress={() =>
              run(
                () => savePdfRecovery(props.crewId, props.userId, null),
                () => {
                  setRecovery(null);
                  setPreview(null);
                  setFile(null);
                  setSelection([]);
                }
              )
            }
          />
        )}
      {op.busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Action disabled={op.busy} label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Action({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
