import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { searchContributorUsers } from "./contributors-api";
function LookupButton({
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
export function IpUserLookup({
  generation,
  disabled,
  onSelect,
  description,
}: {
  generation: number;
  disabled: boolean;
  description?: string;
  onSelect: (user: { userId: string; nickname: string }) => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchContributorUsers>> | null>(
    null
  );
  useEffect(() => {
    const c = new AbortController();
    if (disabled || query.trim().length < 3) return () => c.abort();
    const timer = setTimeout(() => {
      setLoading(true);
      void searchContributorUsers(query, generation, c.signal)
        .then((value) => {
          if (!c.signal.aborted) setResults(value);
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(String(e.message ?? e));
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query, generation, disabled]);
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="small">{description ?? t("ipContributors.lookupHint")}</ThemedText>
      <TextInput
        accessibilityLabel={t("ipContributors.lookup")}
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setResults(null);
          setError("");
          setLoading(false);
        }}
        editable={!disabled}
        maxLength={64}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ color: theme.text, padding: 12, backgroundColor: theme.background }}
      />
      {loading && !disabled && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {results?.length === 0 && <ThemedText>{t("ipContributors.noUsers")}</ThemedText>}
      {results?.map((user) => (
        <LookupButton
          key={user.userId}
          disabled={disabled}
          label={`${user.nickname || t("ipContributors.account")} · ${user.userId}`}
          onPress={() => onSelect(user)}
        />
      ))}
    </View>
  );
}
