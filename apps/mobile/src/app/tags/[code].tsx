import { useAuth } from "@/auth";
import { useBrowseVersion } from "@/data/browse-refresh";
import { Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { IpTagCatalogue } from "@/features/browse/ip-tag-catalogue";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";

export default function IpTagScreen() {
  const { code } = useLocalSearchParams<{ code?: string | string[] }>();
  const { generation } = useAuth();
  const browseVersion = useBrowseVersion();
  const locale = useLocale(),
    t = useTranslations(),
    theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("ipTag.title"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      <IpTagCatalogue
        key={JSON.stringify([code, locale, generation, browseVersion])}
        code={typeof code === "string" ? code : ""}
      />
    </View>
  );
}
