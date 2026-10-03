import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from "react-native";
import { ApiRequestError } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { fetchMentionMembers, type MentionMember, type TaskMention } from "./task-mentions";
import { useUserDisplays } from "./user-displays";
export function TaskMentionPicker({
  crewId,
  userId,
  generation,
  excludedIds,
  onSelect,
  onSelectMember,
  onClose,
  includeSelf = false,
  title,
}: {
  crewId: string;
  userId: string;
  generation: number;
  excludedIds: string[];
  onClose: () => void;
  includeSelf?: boolean;
  title?: string;
} & (
  | { onSelect: (mention: TaskMention) => void; onSelectMember?: never }
  | { onSelect?: never; onSelectMember: (member: TaskMention & { crewMemberId: string }) => void }
)) {
  const t = useTranslations(),
    theme = useTheme();
  const [items, setItems] = useState<MentionMember[]>([]),
    [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string>(),
    [more, setMore] = useState(false);
  const loader = useRef<() => void>(() => {}),
    selected = useRef(false);
  const displays = useUserDisplays(
    String(generation),
    items.map((item) => item.userId)
  );
  useEffect(() => {
    const controller = new AbortController();
    let busy = false,
      cursor: string | null = null,
      loaded: MentionMember[] = [];
    const seen = new Set<string>();
    const current = () => !controller.signal.aborted && generation === getAuthGeneration();
    const load = async () => {
      if (busy || !current()) return;
      busy = true;
      setLoading(true);
      setError(undefined);
      try {
        const page = await fetchMentionMembers(crewId, cursor, controller.signal);
        if (!current()) return;
        if (page.nextCursor && (page.nextCursor === cursor || seen.has(page.nextCursor)))
          throw new Error("Repeated Crew member cursor");
        if (page.nextCursor) seen.add(page.nextCursor);
        loaded = Array.from(
          new Map([...loaded, ...page.items].map((item) => [item.userId, item])).values()
        );
        cursor = page.nextCursor;
        setItems(loaded);
        setMore(!!cursor);
      } catch (cause) {
        if (current()) {
          const retryable =
            cause instanceof ApiRequestError &&
            (cause.status === 0 || cause.status === 429 || cause.status >= 500);
          if (!retryable) {
            loaded = [];
            cursor = null;
            seen.clear();
            setMore(false);
          }
          setItems(loaded);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        busy = false;
        if (current()) setLoading(false);
      }
    };
    loader.current = () => {
      void load();
    };
    void load();
    return () => controller.abort();
  }, [crewId, generation]);
  const candidates = items
    .filter((item) => (includeSelf || item.userId !== userId) && !excludedIds.includes(item.userId))
    .map((item) => ({
      crewMemberId: item.id,
      userId: item.userId,
      label:
        (displays?.get(item.userId)?.nickname || item.userId)
          .replace(/[@\r\n]/g, " ")
          .trim()
          .slice(0, 80) || item.userId,
    }))
    .filter((item) =>
      `${item.label} ${item.userId}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
    );
  return (
    <View style={{ flex: 1, padding: 12, gap: 10 }}>
      <ThemedText>{title ?? t("thread.mention")}</ThemedText>
      <TextInput
        accessibilityLabel={t("thread.findMember")}
        value={query}
        onChangeText={setQuery}
        style={{ color: theme.text, padding: 12 }}
      />
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={candidates}
        keyExtractor={(item) => item.userId}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12 }}
            onPress={() => {
              if (!selected.current && generation === getAuthGeneration()) {
                selected.current = true;
                if (onSelectMember) onSelectMember(item);
                else onSelect({ userId: item.userId, label: item.label });
              }
            }}
          >
            <ThemedText>
              @{item.label} · {item.userId}
            </ThemedText>
          </Pressable>
        )}
      />
      {loading && <ActivityIndicator />}
      {!loading && !error && !candidates.length && (
        <ThemedText>{t("taskActivity.noMembers")}</ThemedText>
      )}
      {error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={() => loader.current()}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("inbox.retry")}</ThemedText>
          </Pressable>
        </>
      )}
      {more && !error && (
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => loader.current()}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("discovery.more")}</ThemedText>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={onClose}>
        <ThemedText>{t("common.cancel")}</ThemedText>
      </Pressable>
    </View>
  );
}
