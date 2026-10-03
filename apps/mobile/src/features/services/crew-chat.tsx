import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useIsFocused } from "expo-router";
import { useTranslations } from "@/i18n";
import { fetchCrewConversation } from "./conversation-api";
import { NativeConversation } from "./native-conversation";
type Props = { crewId: string; channel: "team" | "community"; userId: string; generation: number };
export function CrewChat(props: Props) {
  const active = useIsFocused();
  const [revision, setRevision] = useState(0);
  if (!active || props.generation !== getAuthGeneration()) return null;
  return (
    <Session
      key={`${props.crewId}:${props.channel}:${props.userId}:${props.generation}:${revision}`}
      {...props}
      onRetry={() => setRevision((n) => n + 1)}
    />
  );
}
function Session(props: Props & { onRetry: () => void }) {
  const t = useTranslations();
  const [id, setId] = useState<string>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void fetchCrewConversation(props.crewId, props.channel, props.userId, c.signal).then(
      (row) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setId(row.id);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.crewId, props.channel, props.userId, props.generation]);
  if (id) return <NativeConversation id={id} userId={props.userId} generation={props.generation} />;
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable accessibilityRole="button" onPress={props.onRetry} style={{ padding: 12 }}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}
