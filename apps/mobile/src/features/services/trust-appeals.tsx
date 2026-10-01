import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchTrustAppeals, reviewTrustAppeal, type TrustAppeal } from "./trust-appeals-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function TrustAppeals(props: Props) {
  const [history, setHistory] = useState(false);
  return (
    <Queue
      key={`${props.crewId}:${props.generation}:${history}`}
      {...props}
      history={history}
      toggleHistory={() => setHistory((v) => !v)}
    />
  );
}
function Queue({
  crewId,
  userId,
  generation,
  onClose,
  history,
  toggleHistory,
}: Props & { history: boolean; toggleHistory: () => void }) {
  const t = useTranslations(),
    theme = useTheme();
  const label = (key: string) => t(`trustAppeals.${key}` as MessageKey);
  const [items, setItems] = useState<TrustAppeal[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string>(),
    [blocked, setBlocked] = useState(false);
  const [selected, setSelected] = useState<TrustAppeal>(),
    [reason, setReason] = useState(""),
    [decision, setDecision] = useState<"upheld" | "200" | "-200">("upheld");
  const active = useRef<AbortController | null>(null),
    seen = useRef(new Set<string>());
  const valid = useCallback(() => generation === getAuthGeneration(), [generation]);
  const load = useCallback(
    async (next: string | null = null) => {
      if (active.current || !valid()) return;
      const controller = new AbortController();
      active.current = controller;
      setLoading(true);
      setError(undefined);
      setSelected(undefined);
      if (!next) {
        setItems([]);
        setCursor(null);
        seen.current.clear();
      }
      try {
        const page = await fetchTrustAppeals(
          crewId,
          userId,
          generation,
          history,
          next,
          controller.signal
        );
        if (controller.signal.aborted || !valid()) return;
        if (page.nextCursor && (page.nextCursor === next || seen.current.has(page.nextCursor)))
          throw new Error("Appeal pagination did not advance");
        if (page.nextCursor) seen.current.add(page.nextCursor);
        setItems((old) =>
          Array.from(new Map([...(next ? old : []), ...page.items].map((a) => [a.id, a])).values())
        );
        setCursor(page.nextCursor);
        setBlocked(false);
      } catch (cause) {
        if (!controller.signal.aborted && valid()) {
          setItems([]);
          setCursor(null);
          setBlocked(true);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (active.current === controller) {
          active.current = null;
          if (!controller.signal.aborted && valid()) setLoading(false);
        }
      }
    },
    [crewId, userId, generation, history, valid]
  );
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) void load();
    });
    return () => {
      mounted = false;
      active.current?.abort();
      active.current = null;
    };
  }, [load]);
  async function submit() {
    if (!selected || active.current || blocked || !reason.trim() || !valid()) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      await reviewTrustAppeal(
        crewId,
        userId,
        generation,
        selected.id,
        {
          ...(decision === "upheld"
            ? { decision: "upheld" as const }
            : { decision: "corrected" as const, points: Number(decision) as 200 | -200 }),
          reason,
          expectedCorrectionId: selected.currentCorrectionId,
        },
        controller.signal
      );
      if (controller.signal.aborted || !valid()) return;
      active.current = null;
      setSelected(undefined);
      setReason("");
      await load();
    } catch (cause) {
      if (!controller.signal.aborted && valid()) {
        setSelected(undefined);
        setBlocked(true);
        setItems([]);
        setCursor(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted && valid()) setLoading(false);
      }
    }
  }
  if (!valid()) return null;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <Button text={label("back")} onPress={onClose} disabled={loading} />
      <ThemedText type="subtitle">{label("queue")}</ThemedText>
      <ThemedText type="small">{label("managerHelp")}</ThemedText>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: history, disabled: loading || !!selected }}
        disabled={loading || !!selected}
        onPress={toggleHistory}
        style={{ padding: 12 }}
      >
        <ThemedText>
          {history ? "✓ " : ""}
          {label("history")}
        </ThemedText>
      </Pressable>
      <Button text={label("refresh")} onPress={() => void load()} disabled={loading} />
      {loading && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!loading && !error && !items.length && <ThemedText>{label("empty")}</ThemedText>}
      {items.map((a) => (
        <View
          key={a.id}
          style={{ padding: 12, gap: 8, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          <ThemedText type="small">
            {label("task")}: {a.taskId} · {label("creator")}: {a.userId}
          </ThemedText>
          <ThemedText>{a.reason}</ThemedText>
          <ThemedText type="small">{label(a.status)}</ThemedText>
          {a.reviewReason && (
            <ThemedText>
              {label("reviewReason")}: {a.reviewReason}
            </ThemedText>
          )}
          <ThemedText type="small">
            {label("original")}: {a.originalPoints} · {label("current")}: {a.points}
          </ThemedText>
          <ThemedText type="small">
            {label("submitted")}: {a.submittedAt} · {label("deadline")}: {a.deadline ?? "—"}
          </ThemedText>
          {a.status === "pending" && (
            <Button
              text={label("review")}
              onPress={() => {
                setSelected(a);
                setReason("");
                setDecision("upheld");
              }}
              disabled={loading || blocked}
            />
          )}
        </View>
      ))}
      {cursor && (
        <Button
          text={label("more")}
          onPress={() => void load(cursor)}
          disabled={loading || blocked}
        />
      )}
      {selected && (
        <View
          style={{ gap: 8, padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          <ThemedText>{selected.taskId}</ThemedText>
          <ThemedText>{label("shared")}</ThemedText>
          {(
            [
              ["upheld", "uphold"],
              ["200", "onTime"],
              ["-200", "late"],
            ] as const
          ).map(([value, key]) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: decision === value, disabled: loading }}
              disabled={loading}
              onPress={() => setDecision(value)}
              style={{ padding: 12 }}
            >
              <ThemedText>
                {decision === value ? "✓ " : ""}
                {label(key)}
              </ThemedText>
            </Pressable>
          ))}
          <TextInput
            accessibilityLabel={label("reviewReason")}
            multiline
            maxLength={2000}
            editable={!loading}
            value={reason}
            onChangeText={setReason}
            style={{
              color: theme.text,
              padding: 12,
              minHeight: 90,
              borderWidth: 1,
              borderColor: theme.textSecondary,
            }}
          />
          <Button
            text={label("confirm")}
            onPress={() => void submit()}
            disabled={loading || !reason.trim() || blocked}
          />
          <Button
            text={label("cancel")}
            onPress={() => setSelected(undefined)}
            disabled={loading}
          />
        </View>
      )}
    </ScrollView>
  );
}

function Button({
  text,
  onPress,
  disabled = false,
}: {
  text: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{text}</ThemedText>
    </Pressable>
  );
}
