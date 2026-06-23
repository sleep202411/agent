import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { isAccountDeletionRequested, markAccountDeletionRequested } from "@/lib/legal";

export default function DeleteAccountScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const [requested, setRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void isAccountDeletionRequested().then(setRequested);
  }, []);

  const notices = [
    t("deleteAccount.notice1"),
    t("deleteAccount.notice2"),
    t("deleteAccount.notice3"),
  ];

  const submit = () => {
    if (submitting) return;
    Alert.alert(t("deleteAccount.confirmTitle"), t("deleteAccount.confirmMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("deleteAccount.confirm"),
        style: "destructive",
        onPress: async () => {
          setSubmitting(true);
          // Submit a deletion request. Until the real deletion backend lands this
          // is recorded locally and reads as "under review" — the account isn't
          // actually removed yet.
          await markAccountDeletionRequested();
          setRequested(true);
          setSubmitting(false);
          Alert.alert(t("deleteAccount.submittedTitle"), t("deleteAccount.submittedMessage"));
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("settings.deleteAccount"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <ThemedText type="subtitle" style={styles.noticeTitle}>
          {t("deleteAccount.noticeTitle")}
        </ThemedText>
        {notices.map((line, i) => (
          <ThemedText key={i} themeColor="textSecondary" style={styles.noticeLine}>
            {`${i + 1}. ${line}`}
          </ThemedText>
        ))}

        {requested ? (
          <View
            style={[
              styles.reviewBanner,
              { borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          >
            <ThemedText themeColor="textSecondary">
              {t("deleteAccount.submittedMessage")}
            </ThemedText>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={submitting}
            onPress={submit}
            style={({ pressed }) => (pressed || submitting ? styles.pressed : null)}
          >
            <View style={[styles.submitBtn, { backgroundColor: theme.brand }]}>
              <ThemedText style={styles.submitText}>{t("deleteAccount.confirm")}</ThemedText>
            </View>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, gap: Spacing.three },
  noticeTitle: { fontSize: 16, marginBottom: Spacing.one },
  noticeLine: { fontSize: 14, lineHeight: 22 },
  pressed: { opacity: 0.7 },
  reviewBanner: {
    marginTop: Spacing.six,
    padding: Spacing.four,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  submitBtn: {
    marginTop: Spacing.eight,
    paddingVertical: Spacing.four,
    borderRadius: 999,
    alignItems: "center",
  },
  submitText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
});
