import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { uuid } from "expo-modules-core";
import {
  IconArrowBarUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconPlayerStop,
} from "@tabler/icons-react-native";
import type { ExperienceCoreWorldModelRendererConfig } from "@repo/shared/experience-runtime";
import { ThemedText } from "@/components/themed-text";
import { useGatedScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { worldMessageSchema } from "../../../../world-player/protocol";
import { WorldRuntimeFrame } from "./world-runtime-frame";
import type { WorldRuntimeFrameHandle } from "./world-runtime-frame-types";
import { WorldRuntimeBridge } from "./world-runtime-bridge";
import { worldRuntimeHtml } from "./world-runtime-document";
import { createWorldTravelApi, type WorldTravelScope } from "./world-travel-api";
import {
  WorldTravelController,
  type WorldTravelControllerSnapshot,
} from "./world-travel-controller";

export interface ExperienceWorldRendererProps {
  scope: WorldTravelScope;
  config: ExperienceCoreWorldModelRendererConfig;
  onCompleted(): void;
  onError(error: unknown): void;
  onEndHandle(handle: (() => Promise<void>) | null): void;
}
const INITIAL: WorldTravelControllerSnapshot = {
  phase: "idle",
  streamStatus: "DISCONNECTED",
  travelId: null,
  firstFrameUrl: null,
  error: null,
};

/** One scene visit owns one stream. Remount on scope or renderer-instance change. */
export function ExperienceWorldRenderer(props: ExperienceWorldRendererProps) {
  const { scope, config } = props;
  return (
    <WorldSceneSession
      key={`${scope.generation}:${scope.workspaceId}:${scope.projectId}:${scope.worldId}:${config.maxExperienceSeconds}:${config.entryInstruction ?? ""}:${config.autoplay}`}
      {...props}
    />
  );
}
function WorldSceneSession({
  scope,
  config,
  onCompleted,
  onError,
  onEndHandle,
}: ExperienceWorldRendererProps) {
  const t = useTranslations();
  const presenting = useGatedScreenActive();
  const [sessionId] = useState(() => uuid.v4());
  const html = useMemo(() => worldRuntimeHtml(sessionId), [sessionId]);
  const frame = useRef<WorldRuntimeFrameHandle>(null);
  const bridge = useRef<WorldRuntimeBridge | null>(null);
  const controller = useRef<WorldTravelController | null>(null);
  const [snapshot, setSnapshot] = useState(INITIAL);
  const [requested, setRequested] = useState(config.autoplay);
  const [attached, setAttached] = useState(false);
  const [pauseRevision, setPauseRevision] = useState(0);
  const instructionSent = useRef(false),
    completed = useRef(false),
    syncing = useRef(false);
  const failed = useRef(false);
  const fail = useCallback(
    (error: unknown) => {
      failed.current = true;
      onError(error);
    },
    [onError]
  );
  const reportError = useEffectEvent(fail);
  const complete = useEffectEvent(onCompleted);
  const { projectId, workspaceId, worldId, generation } = scope;

  useLayoutEffect(() => {
    let mounted = true;
    const transport = new WorldRuntimeBridge(sessionId, (message) => {
      if (!frame.current) throw new Error("World playback surface is not mounted.");
      frame.current.send(message);
    });
    bridge.current = transport;
    let travel: WorldTravelController;
    try {
      if (projectId !== config.projectId || worldId !== config.worldId)
        throw new Error("World playback project scope mismatch.");
      travel = new WorldTravelController({
        api: createWorldTravelApi({ projectId, workspaceId, worldId, generation }),
        maxExperienceSeconds: config.maxExperienceSeconds,
        runtimeFactory: (input) => transport.initialize(input),
        onChange: (state) => {
          if (mounted) setSnapshot(state);
        },
      });
    } catch (error) {
      transport.detach();
      reportError(error);
      return;
    }
    controller.current = travel;
    return () => {
      mounted = false;
      if (controller.current === travel) controller.current = null;
      if (bridge.current === transport) bridge.current = null;
      // The departing document closes its local SDK on pagehide. Reject pending
      // RPCs now so server cleanup does not wait on a removed surface's timeout.
      transport.detach();
      void travel.dispose().catch(() => undefined);
    };
  }, [
    sessionId,
    projectId,
    workspaceId,
    worldId,
    generation,
    config.projectId,
    config.worldId,
    config.maxExperienceSeconds,
  ]);

  useEffect(() => {
    if (!requested || !presenting || !attached || snapshot.phase !== "idle") return;
    const travel = controller.current;
    // Defer the paid operation until mount survives StrictMode's effect replay.
    const timer = setTimeout(() => {
      if (controller.current === travel)
        void travel?.start().catch((error) => {
          if (controller.current === travel) reportError(error);
        });
    }, 0);
    return () => clearTimeout(timer);
  }, [requested, presenting, attached, snapshot.phase]);

  useEffect(() => {
    const travel = controller.current;
    if (!travel || syncing.current) return;
    const phase = travel.state.phase;
    const action =
      !presenting && phase === "running"
        ? () => travel.pause()
        : presenting && phase === "paused"
          ? () => travel.resume()
          : null;
    if (!action) return;
    syncing.current = true;
    void action().then(
      () => {
        syncing.current = false;
        if (controller.current === travel) setPauseRevision((revision) => revision + 1);
      },
      (error) => {
        syncing.current = false;
        if (controller.current === travel) reportError(error);
      }
    );
  }, [presenting, snapshot.phase, pauseRevision]);

  useEffect(() => {
    if (snapshot.phase === "failed" && snapshot.error) reportError(snapshot.error);
    if (snapshot.phase === "ended" && !completed.current && !failed.current) {
      completed.current = true;
      complete();
    }
    if (
      presenting &&
      snapshot.phase === "running" &&
      config.entryInstruction &&
      !instructionSent.current
    ) {
      instructionSent.current = true;
      const travel = controller.current;
      void travel?.instruct(config.entryInstruction).catch((error) => {
        if (controller.current === travel) reportError(error);
      });
    }
  }, [snapshot.phase, snapshot.error, config.entryInstruction, presenting]);

  const end = useCallback(async () => {
    await controller.current?.end();
  }, []);
  useEffect(() => {
    onEndHandle(end);
    return () => onEndHandle(null);
  }, [end, onEndHandle]);
  const run = (action: () => Promise<unknown> | undefined) => {
    const travel = controller.current;
    void Promise.resolve()
      .then(() => {
        if (controller.current === travel) return action();
      })
      .catch((error) => {
        if (controller.current === travel) fail(error);
      });
  };
  const running = presenting && snapshot.phase === "running";
  const loading = requested && (snapshot.phase === "idle" || snapshot.phase === "starting");
  return (
    <View style={styles.surface}>
      <WorldRuntimeFrame
        html={html}
        title={t("play.world.stream")}
        ref={frame}
        onMessage={(raw) => {
          if (!bridge.current) return;
          bridge.current.receive(raw);
          // Readiness belongs to the bridge, not an unvalidated message payload.
          if (typeof raw === "string" && raw.length <= 100000) {
            try {
              const message = worldMessageSchema.safeParse(JSON.parse(raw));
              if (
                message.success &&
                message.data.sessionId === sessionId &&
                message.data.type === "ready"
              )
                setAttached(true);
            } catch {
              /* Bridge ignores malformed transport messages. */
            }
          }
        }}
        onError={(error) => {
          bridge.current?.detach(error);
          fail(error);
          void controller.current?.dispose().catch(() => undefined);
        }}
      />
      {loading ? (
        <View pointerEvents="none" style={styles.loading}>
          <ActivityIndicator color="#FFFFFF" />
          <ThemedText type="small" style={styles.text}>
            {t("play.world.connecting")}
          </ThemedText>
        </View>
      ) : null}
      {!requested ? (
        <View style={styles.loading}>
          <Pressable
            accessibilityRole="button"
            disabled={!presenting}
            onPress={() => setRequested(true)}
            style={styles.button}
          >
            <ThemedText type="small" style={styles.text}>
              {t("play.start")}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.controls} pointerEvents="box-none">
        <View style={styles.pad}>
          {(
            [
              [["forward", IconArrowUp]],
              [
                ["left", IconArrowLeft],
                ["backward", IconArrowDown],
                ["right", IconArrowRight],
              ],
            ] as const
          ).map((row, index) => (
            <View key={index} style={styles.padRow}>
              {row.map(([movement, Icon]) => (
                <Pressable
                  key={movement}
                  accessibilityRole="button"
                  accessibilityLabel={t(`play.world.${movement}`)}
                  accessibilityState={{ disabled: !running }}
                  disabled={!running}
                  onPress={() => run(() => controller.current?.move({ movement }))}
                  style={[styles.button, !running && styles.disabled]}
                >
                  <Icon size={20} color="#FFFFFF" />
                </Pressable>
              ))}
            </View>
          ))}
        </View>
        <View style={styles.padRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("play.world.jump")}
            accessibilityState={{ disabled: !running }}
            disabled={!running}
            onPress={() => run(() => controller.current?.move({ interaction: "jump" }))}
            style={[styles.button, !running && styles.disabled]}
          >
            <IconArrowBarUp size={20} color="#FFFFFF" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("play.world.finish")}
            accessibilityState={{ disabled: !running }}
            disabled={!running}
            onPress={() => run(end)}
            style={[styles.button, !running && styles.disabled]}
          >
            <IconPlayerStop size={20} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  surface: { flex: 1, backgroundColor: "#000000" },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  text: { color: "#FFFFFF" },
  controls: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 16,
  },
  pad: { gap: 4 },
  padRow: { flexDirection: "row", justifyContent: "center", gap: 4 },
  button: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  disabled: { opacity: 0.35 },
});
