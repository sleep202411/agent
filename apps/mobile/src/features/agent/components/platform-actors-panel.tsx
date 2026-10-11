import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { resolveExperienceAssetUrl } from "@/config/app-env";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import {
  listAiActors,
  requestActorUse,
  unlockAiActor,
  type AiActor,
} from "@/features/ai-lab/actors-api";
import { fetchPlatformSections } from "../api/platform-sections-api";
import {
  openPlatformCanvasDocument,
  readPlatformCanvasDocument,
  platformCanvasUpdatePending,
  type PlatformCanvasScope,
} from "../api/platform-canvas-document";
import { platformActorDraftStore, type PlatformActorDraft } from "../lib/platform-actor-draft";
import { canvasAppendPosition } from "../lib/story-canvas-create-draft";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCanvasEncoder } from "./story-canvas-encoder";

export function PlatformActorsPanel({
  scope,
  userId,
  close,
  saved,
}: {
  scope: PlatformCanvasScope;
  userId: string;
  close(): void;
  saved(): void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [listing, setListing] = useState<{
    page: number;
    revision: number;
    actors: AiActor[];
    hasMore: boolean;
    canEdit: boolean;
  }>();
  const [error, setError] = useState<string>();
  const stores = useMemo(
    () => ({
      draft: platformActorDraftStore(scope, userId),
      writer: platformCanvasUpdatePending(scope, userId),
    }),
    [scope, userId]
  );
  const [initial] = useState(() => {
    try {
      return { draft: stores.draft.read() };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [draft, setDraft] = useState(initial.draft);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [encoding, setEncoding] = useState<{
    loaded: CanvasLoaded;
    draft: PlatformActorDraft;
    position: { x: number; y: number };
  }>();
  const [discarding, setDiscarding] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const visible = listing?.page === page && listing.revision === revision ? listing : undefined;
  const current = () =>
    alive.current &&
    scope.generation === getAuthGeneration() &&
    !!operation.current &&
    !operation.current.signal.aborted;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      listAiActors(scope.workspaceId, page, scope.generation, controller.signal),
      fetchPlatformSections(
        scope.projectId,
        scope.workspaceId,
        scope.generation,
        controller.signal
      ),
    ]).then(
      ([actors, sections]) => {
        if (!controller.signal.aborted && scope.generation === getAuthGeneration())
          setListing({
            page,
            revision,
            actors: actors.items,
            hasMore: actors.hasMore,
            canEdit: sections.canEdit,
          });
      },
      (cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [scope, page, revision]);
  function fail(cause: unknown) {
    if (!current()) return;
    setError(cause instanceof Error ? cause.message : String(cause));
    setBusy(false);
    setReading(false);
    setEncoding(undefined);
    operation.current = null;
  }
  function finish(value: PlatformActorDraft) {
    if (!current()) return;
    stores.draft.acknowledge(value.clientKey);
    setDraft(null);
    setBusy(false);
    setReading(false);
    setEncoding(undefined);
    operation.current = null;
    saved();
  }
  async function submitPrepared(value: PlatformActorDraft) {
    if (!value.command || !operation.current) throw Error("Actor canvas update is missing.");
    await stores.writer.submit(value.command, operation.current.signal);
    if (current()) finish(value);
  }
  async function insert(value: PlatformActorDraft) {
    if (operation.current || !visible?.canEdit || initial.error) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      stores.draft.write(value);
      setDraft(value);
      // A prepared update must be replayed before any new actor-use request.
      if (value.command) {
        await submitPrepared(value);
        return;
      }
      await readPlatformCanvasDocument(scope, controller.signal, true);
      if (!current()) return;
      const other = stores.writer.read();
      if (other) throw Error(t("storyCanvas.pendingMismatch"));
      if (!value.receipt) {
        const receipt = await requestActorUse(
          {
            kind: "platform",
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            generation: scope.generation,
          },
          value,
          controller.signal
        );
        if (!current()) return;
        value = { ...value, receipt };
        stores.draft.write(value);
        setDraft(value);
      }
      setReading(true);
    } catch (cause) {
      fail(cause);
    }
  }
  async function unlock(actor: AiActor) {
    if (operation.current || !visible?.canEdit || draft || initial.error) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      await unlockAiActor(scope.workspaceId, actor.id, scope.generation, controller.signal);
      if (!current()) return;
      operation.current = null;
      setBusy(false);
      setRevision((n) => n + 1);
    } catch (cause) {
      fail(cause);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("platformActors.title")}</ThemedText>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Action label={t("common.back")} onPress={close} />
        <Action
          label={t("storyCanvas.refresh")}
          disabled={busy}
          onPress={() => {
            setError(undefined);
            setRevision((n) => n + 1);
          }}
        />
      </View>
      {(error || initial.error) && (
        <ThemedText accessibilityRole="alert">{initial.error ?? error}</ThemedText>
      )}
      {busy && <ActivityIndicator />}
      {draft && (
        <>
          <ThemedText type="small">{t("platformActors.pending")}</ThemedText>
          <Action
            label={t("common.retry")}
            onPress={() => void insert(draft)}
            disabled={busy || !visible?.canEdit}
          />
          {!draft.command && !busy && (
            <>
              {discarding && (
                <ThemedText type="small">{t("platformActors.discardHelp")}</ThemedText>
              )}
              <Action
                label={t(discarding ? "platformActors.confirmDiscard" : "storyCanvas.discard")}
                onPress={() => {
                  if (!discarding) {
                    setDiscarding(true);
                    return;
                  }
                  try {
                    stores.draft.discardUnprepared(draft.clientKey);
                    setDraft(null);
                    setDiscarding(false);
                    setError(undefined);
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                  }
                }}
              />
            </>
          )}
        </>
      )}
      {!visible && !error && <ActivityIndicator />}

      {visible && !visible.actors.length && (
        <ThemedText type="small">{t("platformActors.empty")}</ThemedText>
      )}
      {visible?.actors.map((actor) => (
        <View
          key={actor.id}
          style={{
            backgroundColor: theme.backgroundElement,
            padding: 12,
            borderRadius: 8,
            gap: 8,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <ActorPhoto key={actor.photoUrl} actor={actor} />
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold">{actor.name}</ThemedText>
            {visible.canEdit && (
              <Action
                label={t(actor.unlocked ? "platformActors.add" : "platformActors.unlock")}
                disabled={busy || !!draft || !!initial.error}
                onPress={() =>
                  actor.unlocked
                    ? void insert({ actorId: actor.id, clientKey: uuid.v4() })
                    : void unlock(actor)
                }
              />
            )}
          </View>
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Action
          label={t("platformActors.previous")}
          disabled={busy || page === 1}
          onPress={() => {
            setError(undefined);
            setPage((n) => n - 1);
          }}
        />
        <Action
          label={t("platformActors.next")}
          disabled={busy || !visible?.hasMore}
          onPress={() => {
            setError(undefined);
            setPage((n) => n + 1);
          }}
        />
      </View>
      {reading && draft?.receipt && (
        <StoryCanvasReader
          scope={scope}
          platform={{ scope, load: openPlatformCanvasDocument }}
          title={t("storyCanvas.title")}
          runtimeError={t("storyCanvas.loadError")}
          onResult={(loaded) => {
            if (current()) {
              try {
                const position = canvasAppendPosition(loaded.snapshot);
                setReading(false);
                setEncoding({ loaded, draft, position });
              } catch (cause) {
                fail(cause);
              }
            }
          }}
          onError={fail}
        />
      )}
      {encoding?.draft.receipt && (
        <StoryCanvasEncoder
          loaded={encoding.loaded}
          generation={scope.generation}
          title={t("platformActors.title")}
          runtimeError={t("storyCanvas.loadError")}
          edit={{
            type: "aiActor",
            nodeId: encoding.draft.clientKey,
            actor: encoding.draft.receipt,
            position: encoding.position,
          }}
          onResult={(update) => {
            if (!current()) return;
            try {
              if (!update) {
                finish(encoding.draft);
                return;
              }
              const prepared = {
                ...encoding.draft,
                command: { clientKey: encoding.draft.clientKey, yjsUpdateBase64: update },
              };
              stores.draft.write(prepared);
              setDraft(prepared);
              setEncoding(undefined);
              void submitPrepared(prepared).catch(fail);
            } catch (cause) {
              fail(cause);
            }
          }}
          onError={fail}
        />
      )}
    </ScrollView>
  );
}

const Action = ({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={{ padding: 10, opacity: disabled ? 0.5 : 1 }}
  >
    <ThemedText type="small">{label}</ThemedText>
  </Pressable>
);

function ActorPhoto({ actor }: { actor: AiActor }) {
  const [failed, setFailed] = useState(false);
  const t = useTranslations();
  return failed ? (
    <View style={{ width: 72, height: 72, justifyContent: "center", padding: 4 }}>
      <ThemedText type="small" style={{ fontSize: 11, lineHeight: 16 }}>
        {t("platformActors.photoUnavailable")}
      </ThemedText>
    </View>
  ) : (
    <Image
      source={{ uri: resolveExperienceAssetUrl(actor.photoUrl) }}
      style={{ width: 72, height: 72, borderRadius: 8 }}
      contentFit="cover"
      accessibilityLabel={actor.name}
      onError={() => setFailed(true)}
    />
  );
}
