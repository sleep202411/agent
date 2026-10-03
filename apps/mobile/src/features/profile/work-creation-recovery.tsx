import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { useMyWorks } from "./use-my-works";
import type { MyWork } from "@/data/mine-api";

/** An owner explicitly identifies a created work; titles are never an identity key. */
export function WorkCreationRecovery({
  owner,
  onSelect,
}: {
  owner: string;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<MyWork>();
  const list = useMyWorks(open ? owner : undefined);
  const button = (label: string, action: () => void) => (
    <Pressable accessibilityRole="button" onPress={action} style={{ padding: 12 }}>
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  if (!open) return button(t("publishWork.checkWorks"), () => setOpen(true));
  return (
    <View style={{ gap: 12 }}>
      <ThemedText>{t("publishWork.recoverHelp")}</ThemedText>
      {selected ? (
        <View style={{ padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8 }}>
          <ThemedText type="smallBold">{selected.title}</ThemedText>
          <ThemedText>{selected.introduction}</ThemedText>
          {button(t("publishWork.useExisting"), () => onSelect(selected.id))}
          {button(t("experienceEdit.cancel"), () => setSelected(undefined))}
        </View>
      ) : (
        <>
          {list.works?.map((work) => (
            <Pressable
              key={work.id}
              accessibilityRole="button"
              onPress={() => setSelected(work)}
              style={{ padding: 12 }}
            >
              <ThemedText type="smallBold">{work.title}</ThemedText>
              <ThemedText>{work.introduction}</ThemedText>
            </Pressable>
          ))}
          {list.loading && <ActivityIndicator />}
          {list.error && <ThemedText accessibilityRole="alert">{list.error}</ThemedText>}
          {list.failed
            ? button(t("profileEdit.retry"), list.retry)
            : !list.loading && list.hasMore
              ? button(t("publishWork.moreWorks"), list.loadMore)
              : null}
          {!list.loading && !list.failed && list.works?.length === 0 && (
            <ThemedText>{t("publishWork.noWorks")}</ThemedText>
          )}
        </>
      )}
      {button(t("experienceEdit.cancel"), () => {
        setOpen(false);
        setSelected(undefined);
      })}
    </View>
  );
}
