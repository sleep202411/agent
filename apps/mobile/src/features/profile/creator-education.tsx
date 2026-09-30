import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { SectionHeader } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";
import { parseEducation } from "./education";

/** Public education only; private contact details are never part of this view. */
export function CreatorEducation({ study }: { study?: string }) {
  const t = useTranslations();
  const entries = parseEducation(study).filter((entry) =>
    [entry.schoolName, entry.major, entry.startDate, entry.endDate].some((value) => value?.trim())
  );
  if (!entries.length) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title={t("profileEdit.education")} />
      {entries.map((entry, index) => {
        const start = entry.startDate.trim();
        const end = entry.endDate?.trim();
        const range = start ? `${start} — ${end || t("creatorDetail.present")}` : end;
        return (
          <View key={index} style={styles.entry}>
            {!!entry.schoolName.trim() && (
              <ThemedText type="smallBold">{entry.schoolName}</ThemedText>
            )}
            {!!entry.major.trim() && (
              <ThemedText type="small" themeColor="textSecondary">
                {entry.major}
              </ThemedText>
            )}
            {!!range && (
              <ThemedText type="small" themeColor="textSecondary">
                {range}
              </ThemedText>
            )}
          </View>
        );
      })}
    </View>
  );
}
const styles = StyleSheet.create({ section: { gap: Spacing.three }, entry: { gap: Spacing.one } });
