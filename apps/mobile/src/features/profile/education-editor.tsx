import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations, type MessageKey } from "@/i18n";
import { parseEducation, serializeEducation, type EducationEntry } from "./education";
const fields: { key: keyof EducationEntry; label: MessageKey }[] = [
  { key: "schoolName", label: "profileEdit.school" },
  { key: "major", label: "profileEdit.major" },
  { key: "startDate", label: "profileEdit.startDate" },
  { key: "endDate", label: "profileEdit.endDate" },
];
export function EducationEditor({
  study,
  disabled,
  onChange,
}: {
  study: string;
  disabled: boolean;
  onChange: (study: string) => void;
}) {
  const theme = useTheme();
  const t = useTranslations();
  const [entries, setEntries] = useState(() => parseEducation(study));
  const change = (next: EducationEntry[]) => {
    setEntries(next);
    onChange(serializeEducation(next));
  };
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold">{t("profileEdit.education")}</ThemedText>
      {!entries.length && <ThemedText>{t("profileEdit.educationEmpty")}</ThemedText>}
      {entries.map((entry, index) => (
        <View key={index} style={[styles.entry, { borderColor: theme.border }]}>
          {fields.map((field) => (
            <View key={field.key} style={styles.field}>
              <ThemedText>{t(field.label)}</ThemedText>
              <TextInput
                accessibilityLabel={`${t(field.label)} ${index + 1}`}
                editable={!disabled}
                value={entry[field.key] ?? ""}
                maxLength={field.key.endsWith("Date") ? 7 : 120}
                placeholder={field.key.endsWith("Date") ? "YYYY-MM" : undefined}
                placeholderTextColor={theme.textSecondary}
                onChangeText={(value) =>
                  change(
                    entries.map((row, i) => (i === index ? { ...row, [field.key]: value } : row))
                  )
                }
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
              />
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => change(entries.filter((_, i) => i !== index))}
          >
            <ThemedText style={{ color: theme.brand }}>
              {t("profileEdit.removeEducation")}
            </ThemedText>
          </Pressable>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() =>
          change([...entries, { schoolName: "", major: "", startDate: "", endDate: "" }])
        }
      >
        <ThemedText type="smallBold">{t("profileEdit.addEducation")}</ThemedText>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: Spacing.three },
  entry: { gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: 8 },
  field: { gap: Spacing.two },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, padding: Spacing.three, fontSize: 16 },
});
