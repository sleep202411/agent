import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, View } from "react-native";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import {
  fetchCaseEvidence,
  pickCaseEvidence,
  uploadCaseEvidence,
  confirmCaseEvidence,
  readCaseEvidence,
  type CaseAttachment,
  type CaseUpload,
} from "./case-evidence-api";
export function CaseEvidence({
  caseId,
  generation,
  disabled,
  selected,
  onSelect,
  onBusy,
}: {
  caseId: string;
  generation: number;
  disabled: boolean;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onBusy: (busy: boolean) => void;
}) {
  const t = useTranslations(),
    op = useAuthFormOperation(caseId, true);
  const [rows, setRows] = useState<CaseAttachment[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [upload, setUpload] = useState<CaseUpload | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    return () => c.abort();
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void fetchCaseEvidence(caseId, generation, cursor, c.signal)
      .then((page) => {
        if (c.signal.aborted) return;
        setRows((old) =>
          cursor ? [...new Map([...old, ...page.items].map((r) => [r.id, r])).values()] : page.items
        );
        setNext(page.nextBeforeId);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setRows([]);
          setNext(null);
          setError(String(e.message ?? e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [caseId, generation, cursor, revision]);
  const refresh = useCallback(() => {
    setRows([]);
    setError("");
    setLoading(true);
    setCursor(null);
    setRevision((v) => v + 1);
  }, []);
  const run = useCallback(
    (fn: (signal: AbortSignal) => Promise<unknown>, saved: () => void = refresh) => {
      const c = controller.current;
      if (!c || c.signal.aborted || disabled) return;
      void op.run(
        async () => {
          onBusy(true);
          setError("");
          try {
            return await fn(c.signal);
          } finally {
            if (!c.signal.aborted) onBusy(false);
          }
        },
        saved,
        (e) => {
          setRows([]);
          setError(String(e instanceof Error ? e.message : e));
        }
      );
    },
    [disabled, op, onBusy, refresh]
  );
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("privateCases.evidence")}</ThemedText>
      <ThemedText>{t("caseEvidence.privacy")}</ThemedText>
      <ThemedText>{t("caseEvidence.limits")}</ThemedText>
      {loading && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {
        <EvidenceAction
          label={t("thread.refresh")}
          onPress={refresh}
          disabled={disabled || op.busy || loading}
        />
      }
      {
        <EvidenceAction
          label={t("thread.uploadFile")}
          onPress={() =>
            run(async (signal) => {
              const value = await pickCaseEvidence(generation, signal);
              if (!value) return;
              setUpload(value);
              await uploadCaseEvidence(caseId, value, generation, signal);
              setUpload(null);
            })
          }
          disabled={disabled || op.busy || loading || !!error || !!upload}
        />
      }
      {upload && (
        <>
          <ThemedText>{upload.metadata.name}</ThemedText>
          {
            <EvidenceAction
              label={t("caseEvidence.retry")}
              onPress={() =>
                run(async (signal) => {
                  await uploadCaseEvidence(caseId, upload, generation, signal);
                  setUpload(null);
                })
              }
              disabled={disabled || op.busy || false}
            />
          }
          {
            <EvidenceAction
              label={t("caseEvidence.confirm")}
              onPress={() =>
                run(async (signal) => {
                  await confirmCaseEvidence(caseId, upload.id, generation, signal);
                  setUpload(null);
                })
              }
              disabled={disabled || op.busy || false}
            />
          }
          {
            <EvidenceAction
              label={t("caseEvidence.release")}
              onPress={() => {
                setUpload(null);
                refresh();
              }}
              disabled={disabled || op.busy || false}
            />
          }
          <ThemedText>{t("caseEvidence.recovery")}</ThemedText>
        </>
      )}
      {rows.map((row) => (
        <View key={row.id} style={{ gap: 4 }}>
          <ThemedText>
            {row.name} · {row.sizeBytes}
          </ThemedText>
          <ThemedText>
            {t(
              row.shared
                ? "caseEvidence.shared"
                : row.ready
                  ? "caseEvidence.private"
                  : "caseEvidence.unconfirmed"
            )}
          </ThemedText>
          {row.ready ? (
            <EvidenceAction
              label={t("caseEvidence.open")}
              onPress={() =>
                run(
                  async (signal) => {
                    const link = await readCaseEvidence(caseId, row.id, generation, signal);
                    if (!signal.aborted) await Linking.openURL(link.url);
                  },
                  () => {}
                )
              }
              disabled={disabled || op.busy || false}
            />
          ) : (
            <EvidenceAction
              label={t("caseEvidence.confirm")}
              onPress={() =>
                run((signal) => confirmCaseEvidence(caseId, row.id, generation, signal))
              }
              disabled={disabled || op.busy || false}
            />
          )}
          {row.ready && !row.shared && (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected.includes(row.id) }}
              disabled={
                disabled || op.busy || (!selected.includes(row.id) && selected.length >= 20)
              }
              onPress={() =>
                onSelect(
                  selected.includes(row.id)
                    ? selected.filter((id) => id !== row.id)
                    : [...selected, row.id]
                )
              }
              style={{ padding: 12 }}
            >
              <ThemedText>
                {selected.includes(row.id) ? "☑ " : "☐ "}
                {t("caseEvidence.select")}
              </ThemedText>
            </Pressable>
          )}
        </View>
      ))}
      {next && (
        <EvidenceAction
          label={t("crewTaskCenter.loadMore")}
          onPress={() => {
            setLoading(true);
            setError("");
            setCursor(next);
          }}
          disabled={disabled || op.busy || loading}
        />
      )}
    </View>
  );
}

function EvidenceAction({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
