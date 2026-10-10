import { Image } from "expo-image";
import { View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useUserDisplays } from "./user-displays";

export function TaskDraftAssignees({
  owner,
  userIds,
  labels,
}: {
  owner: string;
  userIds: string[];
  labels: string[];
}) {
  const t = useTranslations(),
    theme = useTheme();
  const displays = useUserDisplays(owner, userIds);
  return (
    <View style={{ gap: 6 }}>
      <ThemedText>{t("taskCreate.assignees")}</ThemedText>
      {!userIds.length && <ThemedText>{t("thread.taskUnset")}</ThemedText>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {userIds.map((id, index) => {
          const display = displays?.get(id);
          const name = display?.nickname || labels[index] || id;
          return (
            <View
              key={id}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  overflow: "hidden",
                  backgroundColor: theme.backgroundSelected,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ThemedText type="small">{Array.from(name.trim())[0] || "?"}</ThemedText>
                {display?.avatar && (
                  <Image
                    source={{ uri: display.avatar }}
                    recyclingKey={id + display.avatar}
                    accessible={false}
                    style={{ position: "absolute", width: 28, height: 28 }}
                  />
                )}
              </View>
              <ThemedText type="small" style={{ flexShrink: 1 }}>
                {name}
              </ThemedText>
            </View>
          );
        })}
      </View>
    </View>
  );
}
