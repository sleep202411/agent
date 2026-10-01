import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ENROLLMENT_CONSENT_VERSION } from "./character-library-api";
import { PROJECT_LIKENESS_CONSENT_VERSION } from "./casting-accept-api";
type ConsentProps = {
  projectName: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: (read: boolean, adultAttested: boolean) => void;
  onBack: () => void;
};
export function ProjectLikenessConsent(props: ConsentProps) {
  return <LikenessConsent {...props} mode="project" />;
}
export function EnrollmentConsent(props: Omit<ConsentProps, "projectName">) {
  return <LikenessConsent {...props} projectName="" mode="enrollment" />;
}
/** Mount with a project/likeness key so changing the consent subject resets both gates. */
function LikenessConsent({
  mode,
  projectName,
  confirmLabel,
  busy,
  onConfirm,
  onBack,
}: {
  mode: "project" | "enrollment";
  projectName: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: (read: boolean, adultAttested: boolean) => void;
  onBack: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [read, setRead] = useState(false),
    [attested, setAttested] = useState(false),
    [height, setHeight] = useState(0),
    [viewport, setViewport] = useState(0);
  const enrollment = mode === "enrollment";
  const prefix = enrollment ? "enrollmentConsent.consent" : "castingConsent.grant";
  const sections = enrollment
    ? (["Purpose", "Data", "Transfer", "Retention", "Scope", "Withdraw", "Outputs"] as const).map(
        (key) => ({
          key,
          title: t(`enrollmentConsent.consent${key}Title`),
          body: t(`enrollmentConsent.consent${key}Body`),
        })
      )
    : (["Project", "Purpose", "Prohibited", "Transfer", "Controls"] as const).map((key) => ({
        key,
        title: t(`castingConsent.grant${key}Title`),
        body: t(`castingConsent.grant${key}Body`),
      }));
  const readAll = read || (height > 0 && viewport > 0 && height <= viewport + 12);
  return (
    <View style={{ gap: 10 }}>
      <ScrollView
        testID={enrollment ? "enrollment-consent-copy" : "casting-consent-copy"}
        nestedScrollEnabled
        style={{ height: 300, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => setHeight(h)}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const n = e.nativeEvent;
          if (n.layoutMeasurement.height + n.contentOffset.y >= n.contentSize.height - 12)
            setRead(true);
        }}
      >
        <ThemedText type="small">
          {enrollment
            ? t("enrollmentConsent.consentVersionLabel").replace(
                "{version}",
                ENROLLMENT_CONSENT_VERSION
              )
            : PROJECT_LIKENESS_CONSENT_VERSION}
        </ThemedText>
        {sections.map((s) => (
          <View key={s.key} style={{ gap: 4 }}>
            <ThemedText type="smallBold">{s.title}</ThemedText>
            <ThemedText type="small">{s.body.replace("{project}", projectName)}</ThemedText>
          </View>
        ))}
      </ScrollView>
      {!readAll ? (
        <ThemedText type="small">
          {t(
            enrollment ? "enrollmentConsent.consentScrollHint" : "castingConsent.consentScrollHint"
          )}
        </ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: attested }}
        disabled={busy}
        onPress={() => setAttested((v) => !v)}
        style={{ padding: 10 }}
      >
        <ThemedText>
          {attested ? "✓ " : "□ "}
          {t(`${prefix}Attestation`)}
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy || !readAll || !attested}
        onPress={() => {
          if (readAll && attested && !busy) onConfirm(readAll, attested);
        }}
        style={{ padding: 12, opacity: busy || !readAll || !attested ? 0.45 : 1 }}
      >
        <ThemedText type="small">{confirmLabel}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onBack}
        style={{ padding: 12 }}
      >
        <ThemedText type="small">{t("common.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
