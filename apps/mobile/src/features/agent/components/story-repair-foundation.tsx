import { TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  readRepairFoundation,
  foundationLimits,
  type FoundationField,
} from "../lib/story-repair-foundation";
import type { RepairContent } from "../lib/story-repair-fields";
export function StoryRepairFoundation({
  content,
  canEdit,
  onChange,
}: {
  content: RepairContent;
  canEdit: boolean;
  onChange: (field: FoundationField, value: string) => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  let fields;
  try {
    fields = readRepairFoundation(content);
  } catch (error) {
    return <ThemedText accessibilityRole="alert">{String(error)}</ThemedText>;
  }
  return (
    <View style={{ gap: 12 }}>
      {(["logline", "synopsis"] as const).map((field) => (
        <View key={field} style={{ gap: 6 }}>
          <ThemedText type="smallBold">{t(`storyFoundation.${field}`)}</ThemedText>
          <TextInput
            accessibilityLabel={t(`storyFoundation.${field}`)}
            value={fields[field]}
            multiline
            editable={canEdit}
            maxLength={foundationLimits[field]}
            onChangeText={(value) => {
              if (canEdit) onChange(field, value);
            }}
            style={{
              color: theme.text,
              borderColor: theme.border,
              borderWidth: 1,
              borderRadius: 8,
              padding: 10,
              minHeight: field === "synopsis" ? 120 : 64,
              textAlignVertical: "top",
            }}
          />
          <ThemedText type="small" themeColor="textSecondary">
            {fields[field].length} / {foundationLimits[field]}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}
