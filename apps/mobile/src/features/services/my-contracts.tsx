import { useState } from "react";
import { useIsFocused } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { MyAgreements } from "./my-agreements";
import { TaskContract } from "./task-contract";
import { useTaskCenter } from "./use-task-center";
import type { CenterFilters } from "./task-center-api";
type Props = { userId: string; generation: number };
const filters: CenterFilters = {
  scope: "all",
  status: "all",
  crewId: "",
  taskKind: "",
  query: "",
  hasContract: true,
};
export function MyContracts(props: Props) {
  const focused = useIsFocused();
  return focused && props.generation === getAuthGeneration() ? (
    <Session key={`${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const [section, setSection] = useState<"agreements" | "files">("agreements");
  const active = useScreenActive();
  return (
    <View style={{ flex: 1, display: active ? "flex" : "none" }}>
      <View
        accessibilityRole="tablist"
        style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16 }}
      >
        {(["agreements", "files"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            aria-selected={section === value}
            onPress={() => setSection(value)}
            style={{
              padding: 12,
              borderBottomWidth: 2,
              borderBottomColor: section === value ? theme.brand : "transparent",
            }}
          >
            <ThemedText>{t(`myContracts.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      {section === "agreements" ? <MyAgreements {...props} /> : <ContractFiles {...props} />}
    </View>
  );
}
function ContractFiles(props: Props) {
  const t = useTranslations();
  const active = useScreenActive();
  const list = useTaskCenter(active, props.generation, filters);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("myContracts.description")}</ThemedText>
      <Pressable
        accessibilityRole="button"
        disabled={list.loading}
        onPress={list.refresh}
        style={{ paddingVertical: 12 }}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      {list.loading && <ActivityIndicator />}
      {list.error ? (
        <View style={{ gap: 8 }}>
          <ThemedText accessibilityRole="alert">{list.error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={list.loading}
            onPress={list.retry}
            style={{ paddingVertical: 12 }}
          >
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </View>
      ) : (
        <>
          {!list.loading && !list.items.length && <ThemedText>{t("myContracts.empty")}</ThemedText>}
          {list.items.map((item) => (
            <View key={item.id} style={{ gap: 4 }}>
              <ThemedText type="smallBold">{item.title}</ThemedText>
              <ThemedText>{item.crew.name}</ThemedText>
              {item.contractAssetNodeId && (
                <TaskContract
                  key={item.contractAssetNodeId}
                  {...props}
                  crewId={item.crew.id}
                  assetId={item.contractAssetNodeId}
                />
              )}
            </View>
          ))}
          {list.hasMore && (
            <Pressable
              accessibilityRole="button"
              disabled={list.loading}
              onPress={list.loadMore}
              style={{ paddingVertical: 12 }}
            >
              <ThemedText>{t("crewFinance.more")}</ThemedText>
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}
