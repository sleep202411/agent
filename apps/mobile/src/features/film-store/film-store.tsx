import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import type { ExperienceGameSummary } from "@/data/interactive-film-api";
import { navigateToPlay } from "@/features/experience-player/lib/play-game-href";
import { buildExperiencePlayShareUrl } from "@/features/experience-player/lib/experience-share";
import { ExperienceShareButton } from "@/features/experience-player/components/experience-share-button";
import { createStorySavesApi } from "@/features/experience-player/api/story-saves-api";
import {
  fetchFilmStoreListing,
  restartPublishedFilm,
  type FilmStoreListing,
} from "./film-store-api";

type Props = { game: ExperienceGameSummary; close(): void };
export function FilmStore(props: Props) {
  const auth = useAuth(),
    active = useScreenActive(),
    locale = useLocale();
  if (!active || auth.status === "hydrating") return null;
  return (
    <Store
      key={JSON.stringify([props.game.gameId, props.game.currentVersion, auth.generation, locale])}
      {...props}
      generation={auth.generation}
      accountId={
        auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : ""
      }
    />
  );
}
function Store({
  game,
  close,
  generation,
  accountId,
}: Props & { generation: number; accountId: string }) {
  const t = useTranslations(),
    theme = useTheme(),
    locale = useLocale(),
    insets = useSafeAreaInsets(),
    router = useRouter();
  const [listing, setListing] = useState<FilmStoreListing | null>();
  const [listingError, setListingError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [hasSave, setHasSave] = useState(false),
    [readingSave, setReadingSave] = useState(!!accountId);
  const [attempt, setAttempt] = useState(0),
    [saveAttempt, setSaveAttempt] = useState(0);
  const [busy, setBusy] = useState(false),
    [restartError, setRestartError] = useState("");
  const life = useRef<AbortController | null>(null),
    writing = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    life.current = c;
    return () => {
      c.abort();
      life.current = null;
    };
  }, []);
  const current = () =>
    !!life.current && !life.current.signal.aborted && generation === getAuthGeneration();
  useEffect(() => {
    const c = new AbortController();
    void fetchFilmStoreListing(game.gameId, c.signal).then(
      (value) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setListing(value);
      },
      (error) => {
        if (!c.signal.aborted && generation === getAuthGeneration())
          setListingError(error instanceof Error ? error.message : String(error));
      }
    );
    return () => c.abort();
  }, [game.gameId, generation, attempt]);
  useEffect(() => {
    if (!accountId) return;
    const c = new AbortController();
    void createStorySavesApi()
      .latest(game.gameId, c.signal)
      .then(
        (value) => {
          if (!c.signal.aborted && generation === getAuthGeneration()) setHasSave(!!value);
        },
        (error) => {
          if (!c.signal.aborted && generation === getAuthGeneration())
            setSaveError(error instanceof Error ? error.message : String(error));
        }
      )
      .finally(() => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setReadingSave(false);
      });
    return () => c.abort();
  }, [accountId, game.gameId, generation, saveAttempt]);
  const play = async (restart: boolean) => {
    if (!current() || writing.current) return;
    writing.current = true;
    setBusy(true);
    setRestartError("");
    try {
      const chapterId =
        restart && accountId
          ? await restartPublishedFilm(accountId, generation, game.gameId, life.current!.signal)
          : undefined;
      if (!current()) return;
      close();
      navigateToPlay(
        router,
        {
          ...game,
          title: listing?.title ?? game.title,
          coverUrl: (listing ? listing.coverUrl : game.coverUrl) ?? undefined,
        },
        chapterId ? { chapterId } : undefined
      );
    } catch (e) {
      if (current()) setRestartError(e instanceof Error ? e.message : String(e));
    } finally {
      writing.current = false;
      if (current()) setBusy(false);
    }
  };
  const title = listing?.title ?? game.title;
  const cover = listing ? listing.coverUrl : game.coverUrl;
  const description = listing?.description ?? (listing === null ? game.subtitle : "");
  const media = listing
    ? [
        ...(listing.trailerUrl ? [{ kind: "video" as const, url: listing.trailerUrl }] : []),
        ...listing.screenshots.map((s) => ({ kind: "image" as const, url: s.url })),
      ]
    : [];
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!writing.current) close();
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
        }}
      >
        <View
          style={{ paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12 }}
        >
          <ThemedText type="subtitle" style={{ flex: 1 }}>
            {title}
          </ThemedText>
          <Action label={t("common.close")} disabled={busy} onPress={close} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          {listing === undefined && !listingError && (
            <ActivityIndicator accessibilityLabel={t("common.loading")} />
          )}
          {!!listingError && (
            <Failure
              message={listingError}
              retry={() => {
                setListingError("");
                setAttempt((v) => v + 1);
              }}
            />
          )}
          <StoreMedia
            key={JSON.stringify(media)}
            media={media.length ? media : cover ? [{ kind: "image", url: cover }] : []}
            title={title}
          />
          <ThemedText>
            {t("games.store.updatedAt")}:{" "}
            {Number.isFinite(Date.parse(game.updatedAt))
              ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                  new Date(game.updatedAt)
                )
              : "—"}
          </ThemedText>
          {!!listing?.developer && (
            <ThemedText>
              {t("games.store.developer")}: {listing.developer}
            </ThemedText>
          )}
          <ThemedText>{t("games.store.madeWith")}: FizzDragon</ThemedText>
          {!!listing?.tags.length && <ThemedText>{listing.tags.join(" · ")}</ThemedText>}
          {readingSave ? (
            <ActivityIndicator accessibilityLabel={t("common.loading")} />
          ) : (
            <Action
              label={t(hasSave ? "games.store.continuePlaying" : "games.store.playNow")}
              disabled={busy}
              onPress={() => void play(false)}
            />
          )}
          {hasSave && (
            <Action
              label={t("games.store.restartFromBeginning")}
              disabled={busy}
              onPress={() => void play(true)}
            />
          )}
          {busy && <ActivityIndicator accessibilityLabel={t("common.loading")} />}
          {!!saveError && (
            <Failure
              message={saveError}
              retry={() => {
                setSaveError("");
                setReadingSave(true);
                setSaveAttempt((v) => v + 1);
              }}
            />
          )}
          {!!restartError && <ThemedText accessibilityRole="alert">{restartError}</ThemedText>}
          <ExperienceShareButton
            label={t("play.share")}
            failedLabel={t("play.shareFailed")}
            shareUrl={buildExperiencePlayShareUrl({ gameId: game.gameId, locale })}
          />
          {!!description && (
            <View style={{ gap: 8 }}>
              <ThemedText type="smallBold">{t("games.store.aboutTitle")}</ThemedText>
              <ThemedText>{description}</ThemedText>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, justifyContent: "center", opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
function Failure({ message, retry }: { message: string; retry(): void }) {
  const t = useTranslations();
  return (
    <View>
      <ThemedText accessibilityRole="alert">{message}</ThemedText>
      <Action label={t("common.retry")} onPress={retry} />
    </View>
  );
}
type Media = { kind: "video" | "image"; url: string };
function StoreMedia({ media, title }: { media: Media[]; title: string }) {
  const t = useTranslations(),
    [selected, setSelected] = useState(0),
    [attempt, setAttempt] = useState(0);
  const item = media[selected];
  if (!item) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ height: 220 }}>
        <MediaItem
          key={`${selected}:${attempt}`}
          item={item}
          title={title}
          retry={() => setAttempt((v) => v + 1)}
        />
      </View>
      <ScrollView horizontal contentContainerStyle={{ gap: 16 }}>
        {media.map((m, i) => (
          <Action
            key={`${i}:${m.url}`}
            label={
              m.kind === "video"
                ? t("games.store.trailerLabel")
                : t("games.store.mediaCounter")
                    .replace("{index}", String(i + 1))
                    .replace("{total}", String(media.length))
            }
            onPress={() => setSelected(i)}
            disabled={selected === i}
          />
        ))}
      </ScrollView>
    </View>
  );
}
function MediaItem({ item, title, retry }: { item: Media; title: string; retry(): void }) {
  const t = useTranslations(),
    [failed, setFailed] = useState(false);
  if (item.kind === "video") return <FilmVideo url={item.url} retry={retry} />;
  return failed ? (
    <Failure message={t("games.store.mediaError")} retry={retry} />
  ) : (
    <Image
      source={{ uri: item.url }}
      accessibilityLabel={title}
      contentFit="contain"
      style={{ flex: 1 }}
      onError={() => setFailed(true)}
    />
  );
}
function FilmVideo({ url, retry }: { url: string; retry(): void }) {
  const t = useTranslations();
  const player = useVideoPlayer(url, (p) => {
    p.staysActiveInBackground = false;
  });
  const { status } = useEvent(player, "statusChange", { status: player.status });
  useEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        /* Native player already released. */
      }
    },
    [player]
  );
  return status === "error" ? (
    <Failure message={t("games.store.mediaError")} retry={retry} />
  ) : (
    <VideoView
      player={player}
      nativeControls
      allowsPictureInPicture={false}
      fullscreenOptions={{ enable: false }}
      contentFit="contain"
      style={{ flex: 1 }}
    />
  );
}
