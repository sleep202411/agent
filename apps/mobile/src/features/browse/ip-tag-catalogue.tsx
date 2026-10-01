import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Share, TextInput, View } from "react-native";
import { IpGridCard } from "@/components/ip-grid";
import { ThemedText } from "@/components/themed-text";
import { EmptyState } from "@/components/ui";
import { webBaseUrl } from "@/config";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { fetchIpTagPage, type IpTagPage } from "@/data/ip-api";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";

export function IpTagCatalogue({ code }: { code: string }) {
  const locale = useLocale();
  const [shareError, setShareError] = useState<string>();
  const [sharing, setSharing] = useState(false);
  const shareOperation = useRef<object | null>(null);
  const t = useTranslations(),
    theme = useTheme();
  const [page, setPage] = useState<IpTagPage>();
  const [error, setError] = useState<string>();
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    void fetchIpTagPage(code, { signal: controller.signal })
      .then(
        (result) => {
          if (!controller.signal.aborted) setPage(result);
        },
        (failure) => {
          if (controller.signal.aborted) return;
          if (failure?.status === 404) setMissing(true);
          else
            setError((failure instanceof Error && failure.message) || t("ips.loadErrorFallback"));
        }
      )
      .finally(() => {
        if (!controller.signal.aborted) {
          operation.current = null;
          setBusy(false);
        }
      });
    return () => {
      shareOperation.current = null;
      controller.abort();
      operation.current?.abort();
      operation.current = null;
    };
  }, [code, revision, t]);
  const refresh = () => {
    shareOperation.current = null;
    setSharing(false);
    setShareError(undefined);
    operation.current?.abort();
    operation.current = null;
    setPage(undefined);
    setError(undefined);
    setMissing(false);
    setBusy(true);
    setRevision((value) => value + 1);
  };
  const loadMore = async () => {
    if (!page?.nextCursor || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const next = await fetchIpTagPage(code, {
        cursor: page.nextCursor,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const seen = new Set(page.items.map((item) => item.id));
      if (next.nextCursor && seen.has(next.nextCursor))
        throw new Error("Invalid activity cursor. Please retry.");
      setPage({
        ...next,
        total: page.total,
        items: [...page.items, ...next.items.filter((item) => !seen.has(item.id))],
      });
    } catch (failure) {
      if (!controller.signal.aborted)
        setError((failure instanceof Error && failure.message) || t("ips.loadErrorFallback"));
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  };
  const share = async () => {
    if (!page || shareOperation.current) return;
    const token = {};
    shareOperation.current = token;
    setSharing(true);
    setShareError(undefined);
    const url = `${webBaseUrl.replace(/\/$/, "")}/${locale}/tags/${encodeURIComponent(code)}`;
    try {
      await Share.share({ message: url, url });
    } catch (failure) {
      if (shareOperation.current === token)
        setShareError((failure instanceof Error && failure.message) || t("play.shareFailed"));
    } finally {
      if (shareOperation.current === token) {
        shareOperation.current = null;
        setSharing(false);
      }
    }
  };
  const needle = query.trim().toLocaleLowerCase();
  const rows = (page?.items ?? []).filter((item) =>
    [item.title, item.tagline, item.synopsis, ...item.genres, ...item.typeTags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle)
  );
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      numColumns={2}
      contentContainerStyle={{
        width: "100%",
        maxWidth: MaxContentWidth,
        alignSelf: "center",
        padding: Spacing.four,
        gap: Spacing.three,
      }}
      columnWrapperStyle={{ gap: Spacing.three }}
      ListHeaderComponent={
        <View style={{ gap: Spacing.three }}>
          <ThemedText type="subtitle">{page?.term.label || code || t("ipTag.title")}</ThemedText>
          {page?.term.description ? <ThemedText>{page.term.description}</ThemedText> : null}
          {page?.total !== null && page?.total !== undefined ? (
            <ThemedText type="small">
              {t("ipTag.entries")}: {page.total}
            </ThemedText>
          ) : null}
          <TextInput
            accessibilityLabel={t("ipTag.search")}
            placeholder={t("ipTag.search")}
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            style={{
              color: theme.text,
              backgroundColor: theme.backgroundElement,
              borderRadius: 8,
              padding: Spacing.three,
            }}
          />
          <Pressable accessibilityRole="button" disabled={busy} onPress={refresh}>
            <ThemedText>{t("thread.refresh")}</ThemedText>
          </Pressable>
          {page ? (
            <Pressable accessibilityRole="button" disabled={sharing} onPress={() => void share()}>
              <ThemedText>{t("play.share")}</ThemedText>
            </Pressable>
          ) : null}
          {shareError ? <ThemedText accessibilityRole="alert">{shareError}</ThemedText> : null}
          {missing ? <ThemedText>{t("ipTag.missing")}</ThemedText> : null}
          {error ? (
            <EmptyState
              title={t("ips.loadErrorTitle")}
              detail={error}
              action={{
                label: t("common.retry"),
                onPress: () => {
                  if (page) void loadMore();
                  else refresh();
                },
              }}
            />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !busy && !error && !missing ? (
          <ThemedText>
            {page?.nextCursor && needle ? t("ipTag.searchMore") : t("ipTag.empty")}
          </ThemedText>
        ) : null
      }
      ListFooterComponent={
        <View style={{ gap: Spacing.three }}>
          {busy ? <ActivityIndicator color={theme.textSecondary} /> : null}
          {page?.nextCursor && !busy && !error ? (
            <Pressable accessibilityRole="button" onPress={() => void loadMore()}>
              <ThemedText>{t("ips.loadMore")}</ThemedText>
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ flex: 1, minWidth: 0 }}>
          <IpGridCard ip={item} />
        </View>
      )}
    />
  );
}
