import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { appEnv } from "@/config/app-env";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { PlatformProjectSections } from "./platform-project-sections";
import { PlatformProjectCover } from "./platform-project-cover";
import { uploadPlatformProjectCover } from "./api/platform-project-cover-upload";
import { StudioMembers } from "./studio-members";
import { StudioInvites } from "./studio-invites";
import { studioInviteTargetUrl } from "./api/studio-invite-accept-api";
import { canCreateStudioProject, type StudioWorkspace } from "./api/studio-projects-api";
import {
  readPlatformProject,
  updatePlatformProjectCover,
  archivePlatformProject,
  canEditPlatformProject,
  createPlatformProject,
  loadPlatformProjects,
  platformProjectDraft,
  PlatformProjectWriteError,
  updatePlatformProject,
  type PlatformProject,
} from "./api/platform-projects-api";
type Props = { workspace: StudioWorkspace; generation: number; onClose: () => void };
export function PlatformProjectDirectory(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.workspace.id}:${props.generation}`} {...props} />
  ) : null;
}
function Session({ workspace, generation, onClose }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [revision, setRevision] = useState(0);
  const [collaboration, setCollaboration] = useState<{
    project: PlatformProject;
    kind: "members" | "invites" | "sections";
  }>();
  const [loaded, setLoaded] = useState<{
    revision: number;
    rows?: PlatformProject[];
    error?: string;
  }>();
  const [form, setForm] = useState<{ project?: PlatformProject }>();
  const [name, setName] = useState(""),
    [description, setDescription] = useState("");
  const [detailRecovery, setDetailRecovery] = useState(false);
  const [detailReview, setDetailReview] = useState<PlatformProject>();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [uncertainAt, setUncertainAt] = useState<number>();
  const lock = useRef(false),
    alive = useRef(true),
    pending = useRef<AbortController | null>(null);
  const current = () => alive.current && generation === getAuthGeneration();
  if (!active && detailReview) setDetailReview(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active) pending.current?.abort();
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    void loadPlatformProjects(workspace.id, generation, c.signal).then(
      (rows) => {
        if (!c.signal.aborted) setLoaded({ revision, rows });
      },
      (e) => {
        if (!c.signal.aborted)
          setLoaded({ revision, error: e instanceof Error ? e.message : String(e) });
      }
    );
    return () => c.abort();
  }, [workspace.id, generation, revision, active]);
  useEffect(() => {
    if (!active || collaboration) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!lock.current) {
        if (form) {
          setForm(undefined);
          setDetailReview(undefined);
          setDetailRecovery(false);
        } else onClose();
      }
      return true;
    });
    return () => sub.remove();
  }, [active, collaboration, form, onClose]);
  const visible = loaded?.revision === revision ? loaded : undefined;
  const locked = busy || uncertainAt !== undefined || detailRecovery;
  const editable = form?.project
    ? canEditPlatformProject(form.project)
    : canCreateStudioProject(workspace);
  function edit(project?: PlatformProject) {
    if (locked || !active || !current()) return;
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setConfirmation("");
    setDetailReview(undefined);
    setDetailRecovery(false);
    setError(undefined);
    setForm({ project });
  }
  async function save(archive: boolean) {
    if (!form || lock.current || locked || !active || !current()) return;
    if (
      archive
        ? form.project?.role !== "owner" || confirmation !== form.project.name
        : !editable || !platformProjectDraft.safeParse({ name, description }).success
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    const c = new AbortController();
    pending.current = c;
    try {
      if (archive) await archivePlatformProject(form.project!, confirmation, generation, c.signal);
      else if (form.project)
        await updatePlatformProject(form.project, { name, description }, generation, c.signal);
      else
        await createPlatformProject(
          workspace.id,
          { name, description },
          t("studioProjects.firstSection"),
          generation,
          c.signal
        );
      if (current()) {
        setForm(undefined);
        setRevision((v) => v + 1);
      }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof PlatformProjectWriteError) setUncertainAt(revision);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  function applyProject(project: PlatformProject) {
    setForm({ project });
    setLoaded((previous) =>
      previous?.rows
        ? {
            ...previous,
            rows: previous.rows.map((row) => (row.id === project.id ? project : row)),
          }
        : previous
    );
  }
  async function cover(action: "upload" | "remove" | "refresh") {
    if (
      !form?.project ||
      lock.current ||
      busy ||
      !active ||
      !current() ||
      (action !== "refresh" && locked)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    const c = new AbortController();
    pending.current = c;
    try {
      if (action === "refresh") {
        setDetailReview(undefined);
        setDetailRecovery(true);
        const project = await readPlatformProject(
          form.project.id,
          workspace.id,
          generation,
          c.signal
        );
        if (current() && !c.signal.aborted) setDetailReview(project);
      } else {
        const assetId =
          action === "remove"
            ? null
            : await uploadPlatformProjectCover(form.project, generation, c.signal);
        if (action === "upload" && !assetId) return;
        const project = await updatePlatformProjectCover(
          form.project,
          assetId,
          generation,
          c.signal
        );
        if (current()) applyProject(project);
      }
    } catch (e) {
      if (current()) {
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof PlatformProjectWriteError) setUncertainAt(revision);
      }
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  }
  const inputStyle = {
    color: theme.text,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.backgroundElement,
  };
  if (!active && !collaboration) return null;
  if (collaboration) {
    const scope = {
      kind: "project" as const,
      id: collaboration.project.id,
      name: collaboration.project.name,
    };
    const close = () => {
      setCollaboration(undefined);
      setRevision((v) => v + 1);
    };
    if (collaboration.kind === "sections")
      return (
        <PlatformProjectSections
          projectId={scope.id}
          workspaceId={workspace.id}
          name={scope.name}
          generation={generation}
          onClose={close}
        />
      );
    return collaboration.kind === "members" ? (
      <StudioMembers scope={scope} generation={generation} onClose={close} />
    ) : (
      <StudioInvites scope={scope} generation={generation} onClose={close} />
    );
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">
        {t("studioProjects.title")} · {workspace.name}
      </ThemedText>
      <ThemedText type="small">{t("studioProjects.help")}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {uncertainAt !== undefined && (
        <>
          <ThemedText>{t("studioProjects.uncertain")}</ThemedText>
          {!form && visible?.rows && revision > uncertainAt && (
            <Action
              label={t("studioProjects.reviewed")}
              disabled={busy}
              onPress={() => {
                setUncertainAt(undefined);
                setError(undefined);
              }}
            />
          )}
        </>
      )}
      {form && detailRecovery && !detailReview && !busy && !error && (
        <ThemedText type="small">{t("studioProjects.refreshRequired")}</ThemedText>
      )}
      {form && detailReview && (
        <View style={{ gap: 8 }}>
          <ThemedText type="smallBold">{detailReview.name}</ThemedText>
          <ThemedText type="small">{detailReview.description || "—"}</ThemedText>
          <PlatformProjectCover project={detailReview} />
          <Action
            label={t("studioProjects.reviewed")}
            disabled={busy}
            onPress={() => {
              if (!active || !current() || lock.current) return;
              applyProject(detailReview);
              setDetailReview(undefined);
              setDetailRecovery(false);
              setUncertainAt(undefined);
              setConfirmation("");
            }}
          />
        </View>
      )}
      {form ? (
        <>
          {form.project && (
            <>
              <ThemedText type="smallBold">{t("studioProjects.cover")}</ThemedText>
              <PlatformProjectCover key={form.project.id} project={form.project} />
              {editable && (
                <Action
                  label={t("studioProjects.uploadCover")}
                  disabled={locked}
                  onPress={() => void cover("upload")}
                />
              )}
              {editable && form.project.coverAssetId && (
                <Action
                  label={t("studioProjects.removeCover")}
                  disabled={locked}
                  onPress={() => void cover("remove")}
                />
              )}
              <Action
                label={t("studioProjects.refreshDetails")}
                disabled={busy}
                onPress={() => void cover("refresh")}
              />
            </>
          )}
          <ThemedText>{t("studioProjects.name")}</ThemedText>
          <TextInput
            accessibilityLabel={t("studioProjects.name")}
            value={name}
            onChangeText={setName}
            maxLength={160}
            editable={editable && !locked}
            style={inputStyle}
          />
          <ThemedText>{t("studioProjects.description")}</ThemedText>
          <TextInput
            accessibilityLabel={t("studioProjects.description")}
            value={description}
            onChangeText={setDescription}
            maxLength={5000}
            multiline
            editable={editable && !locked}
            style={inputStyle}
          />
          {editable && (
            <Action
              label={t(form.project ? "studioProjects.save" : "studioProjects.create")}
              disabled={locked || !platformProjectDraft.safeParse({ name, description }).success}
              onPress={() => void save(false)}
            />
          )}
          {form.project?.role === "owner" && (
            <>
              <ThemedText>
                {t("studioProjects.archiveHelp")} · {form.project.name}
              </ThemedText>
              <TextInput
                accessibilityLabel={t("studioProjects.confirmName")}
                value={confirmation}
                onChangeText={setConfirmation}
                editable={!locked}
                style={inputStyle}
              />
              <Action
                label={t("studioProjects.archive")}
                disabled={locked || confirmation !== form.project.name}
                onPress={() => void save(true)}
              />
            </>
          )}
          <Action
            label={t("studioProjects.discard")}
            disabled={busy}
            onPress={() => {
              setForm(undefined);
              setDetailReview(undefined);
              setDetailRecovery(false);
            }}
          />
        </>
      ) : (
        <>
          {!visible && <ActivityIndicator />}
          {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
          {visible?.rows?.length === 0 && <ThemedText>{t("studioProjects.empty")}</ThemedText>}
          {visible?.rows && canCreateStudioProject(workspace) && (
            <Action label={t("studioProjects.create")} disabled={locked} onPress={() => edit()} />
          )}
          {visible?.rows?.map((project) => (
            <View
              key={project.id}
              style={{
                padding: 12,
                gap: 8,
                borderRadius: 8,
                backgroundColor: theme.backgroundElement,
              }}
            >
              <ThemedText type="smallBold">{project.name}</ThemedText>
              <ThemedText type="small">{project.description || "—"}</ThemedText>
              <ThemedText type="small">{t(`studioProjects.${project.visibility}`)}</ThemedText>
              <Action
                label={t("studioProjects.details")}
                disabled={locked}
                onPress={() => edit(project)}
              />
              <Action
                label={t("studioChapters.title")}
                disabled={locked}
                onPress={() => {
                  if (!lock.current && current()) setCollaboration({ project, kind: "sections" });
                }}
              />
              <Action
                label={t("studioMembers.title")}
                disabled={locked}
                onPress={() => {
                  if (!lock.current && current()) setCollaboration({ project, kind: "members" });
                }}
              />
              {["owner", "admin"].includes(project.role ?? "") && (
                <Action
                  label={t("studioInvites.title")}
                  disabled={locked}
                  onPress={() => {
                    if (!lock.current && current()) setCollaboration({ project, kind: "invites" });
                  }}
                />
              )}
              <Action
                label={t("studioProjects.open")}
                disabled={busy}
                onPress={() => {
                  if (!active || !current() || lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  void Linking.openURL(
                    studioInviteTargetUrl(
                      {
                        scope: "project",
                        projectId: project.id,
                        workspaceId: workspace.id,
                        targetName: project.name,
                      },
                      appEnv.appRegion
                    )
                  )
                    .catch((e) => {
                      if (current()) setError(e instanceof Error ? e.message : String(e));
                    })
                    .finally(() => {
                      lock.current = false;
                      if (current()) setBusy(false);
                    });
                }}
              />
            </View>
          ))}
        </>
      )}
      {!form && (
        <Action
          label={t("studioProjects.reload")}
          disabled={busy}
          onPress={() => {
            setForm(undefined);
            setDetailReview(undefined);
            setDetailRecovery(false);
            setRevision((v) => v + 1);
          }}
        />
      )}
      {busy && <ActivityIndicator />}
      <Action label={t("common.back")} disabled={busy} onPress={onClose} />
    </ScrollView>
  );
}
function Action({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
