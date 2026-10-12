import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, BackHandler, Pressable, View } from "react-native";
import { Stack, useIsFocused, useRouter, useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { newClientUuid as randomUUID } from "../lib/agent-os-events";
import { useStoryChapterContext } from "../context/story-chapter-context";
import { useQueryClient } from "@tanstack/react-query";
import { IconArrowLeft } from "@tabler/icons-react-native";
import { useAuth, useAuthGate } from "@/auth";
import { appEnv } from "@/config";
import { useLocale, useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { saveOutput } from "@/features/ai-lab/save-output";
import { api } from "@/lib/api-client";
import { StoryOutputsSchema } from "@repo/app-story-protocol";
import {
  AppStoryNativeBridge,
  storyBridgeScript,
  storyWebViewCookie,
  trustedStoryPage,
} from "../lib/app-story-native-bridge";

export function AppStoryNativeView({
  projectId,
  chapterId,
}: {
  projectId: string;
  chapterId: string;
}) {
  const auth = useAuth();
  return (
    <AppStoryNativeSession
      key={JSON.stringify([auth.generation, projectId, chapterId])}
      projectId={projectId}
      chapterId={chapterId}
    />
  );
}
function AppStoryNativeSession({ projectId, chapterId }: { projectId: string; chapterId: string }) {
  const params = useLocalSearchParams<{ q?: string; prefill?: string }>();
  const draftParam = params.prefill || params.q || "";
  const initialDraft = (Array.isArray(draftParam) ? (draftParam[0] ?? "") : draftParam).slice(
    0,
    16000
  );
  const auth = useAuth(),
    gate = useAuthGate(),
    locale = useLocale(),
    theme = useTheme(),
    t = useTranslations();
  const router = useRouter(),
    focused = useIsFocused(),
    queries = useQueryClient();
  const chapter = useStoryChapterContext();
  const web = useRef<WebView>(null);
  const [failure, setFailure] = useState<string | null>(null),
    [expired, setExpired] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const currentAttempt = useRef(attempt);
  const page = `${appEnv.api.auroraBaseUrl.replace(/\/$/, "")}/app-story-agent/ui/index.html`;
  const origin = new URL(page).origin;
  const cookie = auth.session?.token ? storyWebViewCookie(auth.session.token) : null;
  const send = useCallback(
    (message: Parameters<typeof storyBridgeScript>[0]) => {
      web.current?.injectJavaScript(storyBridgeScript(message, origin));
    },
    [origin]
  );
  const bridge = useMemo(() => {
    const controller = new AbortController();
    const host = new AppStoryNativeBridge(
      {
        projectId,
        chapterId,
        locale,
        initialDraft,
        capabilities: ["saveResource", "shareResource"],
      },
      page,
      // The constructor stores callbacks; send accesses the ref only on WebView events.
      // eslint-disable-next-line react-hooks/refs
      {
        id: randomUUID,
        send,
        close: () => router.back(),
        expired: () => setExpired(true),
        failure: setFailure,
        changed: () => {
          chapter.refresh();
          void queries.invalidateQueries({
            predicate: (query) => query.queryKey.some((part) => part === projectId),
          });
        },
        resource: async (_action, value) => {
          // Resolve against authorized, current output data rather than trusting a bridge URL.
          const outputs = StoryOutputsSchema.parse(
            await api.get(
              `/app-story-agent/projects/${projectId}/chapters/${value.chapterId}/outputs${value.runId ? `?runId=${value.runId}` : ""}`,
              { service: "aurora", signal: controller.signal }
            )
          );
          const output = outputs.find(
            (item) =>
              item.id === value.resource.id &&
              item.status === "ready" &&
              item.url === value.resource.url &&
              item.kind === value.resource.kind
          );
          if (!output?.url)
            throw new Error("This media is no longer available. Refresh the project.");
          await saveOutput(
            { id: output.id, url: output.url, type: value.resource.kind },
            controller.signal,
            () => !controller.signal.aborted
          );
        },
      }
    );
    return { host, controller };
    // A retry starts a new page and protocol lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chapterId, locale, initialDraft, page, attempt]);
  useEffect(
    () => () => {
      bridge.controller.abort();
      bridge.host.dispose();
    },
    [bridge]
  );
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!bridge.host.isReady) setFailure(t("authedWeb.loadFailed"));
    }, 30000);
    return () => clearTimeout(timeout);
  }, [bridge, t]);
  useEffect(() => {
    bridge.host.state(focused && AppState.currentState === "active");
    const sub = AppState.addEventListener("change", (state) =>
      bridge.host.state(focused && state === "active")
    );
    const back = focused
      ? BackHandler.addEventListener("hardwareBackPress", () => {
          bridge.host.back();
          return true;
        })
      : undefined;
    return () => {
      sub.remove();
      back?.remove();
    };
  }, [bridge, focused]);
  const retry = () => {
    setFailure(null);
    setLoaded(false);
    currentAttempt.current += 1;
    setAttempt(currentAttempt.current);
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable accessibilityLabel={t("common.back")} onPress={() => bridge.host.back()}>
              <IconArrowLeft size={24} color={theme.text} />
            </Pressable>
          ),
        }}
      />
      {!cookie || expired ? (
        <View style={{ padding: 20, gap: 12 }}>
          <ThemedText>{t("authedWeb.sessionNeeded")}</ThemedText>
          <Pressable onPress={() => gate.openLogin()}>
            <ThemedText>{t("login.signIn")}</ThemedText>
          </Pressable>
        </View>
      ) : failure ? (
        <View style={{ padding: 20, gap: 12 }}>
          <ThemedText>{failure}</ThemedText>
          <Pressable onPress={retry}>
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </View>
      ) : (
        <>
          <WebView
            key={attempt}
            ref={web}
            source={{ uri: page, headers: { Cookie: cookie } }}
            originWhitelist={[origin]}
            incognito
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled={false}
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={(request) => trustedStoryPage(request.url, page)}
            onMessage={({ nativeEvent }) => bridge.host.receive(nativeEvent.data, nativeEvent.url)}
            onLoadEnd={() => {
              if (currentAttempt.current === attempt) setLoaded(true);
            }}
            onError={({ nativeEvent }) => {
              if (currentAttempt.current === attempt) setFailure(nativeEvent.description);
            }}
            onHttpError={({ nativeEvent }) => {
              if (currentAttempt.current === attempt && trustedStoryPage(nativeEvent.url, page)) {
                if (nativeEvent.statusCode === 401) setExpired(true);
                else if (nativeEvent.statusCode >= 400)
                  setFailure(`HTTP ${nativeEvent.statusCode}`);
              }
            }}
            style={{ flex: 1, backgroundColor: theme.background }}
          />
          {!loaded && (
            <ActivityIndicator
              style={{ position: "absolute", alignSelf: "center", top: 20 }}
              color={theme.text}
            />
          )}
        </>
      )}
    </View>
  );
}
