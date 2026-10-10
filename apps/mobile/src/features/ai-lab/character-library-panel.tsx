import { EnrollmentConsent } from "./project-likeness-consent";
import { EnrollmentPanel } from "./enrollment-panel";
import { CharacterMediaPanel } from "./character-media-panel";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useRouter, useIsFocused } from "expo-router";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  loadAgentWorkspaces,
  canCreateStudioProject,
  type StudioWorkspace,
} from "@/features/agent/api/studio-projects-api";
import {
  loadCharacterLibrary,
  loadLibraryCharacter,
  characterLibraryBox,
  prepareLibraryCommand,
  prepareLikenessCreation,
  libraryFields,
  submitLibraryCommand,
  type LibraryCharacter,
  type LibraryDetail,
  type LibraryCommand,
} from "./character-library-api";
type Viewer = { userId: string; generation: number };
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
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
export function CharacterLibraryPanel(props: Viewer) {
  // Camera permission dialogs/backgrounding must not destroy the provider session.
  return useIsFocused() && props.generation === getAuthGeneration() ? (
    <Library key={`${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Library(props: Viewer) {
  const t = useTranslations(),
    router = useRouter();
  const [epoch, setEpoch] = useState(0),
    [workspaces, setWorkspaces] = useState<StudioWorkspace[]>(),
    [selected, setSelected] = useState<string>(),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void loadAgentWorkspaces(c.signal).then(
      (rows) => {
        if (!c.signal.aborted) {
          setWorkspaces(rows);
          setSelected((current) => current ?? rows.find((w) => w.isDefault)?.id ?? rows[0]?.id);
        }
      },
      (e) => {
        if (!c.signal.aborted) setError(String(e));
      }
    );
    return () => c.abort();
  }, [epoch]);
  const workspace = workspaces?.find((w) => w.id === selected);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
      <Button
        label={t("likenessGrants.title")}
        onPress={() => router.push("/likeness-authorizations")}
      />
      <Button
        label={t("likenessGrants.refresh")}
        onPress={() => {
          setWorkspaces(undefined);
          setError("");
          setEpoch((v) => v + 1);
        }}
      />
      {error ? (
        <ThemedText accessibilityRole="alert">{error}</ThemedText>
      ) : !workspaces ? (
        <ActivityIndicator />
      ) : null}
      {workspaces?.length === 0 ? (
        <ThemedText>{t("likenessGrants.noWorkspaces")}</ThemedText>
      ) : null}
      {workspaces && selected && !workspace ? (
        <ThemedText accessibilityRole="alert">{t("aiLab.workspaceUnavailable")}</ThemedText>
      ) : null}
      {workspaces?.map((w) => (
        <Button
          key={w.id}
          label={`${w.id === selected ? "✓ " : ""}${w.name}`}
          onPress={() => setSelected(w.id)}
        />
      ))}
      {workspace ? (
        <WorkspaceLibrary key={`${workspace.id}:${epoch}`} {...props} workspace={workspace} />
      ) : null}
    </ScrollView>
  );
}
function WorkspaceLibrary(props: Viewer & { workspace: StudioWorkspace }) {
  const [epoch, setEpoch] = useState(0);
  return <Session key={epoch} {...props} refresh={() => setEpoch((v) => v + 1)} />;
}
function Session({
  userId,
  generation,
  workspace,
  refresh,
}: Viewer & { workspace: StudioWorkspace; refresh: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`library:${workspace.id}`, true);
  const [enrolling, setEnrolling] = useState(false);
  const [creatingLikeness, setCreatingLikeness] = useState(false),
    [enrollmentConsent, setEnrollmentConsent] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [box] = useState(() => characterLibraryBox(userId, generation, workspace.id));
  const [initial] = useState(() => {
    try {
      return { pending: box.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [error, setError] = useState(initial.error),
    [rows, setRows] = useState<LibraryCharacter[]>(),
    [detail, setDetail] = useState<LibraryDetail>(),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState(false),
    [creating, setCreating] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [confirmation, setConfirmation] = useState<LibraryCommand>(),
    [clear, setClear] = useState(false),
    [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void loadCharacterLibrary(workspace.id, generation, c.signal).then(
      (r) => {
        if (!c.signal.aborted) setRows(r);
      },
      (e) => {
        if (!c.signal.aborted) setError(String(e));
      }
    );
    return () => c.abort();
  }, [workspace.id, generation]);
  const fail = (e: unknown) => {
    if (controller.current?.signal.aborted || generation !== getAuthGeneration()) return;
    setError(e instanceof Error ? e.message : String(e));
    setConfirmation(undefined);
    setEnrollmentConsent(false);
    try {
      setPending(box.read());
    } catch {
      /* Preserve corrupt record. */
    }
  };
  const open = (row: LibraryCharacter) => {
    setError("");
    setEditing(false);
    setCreating(false);
    setEnrollmentConsent(false);
    setConfirmation(undefined);
    setDetail(undefined);
    void op.run(
      () => loadLibraryCharacter(workspace.id, row.id, generation, controller.current!.signal),
      setDetail,
      fail
    );
  };
  const prepare = (action: "create" | "edit" | "remove") => {
    try {
      setError("");
      const base = { clientKey: uuid.v4(), workspaceId: workspace.id };
      setConfirmation(
        prepareLibraryCommand(
          action === "create"
            ? { ...base, action, fields: { name, description } }
            : action === "edit"
              ? { ...base, action, before: detail!, fields: { name, description } }
              : { ...base, action, before: detail! }
        )
      );
    } catch (e) {
      fail(e);
    }
  };
  const submit = (intent = confirmation) => {
    if (!intent || op.busy) return;
    void op.run(
      () => submitLibraryCommand(intent, userId, generation, controller.current!.signal),
      (receipt) => {
        setDetail(receipt ?? undefined);
        setConfirmation(undefined);
        setEditing(false);
        setCreating(false);
        setEnrollmentConsent(false);
        setMessage(
          t(
            intent.action === "create-likeness"
              ? "enrollmentCreate.created"
              : "characterLibrary.saved"
          )
        );
        setRows(undefined);
        void loadCharacterLibrary(workspace.id, generation, controller.current!.signal).then(
          (r) => {
            if (!controller.current?.signal.aborted) setRows(r);
          },
          fail
        );
      },
      fail
    );
  };
  const editable = canCreateStudioProject(workspace),
    disabled = op.busy || mediaBusy || enrolling || !!pending || !!initial.error;
  const field = (
    label: string,
    value: string,
    onChangeText: (s: string) => void,
    maxLength: number,
    multiline = false,
    readOnlySearch = false
  ) => (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={theme.textSecondary}
      value={value}
      onChangeText={onChangeText}
      editable={readOnlySearch || (!disabled && !confirmation && !enrollmentConsent)}
      maxLength={maxLength}
      multiline={multiline}
      style={{
        padding: 12,
        color: theme.text,
        backgroundColor: theme.backgroundElement,
        borderRadius: 8,
      }}
    />
  );
  return (
    <View style={{ gap: 10 }}>
      <Button label={t("likenessGrants.refresh")} onPress={refresh} disabled={op.busy} />
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      {message ? <ThemedText>{message}</ThemedText> : null}
      {pending ? (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("characterLibrary.pending")}</ThemedText>
          <ThemedText>
            {t(`characterLibrary.action.${pending.action}`)} ·{" "}
            {pending.action === "edit" || pending.action === "remove"
              ? pending.before.name
              : pending.fields.name}
          </ThemedText>
          <Button label={t("casting.clear")} disabled={op.busy} onPress={() => setClear(true)} />
          {clear ? (
            <>
              <ThemedText>{t("characterLibrary.clearHint")}</ThemedText>
              <Button
                label={t("casting.confirm")}
                onPress={() => {
                  try {
                    box.clear(pending.clientKey);
                    refresh();
                  } catch (e) {
                    fail(e);
                  }
                }}
              />
              <Button label={t("report.cancel")} onPress={() => setClear(false)} />
            </>
          ) : null}
        </View>
      ) : null}
      {field(t("characterLibrary.search"), search, setSearch, 120, false, true)}
      {!rows && !error ? <ActivityIndicator /> : null}
      {rows
        ?.filter((r) =>
          `${r.name} ${r.description ?? ""}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())
        )
        .map((r) => (
          <Button
            key={r.id}
            label={`${r.name} · ${t(`characterLibrary.kind.${r.kind}`)} · ${t(`characterLibrary.status.${r.status}`)}`}
            disabled={op.busy}
            onPress={() => open(r)}
          />
        ))}
      {rows?.length === 0 ? <ThemedText>{t("characterLibrary.empty")}</ThemedText> : null}
      {editable ? (
        <Button
          label={t("characterLibrary.create")}
          disabled={disabled}
          onPress={() => {
            setCreating(true);
            setCreatingLikeness(false);
            setEnrollmentConsent(false);
            setEditing(false);
            setDetail(undefined);
            setConfirmation(undefined);
            setName("");
            setDescription("");
            setError("");
            setMessage("");
          }}
        />
      ) : null}
      {editable && workspace.isDefault ? (
        <Button
          label={t("enrollmentCreate.title")}
          disabled={disabled}
          onPress={() => {
            setCreating(true);
            setCreatingLikeness(true);
            setEnrollmentConsent(false);
            setEditing(false);
            setDetail(undefined);
            setConfirmation(undefined);
            setName("");
            setDescription("");
            setError("");
            setMessage("");
          }}
        />
      ) : null}
      {detail ? (
        <View style={{ gap: 10 }}>
          <ThemedText type="smallBold">{detail.name}</ThemedText>
          <ThemedText>{detail.description}</ThemedText>
          <ThemedText>{t(`characterLibrary.status.${detail.status}`)}</ThemedText>
          <ThemedText>
            {t("characterLibrary.mediaCounts")
              .replace("{image}", String(detail.mediaCounts.image))
              .replace("{video}", String(detail.mediaCounts.video))
              .replace("{audio}", String(detail.mediaCounts.audio))}
          </ThemedText>
          {detail.kind === "real_person" &&
          ["draft", "pending_verification"].includes(detail.status) ? (
            enrolling ? (
              <EnrollmentPanel
                key={`enrollment:${detail.id}`}
                scope={{ workspaceId: workspace.id, characterId: detail.id, generation }}
                onClose={() => setEnrolling(false)}
                onDetail={(next) => {
                  setDetail(next);
                  setRows((rows) => rows?.map((row) => (row.id === next.id ? next : row)));
                  if (next.status === "active") setEnrolling(false);
                }}
              />
            ) : (
              <Button
                label={t("enrollment.title")}
                disabled={disabled || editing || !!confirmation}
                onPress={() => setEnrolling(true)}
              />
            )
          ) : null}
          <CharacterMediaPanel
            key={detail.id}
            workspaceId={workspace.id}
            characterId={detail.id}
            userId={userId}
            generation={generation}
            canEdit={
              editable &&
              !op.busy &&
              !pending &&
              !initial.error &&
              !editing &&
              !confirmation &&
              !enrolling
            }
            onBusy={setMediaBusy}
            onDetail={setDetail}
          />
          {editable && !["revoked", "disabled"].includes(detail.status) ? (
            <Button
              label={t("characterLibrary.edit")}
              disabled={disabled}
              onPress={() => {
                setName(detail.name);
                setDescription(detail.description ?? "");
                setEditing(true);
                setConfirmation(undefined);
              }}
            />
          ) : null}
          {editable &&
          (["owner", "admin"].includes(workspace.role ?? "") ||
            detail.createdByUserId === userId) ? (
            <Button
              label={t(
                detail.kind === "real_person" && detail.status !== "revoked"
                  ? "characterLibrary.revoke"
                  : "characterLibrary.remove"
              )}
              disabled={disabled}
              onPress={() => prepare("remove")}
            />
          ) : null}
        </View>
      ) : null}
      {creating || editing ? (
        <View style={{ gap: 8 }}>
          {field(t("characterLibrary.name"), name, setName, 64)}
          {field(t("characterLibrary.description"), description, setDescription, 200, true)}
          <Button
            label={t("characterLibrary.review")}
            disabled={disabled || !name.trim() || !!confirmation || enrollmentConsent}
            onPress={() => {
              if (creating && creatingLikeness) {
                try {
                  libraryFields.parse({ name, description });
                  setError("");
                  setEnrollmentConsent(true);
                } catch (e) {
                  fail(e);
                }
              } else prepare(creating ? "create" : "edit");
            }}
          />
          <Button
            label={t("report.cancel")}
            disabled={op.busy}
            onPress={() => {
              setCreating(false);
              setEnrollmentConsent(false);
              setEditing(false);
              setConfirmation(undefined);
            }}
          />
        </View>
      ) : null}
      {enrollmentConsent && creating && creatingLikeness ? (
        <EnrollmentConsent
          key={`${workspace.id}:${name}:${description}`}
          confirmLabel={t("enrollmentCreate.confirm")}
          busy={disabled}
          onConfirm={(read, adult) => {
            try {
              submit(
                prepareLikenessCreation(workspace.id, { name, description }, uuid.v4(), read, adult)
              );
            } catch (e) {
              fail(e);
            }
          }}
          onBack={() => setEnrollmentConsent(false)}
        />
      ) : null}
      {confirmation ? (
        <View style={{ gap: 8 }}>
          <ThemedText>
            {t(
              confirmation.action === "remove"
                ? confirmation.before.kind === "real_person" &&
                  confirmation.before.status !== "revoked"
                  ? "characterLibrary.revokeHint"
                  : "characterLibrary.removeHint"
                : "characterLibrary.confirmHint"
            )}
          </ThemedText>
          <ThemedText>
            {confirmation.action === "remove" ? confirmation.before.name : confirmation.fields.name}
          </ThemedText>
          <Button label={t("casting.confirm")} disabled={disabled} onPress={() => submit()} />
          <Button
            label={t("report.cancel")}
            disabled={op.busy}
            onPress={() => setConfirmation(undefined)}
          />
        </View>
      ) : null}
    </View>
  );
}
