import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { PosterImage } from "@/components/ui";
import { appEnv, resolveAssetUrl } from "@/config";
import { invalidateBrowse } from "@/data/browse-refresh";
import {
  loadAgentProjects,
  loadAgentWorkspaces,
  type StoryProjectSummary,
  type StudioWorkspace,
} from "@/features/agent/api/studio-projects-api";
import { useAppActiveChange } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import {
  createMobileCrew,
  crewCreationInput,
  crewCreationPending,
  fetchCrewCreationCanvas,
  fetchCrewCreationEligibility,
  fetchCrewsForCreationReview,
  type CrewCreationAttempt,
  type CrewCreationEligibility,
  type CrewCreationInput,
} from "./crew-creation-api";
import { pickCrewLogo } from "./crew-logo-upload";

type Canvas = Awaited<ReturnType<typeof fetchCrewCreationCanvas>>;
type Props = {
  userId: string;
  generation: number;
  onClose: () => void;
  onCreated: (id: string) => void;
  onCertification?: () => void;
};
const DEFAULT_LOGO = "https://static.fizzspace.cn/static/pc/crew_icon_default.png";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function CrewCreation(props: Props) {
  const focused = useIsFocused(),
    locale = useLocale();
  return focused && props.generation === getAuthGeneration() ? (
    <Session key={`${props.userId}:${props.generation}:${locale}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const op = useAuthFormOperation("crew-create", true);
  const controller = useRef<AbortController | null>(null);
  const picking = useRef(false);
  const requesting = useRef(false);
  const [storageBroken, setStorageBroken] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [eligibility, setEligibility] = useState<CrewCreationEligibility>();
  const [pending, setPending] = useState<CrewCreationAttempt | null>(null);
  const [error, setError] = useState<string>();
  const [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const [logo, setLogo] = useState(DEFAULT_LOGO);
  const [kind, setKind] = useState<"series" | "interactive_film">("series");
  const [mode, setMode] = useState<"create" | "link">("create");
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [canvas, setCanvas] = useState<Canvas>();
  const [pickingCanvas, setPickingCanvas] = useState(false);
  const [reviewingCrews, setReviewingCrews] = useState(false);
  const [review, setReview] = useState<CrewCreationInput>();
  const [clearing, setClearing] = useState(false);
  const current = () => props.generation === getAuthGeneration();
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void (async () => {
      try {
        let saved: CrewCreationAttempt | null;
        try {
          saved = crewCreationPending(props.userId, props.generation).read();
        } catch (e) {
          if (!c.signal.aborted) setStorageBroken(true);
          throw e;
        }
        if (!c.signal.aborted) setPending(saved);
        if (!saved) {
          const value = await fetchCrewCreationEligibility(props.generation, c.signal);
          if (!c.signal.aborted && props.generation === getAuthGeneration()) {
            setEligibility(value);
            setWorkspaceId(value.workspaces[0]?.id ?? "");
            setMode(value.workspaces.length ? "link" : "create");
          }
        }
      } catch (e) {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setError(message(e));
      } finally {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setLoaded(true);
      }
    })();
    return () => {
      c.abort();
      controller.current?.abort();
    };
  }, [props.userId, props.generation, revision]);
  useAppActiveChange((active) => {
    // System file pickers temporarily background the app; retain their explicitly requested operation.
    if (!active && !picking.current) controller.current?.abort();
    if (active && !picking.current && !loaded && controller.current?.signal.aborted)
      setRevision((value) => value + 1);
  });
  const run = <T,>(work: (signal: AbortSignal) => Promise<T>, done: (value: T) => void) => {
    if (!current() || requesting.current) return;
    requesting.current = true;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setError(undefined);
    void op
      .run(
        () => work(c.signal),
        done,
        (e) => {
          setError(message(e));
          try {
            setPending(crewCreationPending(props.userId, props.generation).read());
          } catch (storageError) {
            setStorageBroken(true);
            setError(message(storageError));
          }
        }
      )
      .finally(() => {
        requesting.current = false;
      });
  };
  const refresh = () => {
    if (op.busy || !current()) return;
    setLoaded(false);
    setEligibility(undefined);
    setError(undefined);
    setReview(undefined);
    setRevision((value) => value + 1);
  };
  const edit = (change: () => void) => {
    if (!op.busy && current()) {
      setReview(undefined);
      change();
    }
  };
  const field = (
    label: string,
    value: string,
    change: (value: string) => void,
    maxLength: number,
    multiline = false
  ) => (
    <View style={{ gap: 4 }}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        maxLength={maxLength}
        multiline={multiline}
        editable={!op.busy && !review}
        onChangeText={(value) => edit(() => change(value))}
        style={{
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          padding: 12,
          borderRadius: 8,
          minHeight: multiline ? 88 : 44,
        }}
      />
    </View>
  );
  const buttons = (
    <>
      <Button label={t("thread.refresh")} disabled={op.busy} onPress={refresh} />
      <Button label={t("common.cancel")} disabled={op.busy} onPress={props.onClose} />
    </>
  );
  if (reviewingCrews)
    return (
      <CreationReviewCrews
        userId={props.userId}
        generation={props.generation}
        onClose={() => setReviewingCrews(false)}
        onOpen={props.onCreated}
      />
    );
  if (pickingCanvas)
    return (
      <CanvasPicker
        generation={props.generation}
        onClose={() => setPickingCanvas(false)}
        onSelect={(value) => {
          setCanvas(value);
          setReview(undefined);
          setPickingCanvas(false);
        }}
      />
    );
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t("crewCreate.createDialogTitle")}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!loaded ? (
        <>
          <ActivityIndicator />
          {buttons}
        </>
      ) : pending || storageBroken ? (
        <>
          <ThemedText>
            {t(pending?.receipt ? "crewCreate.createSuccess" : "crewCreate.pending")}
          </ThemedText>
          <ThemedText type="smallBold">{pending?.input.name}</ThemedText>
          <ThemedText>{pending?.input.description}</ThemedText>
          <ThemedText>{pending?.startedAt}</ThemedText>
          {pending?.receipt && (
            <Button
              label={t("crewSetup.title")}
              onPress={() => {
                if (current()) {
                  invalidateBrowse();
                  props.onCreated(pending.receipt!.id);
                }
              }}
            />
          )}
          <Button label={t("crewCreate.myCrewsTitle")} onPress={() => setReviewingCrews(true)} />
          <ThemedText>{t("crewCreate.clearHelp")}</ThemedText>
          <Button
            label={t(clearing ? "crewCreate.confirmClear" : "crewCreate.clear")}
            onPress={() => {
              if (!current()) return;
              if (!clearing) {
                setClearing(true);
                return;
              }
              try {
                crewCreationPending(props.userId, props.generation).clear();
                setPending(null);
                setStorageBroken(false);
                setClearing(false);
                refresh();
              } catch (e) {
                setError(message(e));
              }
            }}
          />
          {buttons}
        </>
      ) : !eligibility ? (
        buttons
      ) : !eligibility.eligible ? (
        <>
          <ThemedText>{t("crewCreate.eligibility")}</ThemedText>
          {props.onCertification ? (
            <Button label={t("levelApplication.title")} onPress={props.onCertification} />
          ) : null}
          <ThemedText>{t("crewCreate.instructions")}</ThemedText>
          <Button
            label="business@fizzdragon.com"
            onPress={() => {
              void Linking.openURL(
                `mailto:business@fizzdragon.com?subject=${encodeURIComponent(t("crewCreate.subject"))}`
              ).catch((e) => setError(message(e)));
            }}
          />
          {buttons}
        </>
      ) : (
        <>
          <PosterImage
            uri={resolveAssetUrl(logo, appEnv.assets.bannerBaseUrl)}
            label={name || t("crewCreate.createLogoLabel")}
            radius={8}
            style={{ width: 72, height: 72 }}
          />
          <Button
            label={t("crewCreate.createLogoPickHint")}
            disabled={op.busy || !!review}
            onPress={() => {
              run(
                async (signal) => {
                  try {
                    picking.current = true;
                    return await pickCrewLogo(props.generation, signal);
                  } finally {
                    picking.current = false;
                  }
                },
                (path) => {
                  if (path) setLogo(path);
                }
              );
            }}
          />
          {field(t("crewCreate.createNameLabel"), name, setName, 128)}
          {field(t("crewCreate.createDescriptionLabel"), description, setDescription, 2000, true)}
          <ThemedText type="smallBold">{t("crewCreate.createProductionKindLabel")}</ThemedText>
          {(["series", "interactive_film"] as const).map((value) => (
            <Button
              key={value}
              label={t(
                value === "series"
                  ? "crewCreate.createProductionKindSeries"
                  : "crewCreate.createProductionKindFilm"
              )}
              selected={kind === value}
              disabled={op.busy || !!review}
              onPress={() =>
                edit(() => {
                  setKind(value);
                  setCanvas(undefined);
                })
              }
            />
          ))}
          <ThemedText type="smallBold">{t("crewCreate.createWorkspaceLabel")}</ThemedText>
          <ThemedText>{t("crewCreate.createWorkspaceHelp")}</ThemedText>
          {!!eligibility.workspaces.length && (
            <Button
              label={t("crewCreate.createWorkspaceLink")}
              selected={mode === "link"}
              disabled={op.busy || !!review}
              onPress={() => edit(() => setMode("link"))}
            />
          )}
          <Button
            label={t("crewCreate.createWorkspaceNew")}
            selected={mode === "create"}
            disabled={op.busy || !!review}
            onPress={() => edit(() => setMode("create"))}
          />
          {mode === "link"
            ? eligibility.workspaces.map((row) => (
                <Button
                  key={row.id}
                  label={row.name}
                  selected={workspaceId === row.id}
                  disabled={op.busy || !!review}
                  onPress={() => edit(() => setWorkspaceId(row.id))}
                />
              ))
            : field(
                t("crewCreate.createWorkspaceNamePlaceholder"),
                workspaceName,
                setWorkspaceName,
                120
              )}
          {kind === "interactive_film" && (
            <>
              <Button
                label={t("crewCreate.importFromCanvas")}
                disabled={op.busy || !!review}
                onPress={() => setPickingCanvas(true)}
              />
              <ThemedText>
                {canvas
                  ? `${canvas.title} · ${t("crewCreate.importSummary")
                      .replace("{nodes}", String(canvas.plotTree.nodes.length))
                      .replace(
                        "{shots}",
                        String(
                          Object.values(canvas.storyboardClipsByNode ?? {}).reduce(
                            (sum, list) => sum + list.length,
                            0
                          )
                        )
                      )}`
                  : t("crewCreate.importEmpty")}
              </ThemedText>
              {canvas && (
                <Button
                  label={t("crewCreate.importClearSelection")}
                  disabled={op.busy || !!review}
                  onPress={() => edit(() => setCanvas(undefined))}
                />
              )}
            </>
          )}
          {review && (
            <View style={{ gap: 6 }}>
              <ThemedText>{t("crewCreate.reviewHelp")}</ThemedText>
              <ThemedText>
                {t("crewCreate.createWorkspaceLabel")}:{" "}
                {review.createStudioWorkspace?.name ??
                  eligibility.workspaces.find((row) => row.id === review.studioWorkspaceId)?.name}
              </ThemedText>
            </View>
          )}
          <Button
            label={t(review ? "crewCreate.confirm" : "crewCreate.review")}
            disabled={op.busy}
            onPress={() => {
              if (!current() || op.busy) return;
              if (review) {
                run(
                  (signal) => createMobileCrew(review, props.userId, props.generation, signal),
                  () => {
                    setPending(crewCreationPending(props.userId, props.generation).read());
                    invalidateBrowse();
                  }
                );
                return;
              }
              try {
                setReview(
                  crewCreationInput.parse({
                    name,
                    description,
                    logo,
                    productionKind: kind,
                    productionTemplateLocale: locale,
                    ...(mode === "link"
                      ? { studioWorkspaceId: workspaceId }
                      : { createStudioWorkspace: { name: workspaceName.trim() || name.trim() } }),
                    ...(canvas && kind === "interactive_film"
                      ? {
                          plotTree: canvas.plotTree,
                          storyboardClipsByNode: canvas.storyboardClipsByNode,
                        }
                      : {}),
                  })
                );
                setError(undefined);
              } catch {
                setError(t("crewCreate.invalid"));
              }
            }}
          />
          {review && (
            <Button
              label={t("crewCreate.edit")}
              disabled={op.busy}
              onPress={() => setReview(undefined)}
            />
          )}
          {op.busy && <ActivityIndicator />}
          {buttons}
        </>
      )}
    </ScrollView>
  );
}

function CreationReviewCrews({
  userId,
  generation,
  onClose,
  onOpen,
}: {
  userId: string;
  generation: number;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations(),
    locale = useLocale();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchCrewsForCreationReview>>>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    void fetchCrewsForCreationReview(userId, generation, c.signal).then(
      (value) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setRows(value);
      },
      (e) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setError(message(e));
      }
    );
    return () => c.abort();
  }, [userId, generation, revision]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("crewCreate.myCrewsTitle")}</ThemedText>
      <ThemedText>{t("crewCreate.reviewCrewsHelp")}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!rows && !error && <ActivityIndicator />}
      {rows?.map((row) => (
        <View key={row.id} style={{ gap: 6 }}>
          <Button
            label={row.name}
            onPress={() => {
              if (generation === getAuthGeneration()) onOpen(row.id);
            }}
          />
          <ThemedText>{row.description}</ThemedText>
          <ThemedText>{new Date(row.createdAt).toLocaleString(locale)}</ThemedText>
        </View>
      ))}
      <Button
        label={t("thread.refresh")}
        onPress={() => {
          setRows(undefined);
          setError(undefined);
          setRevision((v) => v + 1);
        }}
      />
      <Button label={t("crewSetup.back")} onPress={onClose} />
    </ScrollView>
  );
}

function CanvasPicker({
  generation,
  onClose,
  onSelect,
}: {
  generation: number;
  onClose: () => void;
  onSelect: (canvas: Canvas) => void;
}) {
  const t = useTranslations();
  const [workspaces, setWorkspaces] = useState<StudioWorkspace[]>();
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    void loadAgentWorkspaces(c.signal).then(
      (rows) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setWorkspaces(rows);
      },
      (e) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setError(message(e));
      }
    );
    return () => c.abort();
  }, [generation, revision]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("crewCreate.importFromCanvas")}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!workspaces && !error && <ActivityIndicator />}
      {workspaces?.map((row) => (
        <Button
          key={row.id}
          label={row.name}
          selected={selected === row.id}
          onPress={() => setSelected(row.id)}
        />
      ))}
      {selected && (
        <CanvasProjects
          key={`${selected}:${revision}`}
          generation={generation}
          workspaceId={selected}
          onSelect={onSelect}
        />
      )}
      <Button
        label={t("thread.refresh")}
        onPress={() => {
          setSelected(undefined);
          setWorkspaces(undefined);
          setError(undefined);
          setRevision((v) => v + 1);
        }}
      />
      <Button label={t("common.cancel")} onPress={onClose} />
    </ScrollView>
  );
}
function CanvasProjects({
  generation,
  workspaceId,
  onSelect,
}: {
  generation: number;
  workspaceId: string;
  onSelect: (canvas: Canvas) => void;
}) {
  const t = useTranslations(),
    op = useAuthFormOperation(workspaceId, true);
  const [projects, setProjects] = useState<StoryProjectSummary[]>();
  const [error, setError] = useState<string>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void loadAgentProjects(c.signal, workspaceId).then(
      (result) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setProjects(result.projects);
      },
      (e) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setError(message(e));
      }
    );
    return () => {
      c.abort();
      controller.current?.abort();
    };
  }, [generation, workspaceId]);
  return (
    <View style={{ gap: 8 }}>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!projects && !error && <ActivityIndicator />}
      {projects?.length === 0 && <ThemedText>{t("crewCreate.importEmpty")}</ThemedText>}
      {projects?.map((project) => (
        <Button
          key={project.id}
          label={project.title}
          disabled={op.busy}
          onPress={() => {
            const c = new AbortController();
            controller.current = c;
            setError(undefined);
            void op.run(
              () => fetchCrewCreationCanvas(workspaceId, project.id, generation, c.signal),
              onSelect,
              (e) => setError(message(e))
            );
          }}
        />
      ))}
      {op.busy && <ActivityIndicator />}
    </View>
  );
}
function Button({
  label,
  onPress,
  selected,
  disabled,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.4 : 1,
        borderWidth: selected ? 1 : 0,
        borderColor: theme.text,
      }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
