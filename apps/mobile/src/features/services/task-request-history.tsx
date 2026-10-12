import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
const rowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    status: z.enum(["pending", "approved", "rejected"]),
    input: z.object({ title: z.string().optional() }),
    decisionNote: z.string().nullable().optional(),
  })
);
export function TaskRequestHistory(props: { crewId: string; generation: number }) {
  return <HistorySession key={`${props.crewId}:${props.generation}`} {...props} />;
}
function HistorySession({ crewId, generation }: { crewId: string; generation: number }) {
  const active = useScreenActive(),
    t = useTranslations();
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<z.infer<typeof rowsSchema>>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (!active || !open || generation !== getAuthGeneration()) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && generation === getAuthGeneration();
    let running = false;
    async function load() {
      if (running) return;
      running = true;
      try {
        const result = rowsSchema.parse(
          await api.get(`/crews/${encodeURIComponent(crewId)}/task-requests`, {
            service: "aurora",
            signal: controller.signal,
          })
        );
        if (current()) {
          setRows(result);
          setError("");
        }
      } catch (cause) {
        if (current()) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        running = false;
        if (current()) setLoading(false);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [crewId, generation, active, open, revision]);
  if (generation !== getAuthGeneration()) return null;
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (!open) {
            setLoading(true);
            setRows([]);
            setError("");
          }
          setOpen((v) => !v);
        }}
      >
        <ThemedText>{t("taskApproval.title")}</ThemedText>
      </Pressable>
      {open && (
        <>
          {loading && <ActivityIndicator />}
          {error ? (
            <>
              <ThemedText accessibilityRole="alert">{error}</ThemedText>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setLoading(true);
                  setError("");
                  setRevision((v) => v + 1);
                }}
              >
                <ThemedText>{t("inbox.retry")}</ThemedText>
              </Pressable>
            </>
          ) : !loading && rows.length === 0 ? (
            <ThemedText>{t("taskApproval.empty")}</ThemedText>
          ) : null}
          {rows.map((row) => (
            <View key={row.id}>
              <ThemedText>
                {row.input.title ?? row.id} · {t(`taskApproval.${row.status}`)}
              </ThemedText>
              {row.decisionNote && <ThemedText>{row.decisionNote}</ThemedText>}
            </View>
          ))}
        </>
      )}
    </View>
  );
}
