import { ServiceCreate } from "@/features/services/service-create";
import { CreatorLocationEditor } from "@/features/services/creator-location-editor";
import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { CREATOR_SERVICE_STATUSES } from "@repo/shared/creator-service";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
import { useOwnedServices } from "@/features/services/use-owned-services";
import type { ServiceFilter } from "@/features/services/owner-service-api";

export default function MyServicesScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    router = useRouter();
  const [status, setStatus] = useState<ServiceFilter>("");
  const creatorId = String(auth.user?.userId ?? auth.user?.id ?? "");
  const owner =
    auth.status === "authenticated" && active && creatorId ? String(auth.generation) : undefined;
  const list = useOwnedServices(owner, creatorId, status);
  return (
    <View style={{ flex: 1, backgroundColor: theme.background, padding: 16, gap: 12 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("myServices.title"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable accessibilityRole="button" onPress={() => gate.requireAuth()}>
          <ThemedText>{t("myServices.signIn")}</ThemedText>
        </Pressable>
      ) : (
        <>
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(["", ...CREATOR_SERVICE_STATUSES] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: status === value }}
                  onPress={() => setStatus(value)}
                  style={{
                    padding: 10,
                    backgroundColor:
                      status === value ? theme.backgroundSelected : theme.backgroundElement,
                  }}
                >
                  <ThemedText>
                    {t(value ? `myServices.status.${value}` : "myServices.all")}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <FlatList
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View>
                <CreatorLocationEditor
                  key={`location:${auth.generation}`}
                  scope={{ userId: creatorId, generation: auth.generation }}
                />
                <ServiceCreate
                  key={auth.generation}
                  onCreated={(id) => {
                    list.refresh();
                    router.push(toHref(`/service/${encodeURIComponent(id)}`));
                  }}
                />
              </View>
            }
            data={list.items}
            keyExtractor={(item) => item.id}
            onEndReached={list.items.length ? list.loadMore : undefined}
            onRefresh={list.refresh}
            refreshing={list.loading}
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(toHref(`/service/${encodeURIComponent(item.id)}`))}
                style={{
                  padding: 14,
                  marginBottom: 8,
                  borderRadius: 8,
                  backgroundColor: theme.backgroundElement,
                }}
              >
                <ThemedText type="smallBold">{item.title}</ThemedText>
                <ThemedText numberOfLines={2}>{item.summary}</ThemedText>
              </Pressable>
            )}
            ListEmptyComponent={
              !list.loading && !list.error && !list.hasMore ? (
                <ThemedText>{t("myServices.empty")}</ThemedText>
              ) : null
            }
            ListFooterComponent={
              <View>
                {list.loading && <ActivityIndicator />}
                {list.hasMore && !list.loading && !list.error && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={list.loadMore}
                    style={{ paddingVertical: 12 }}
                  >
                    <ThemedText>{t("myServices.loadMore")}</ThemedText>
                  </Pressable>
                )}
                {list.error && (
                  <>
                    <ThemedText accessibilityRole="alert">{list.error}</ThemedText>
                    <Pressable accessibilityRole="button" onPress={list.retry}>
                      <ThemedText>{t("common.retry")}</ThemedText>
                    </Pressable>
                  </>
                )}
              </View>
            }
          />
        </>
      )}
    </View>
  );
}
