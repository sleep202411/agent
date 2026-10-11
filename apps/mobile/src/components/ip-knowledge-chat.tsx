import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useIpKnowledge } from "@/features/ip-community/use-ip-knowledge";

interface IpKnowledgeChatProps {
  ipId: string;
  ipTitle: string;
}

export function IpKnowledgeChat({ ipId, ipTitle }: IpKnowledgeChatProps) {
  const t = useTranslations();
  const theme = useTheme();
  const [question, setQuestion] = useState("");
  const { ask, cancel: handleCancel, answer, citedIds, loading, error } = useIpKnowledge(ipId);
  const handleAsk = () => void ask(question);

  return (
    <View
      style={[
        styles.container,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}
    >
      <ThemedText style={styles.title}>{t("ipKnowledge.title")}</ThemedText>
      <ThemedText style={[styles.subtitle, { color: theme.textSecondary }]}>
        {t("ipKnowledge.subtitle")}
      </ThemedText>

      <View style={styles.inputRow}>
        <TextInput
          accessibilityLabel={t("ipKnowledge.placeholder")}
          value={question}
          onChangeText={setQuestion}
          placeholder={t("ipKnowledge.placeholder")}
          placeholderTextColor={theme.textSecondary}
          editable={!loading}
          maxLength={1000}
          style={[
            styles.input,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
              color: theme.text,
            },
          ]}
        />
        {loading ? (
          <Pressable
            accessibilityRole="button"
            onPress={handleCancel}
            style={[styles.button, { backgroundColor: theme.backgroundSelected }]}
          >
            <ThemedText style={[styles.buttonText, { color: theme.text }]}>
              {t("ipKnowledge.cancel")}
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={handleAsk}
            disabled={!question.trim()}
            style={[
              styles.button,
              { backgroundColor: theme.brand, opacity: question.trim() ? 1 : 0.4 },
            ]}
          >
            <ThemedText style={[styles.buttonText, { color: "#FFFFFF" }]}>
              {t("ipKnowledge.ask")}
            </ThemedText>
          </Pressable>
        )}
      </View>

      {loading && (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={theme.brand} />
          <ThemedText style={[styles.statusText, { color: theme.textSecondary }]}>
            {t("ipKnowledge.loading")}
          </ThemedText>
        </View>
      )}

      {error && (
        <View style={styles.statusRow}>
          <ThemedText style={[styles.statusText, { color: theme.brand }]}>{error}</ThemedText>
        </View>
      )}

      {answer && (
        <View style={[styles.answerBox, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText style={styles.answerText}>{answer}</ThemedText>
          {citedIds.length > 0 && (
            <View style={[styles.citationRow, { borderTopColor: theme.border }]}>
              <ThemedText style={[styles.citationLabel, { color: theme.textSecondary }]}>
                {t("ipKnowledge.sources")}:
              </ThemedText>
              {citedIds.map((id, index) => (
                <View
                  key={id}
                  style={[styles.citationChip, { backgroundColor: theme.backgroundElement }]}
                >
                  <ThemedText style={[styles.citationChipText, { color: theme.textSecondary }]}>
                    Ref #{index + 1}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: Spacing.four,
    padding: Spacing.four,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    marginBottom: Spacing.two,
  },
  inputRow: {
    flexDirection: "row",
    gap: Spacing.one,
    alignItems: "center",
  },
  input: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.two,
    fontSize: 14,
  },
  button: {
    height: 40,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  statusText: {
    fontSize: 12,
  },
  answerBox: {
    marginTop: Spacing.four,
    padding: Spacing.four,
    borderRadius: 8,
  },
  answerText: {
    fontSize: 14,
    lineHeight: 20,
  },
  citationRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  citationLabel: {
    fontSize: 11,
  },
  citationChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  citationChipText: {
    fontSize: 10,
    fontFamily: "monospace",
  },
});
