import { useState } from "react";
import { Modal, Pressable, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { TaskMentionPicker } from "./task-mention-picker";
import { useUserDisplays } from "./user-displays";
import { customFieldText, type CustomField, type CustomValue } from "./task-custom-fields-api";
export function TaskCustomFieldControl({
  field,
  draft,
  setDraft,
  locked,
  crewId,
  userId,
  generation,
}: {
  field: CustomField;
  draft: CustomValue;
  setDraft: (value: CustomValue) => void;
  locked: boolean;
  crewId: string;
  userId: string;
  generation: number;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [picker, setPicker] = useState(false);
  const users = useUserDisplays(
    String(generation),
    field.type === "user" && typeof draft === "string" ? [draft] : []
  );
  const options =
    field.type === "checkbox"
      ? [
          { id: "yes", label: t("taskCustomFields.yes"), value: true },
          { id: "no", label: t("taskCustomFields.no"), value: false },
        ]
      : field.options.map((o) => ({ ...o, value: o.id }));
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">
        {field.name}
        {field.required ? " *" : ""}
      </ThemedText>
      {field.type === "text" || field.type === "number" || field.type === "date" ? (
        <TextInput
          accessibilityLabel={field.name}
          value={draft == null ? "" : String(draft)}
          onChangeText={setDraft}
          editable={!locked}
          maxLength={4000}
          keyboardType={field.type === "number" ? "numbers-and-punctuation" : "default"}
          placeholder={field.type === "date" ? "YYYY-MM-DD" : undefined}
          placeholderTextColor={theme.textSecondary}
          style={{ color: theme.text, padding: 12 }}
        />
      ) : field.type === "user" ? (
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => setPicker(true)}
          style={{ padding: 12 }}
        >
          <ThemedText>
            {customFieldText(
              field,
              draft,
              { unset: t("taskCustomFields.chooseMember"), yes: "", no: "" },
              users
            )}
          </ThemedText>
        </Pressable>
      ) : (
        options.map((o) => {
          const selected = Array.isArray(draft)
            ? draft.includes(String(o.value))
            : draft === o.value;
          return (
            <Pressable
              key={o.id}
              accessibilityRole={field.type === "multi_select" ? "checkbox" : "radio"}
              accessibilityState={{ checked: selected, selected }}
              disabled={locked}
              style={{
                padding: 12,
                backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
              }}
              onPress={() =>
                setDraft(
                  field.type === "multi_select"
                    ? selected
                      ? (Array.isArray(draft) ? draft : []).filter((id) => id !== o.id)
                      : [...(Array.isArray(draft) ? draft : []), o.id]
                    : o.value
                )
              }
            >
              <ThemedText>{o.label}</ThemedText>
            </Pressable>
          );
        })
      )}
      {!field.required && (
        <Pressable accessibilityRole="button" disabled={locked} onPress={() => setDraft(null)}>
          <ThemedText>{t("taskCustomFields.clear")}</ThemedText>
        </Pressable>
      )}
      <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          <TaskMentionPicker
            crewId={crewId}
            userId={userId}
            generation={generation}
            excludedIds={[]}
            includeSelf
            title={field.name}
            onClose={() => setPicker(false)}
            onSelect={(member) => {
              if (generation === getAuthGeneration() && !locked) {
                setDraft(member.userId);
                setPicker(false);
              }
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
