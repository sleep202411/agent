import { useState } from "react";
import { Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations, type MessageKey } from "@/i18n";
import { certificationGroups } from "./certification-guide-data";
export function CertificationGuide() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("certificationGuide.help")}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ padding: 12 }}
      >
        <ThemedText>?</ThemedText>
      </Pressable>
      {open && (
        <View style={{ gap: 12 }}>
          <ThemedText>{t("certificationGuide.title")}</ThemedText>
          {certificationGroups.map((group) => (
            <View key={group.key} style={{ gap: 8 }}>
              <ThemedText>{t(`certificationGuide.${group.key}`)}</ThemedText>
              {group.entries.map((entry) => (
                <View key={entry} style={{ gap: 4 }}>
                  <ThemedText>{t(`certificationGuide.${entry}Name` as MessageKey)}</ThemedText>
                  <ThemedText>
                    {t(`certificationGuide.${entry}Description` as MessageKey)}
                  </ThemedText>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
