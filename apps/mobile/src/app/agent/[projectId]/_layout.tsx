import { IconLayoutGrid, IconMessageCircle, IconScript } from "@tabler/icons-react-native";
import { Tabs, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  StoryChapterProvider,
  useStoryChapterContext,
} from "@/features/agent/context/story-chapter-context";
import { StoryProjectHeaderActions } from "@/features/agent/components/story-project-header-actions";
import { StoryProjectHeaderBack } from "@/features/agent/components/story-project-header-back";
import { STORY_TAB_BAR_CONTENT_HEIGHT } from "@/features/agent/lib/story-tab-bar";
import { isAgentOsId } from "@/features/agent/lib/ids";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

const NAV_BG = "#0A0A0A";
const NAV_BORDER = "rgba(255,255,255,0.08)";
const NAV_INACTIVE = "rgba(255,255,255,0.44)";

function StoryProjectTabs({
  projectId,
  chapterId = "",
}: {
  projectId: string;
  chapterId?: string;
}) {
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = STORY_TAB_BAR_CONTENT_HEIGHT + insets.bottom;
  const showProjectActions = isAgentOsId(projectId);
  const chapterParams = { projectId, ...(chapterId ? { chapterId } : {}) };

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTransparent: false,
        headerStyle: {
          backgroundColor: NAV_BG,
          borderBottomColor: NAV_BORDER,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        headerShadowVisible: false,
        headerTintColor: theme.text,
        headerBackButtonDisplayMode: "minimal",
        headerLeft: showProjectActions
          ? () => <StoryProjectHeaderBack tintColor={theme.text} />
          : undefined,
        headerRight: showProjectActions
          ? () => <StoryProjectHeaderActions projectId={projectId} />
          : undefined,
        headerTitle: () => null,
        headerTitleAlign: "left",
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: NAV_INACTIVE,
        tabBarHideOnKeyboard: false,
        tabBarStyle: {
          backgroundColor: NAV_BG,
          borderTopColor: NAV_BORDER,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: tabBarHeight,
          paddingBottom: insets.bottom,
          paddingTop: 0,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "500",
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          href: { pathname: "/agent/[projectId]", params: chapterParams },
          tabBarLabel: t("agent.tabs.chat"),
          tabBarIcon: ({ color }) => (
            <IconMessageCircle size={20} strokeWidth={1.6} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="script"
        options={{
          href: { pathname: "/agent/[projectId]/script", params: chapterParams },
          tabBarLabel: t("agent.tabs.script"),
          tabBarIcon: ({ color }) => <IconScript size={20} strokeWidth={1.6} color={color} />,
        }}
      />
      <Tabs.Screen
        name="assets"
        options={{
          href: { pathname: "/agent/[projectId]/assets", params: chapterParams },
          tabBarLabel: t("agent.tabs.assets"),
          tabBarIcon: ({ color }) => <IconLayoutGrid size={20} strokeWidth={1.6} color={color} />,
        }}
      />
    </Tabs>
  );
}

function SelectedChapterTabs({ projectId }: { projectId: string }) {
  const { chapterId, requestedChapterId } = useStoryChapterContext();
  return <StoryProjectTabs projectId={projectId} chapterId={chapterId || requestedChapterId} />;
}

/** Story project workspace — native tab bar + shared chapter context. */
export default function StoryProjectLayout() {
  const { projectId: projectIdParam } = useLocalSearchParams<{ projectId: string }>();
  const projectId = projectIdParam?.trim() ?? "";
  const auth = useAuth();
  const { requireAuth } = useAuthGate();
  const t = useTranslations();

  if (auth.status !== "authenticated") {
    return (
      <ThemedView style={{ flex: 1 }}>
        <View style={{ padding: 16 }}>
          {auth.status === "hydrating" ? (
            <ActivityIndicator />
          ) : (
            <Pressable
              accessibilityRole="button"
              style={{ padding: 12 }}
              onPress={() => requireAuth()}
            >
              <ThemedText>{t("login.signIn")}</ThemedText>
            </Pressable>
          )}
        </View>
      </ThemedView>
    );
  }

  if (!isAgentOsId(projectId)) {
    return <StoryProjectTabs projectId={projectId} />;
  }

  return (
    <StoryChapterProvider key={`${projectId}:${auth.generation}`} projectId={projectId}>
      <SelectedChapterTabs projectId={projectId} />
    </StoryChapterProvider>
  );
}
