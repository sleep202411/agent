import { LikenessGrantCreatePanel } from "./likeness-grant-create-panel";
import { LikenessOutputsPanel } from "./likeness-outputs-panel";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  loadAgentWorkspaces,
  type StudioWorkspace,
} from "@/features/agent/api/studio-projects-api";
import {
  loadLikenesses,
  loadLikenessGrants,
  likenessWithdrawalBox,
  prepareLikenessWithdrawal,
  withdrawLikenessGrant,
  reconcileLikenessWithdrawal,
  type Likeness,
  type LikenessGrant,
} from "./likeness-grants-api";
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
export function LikenessGrantsPanel(props: Viewer) {
  return useScreenActive() && props.generation === getAuthGeneration() ? (
    <Library key={`${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Library(props: Viewer) {
  const t = useTranslations();
  const [epoch, setEpoch] = useState(0);
  return <LibrarySession key={epoch} {...props} retry={() => setEpoch((v) => v + 1)} t={t} />;
}
function LibrarySession(
  props: Viewer & { retry: () => void; t: ReturnType<typeof useTranslations> }
) {
  const { t } = props;
  const [workspaces, setWorkspaces] = useState<StudioWorkspace[]>(),
    [workspace, setWorkspace] = useState<string>(),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void loadAgentWorkspaces(c.signal).then(
      (rows) => {
        if (!c.signal.aborted) {
          setWorkspaces(rows);
          setWorkspace(rows.find((r) => r.isDefault)?.id);
        }
      },
      (e) => {
        if (!c.signal.aborted) setError(String(e));
      }
    );
    return () => c.abort();
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="small">{t("likenessGrants.hint")}</ThemedText>
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Button
            label={t(error ? "common.retry" : "likenessGrants.refresh")}
            onPress={props.retry}
          />
        </>
      ) : !workspaces ? (
        <ActivityIndicator />
      ) : null}
      {workspaces?.map((w) => (
        <Button
          key={w.id}
          label={`${w.id === workspace ? "✓ " : ""}${w.name}`}
          onPress={() => setWorkspace(w.id)}
        />
      ))}
      {workspaces?.length === 0 ? (
        <ThemedText>{t("likenessGrants.noWorkspaces")}</ThemedText>
      ) : null}
      {workspace ? <Characters key={workspace} {...props} workspaceId={workspace} /> : null}
    </ScrollView>
  );
}
function Characters(props: Viewer & { workspaceId: string }) {
  const [epoch, setEpoch] = useState(0);
  return <CharacterSession key={epoch} {...props} retry={() => setEpoch((v) => v + 1)} />;
}
function CharacterSession(props: Viewer & { workspaceId: string; retry: () => void }) {
  const t = useTranslations();
  const [rows, setRows] = useState<Likeness[]>(),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Likeness>();
  useEffect(() => {
    const c = new AbortController();
    void loadLikenesses(props.workspaceId, props.generation, c.signal).then(
      (r) => {
        if (!c.signal.aborted) setRows(r);
      },
      (e) => {
        if (!c.signal.aborted) setError(String(e));
      }
    );
    return () => c.abort();
  }, [props.workspaceId, props.generation]);
  return (
    <View style={{ gap: 12 }}>
      <Button label={t(error ? "common.retry" : "likenessGrants.refresh")} onPress={props.retry} />
      {error ? (
        <ThemedText accessibilityRole="alert">{error}</ThemedText>
      ) : !rows ? (
        <ActivityIndicator />
      ) : null}
      {rows?.length === 0 ? <ThemedText>{t("likenessGrants.empty")}</ThemedText> : null}
      {rows?.map((r) => (
        <Button
          key={r.id}
          label={`${selected?.id === r.id ? "✓ " : ""}${r.name}`}
          onPress={() => setSelected(r)}
        />
      ))}
      {selected ? <Grants key={selected.id} {...props} character={selected} /> : null}
      {selected ? (
        <LikenessOutputsPanel
          key={`outputs:${selected.id}`}
          characterId={selected.id}
          characterName={selected.name}
          userId={props.userId}
          generation={props.generation}
        />
      ) : null}
    </View>
  );
}
function Grants(props: Viewer & { character: Likeness }) {
  const [epoch, setEpoch] = useState(0);
  return <GrantSession key={epoch} {...props} refresh={() => setEpoch((v) => v + 1)} />;
}
function GrantSession({
  userId,
  generation,
  character,
  refresh,
}: Viewer & { character: Likeness; refresh: () => void }) {
  const t = useTranslations(),
    op = useAuthFormOperation(character.id, true);
  const [box] = useState(() => likenessWithdrawalBox(userId, generation, character.id));
  const [initial] = useState(() => {
    try {
      return { pending: box.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [error, setError] = useState(initial.error),
    [rows, setRows] = useState<LikenessGrant[]>(),
    [selected, setSelected] = useState<LikenessGrant>(),
    [clear, setClear] = useState(false),
    [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void loadLikenessGrants(character.id, generation, c.signal).then(
      (r) => {
        if (!c.signal.aborted) setRows(r);
      },
      (e) => {
        if (!c.signal.aborted) setError(String(e));
      }
    );
    return () => c.abort();
  }, [character.id, generation]);
  const failed = (e: unknown) => {
    if (controller.current!.signal.aborted || generation !== getAuthGeneration()) return;
    setError(e instanceof Error ? e.message : String(e));
    setRows(undefined);
    setSelected(undefined);
    try {
      setPending(box.read());
    } catch {
      /* Preserve unreadable records. */
    }
  };
  const withdraw = () => {
    if (!selected || pending || op.busy) return;
    const command = prepareLikenessWithdrawal(character, selected, uuid.v4());
    void op.run(
      () => withdrawLikenessGrant(command, userId, generation, controller.current!.signal),
      () => {
        setSelected(undefined);
        setMessage(t("likenessGrants.withdrawn"));
        setRows(undefined);
        void loadLikenessGrants(character.id, generation, controller.current!.signal).then((r) => {
          if (!controller.current!.signal.aborted) setRows(r);
        }, failed);
      },
      failed
    );
  };
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{character.name}</ThemedText>
      <LikenessGrantCreatePanel
        characterId={character.id}
        userId={userId}
        generation={generation}
        onHistory={refresh}
      />
      <Button label={t("likenessGrants.refresh")} onPress={refresh} disabled={op.busy} />
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      {message ? <ThemedText>{message}</ThemedText> : null}
      {!rows && !error ? <ActivityIndicator /> : null}
      {pending ? (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("likenessGrants.pending")}</ThemedText>
          <ThemedText>{pending.grant.projectName}</ThemedText>
          <Button
            label={t("likenessGrants.check")}
            disabled={op.busy}
            onPress={() =>
              void op.run(
                () =>
                  reconcileLikenessWithdrawal(
                    userId,
                    generation,
                    character.id,
                    controller.current!.signal
                  ),
                (ok) => {
                  setPending(box.read());
                  setMessage(
                    t(ok ? "likenessGrants.originalWithdrawn" : "likenessGrants.unresolved")
                  );
                },
                failed
              )
            }
          />
          <Button label={t("casting.clear")} disabled={op.busy} onPress={() => setClear(true)} />
          {clear ? (
            <>
              <ThemedText>{t("likenessGrants.clearHint")}</ThemedText>
              <Button
                label={t("casting.confirm")}
                disabled={op.busy}
                onPress={() => {
                  try {
                    box.clear(pending.clientKey);
                    setPending(null);
                    setClear(false);
                    refresh();
                  } catch (e) {
                    failed(e);
                  }
                }}
              />
              <Button label={t("report.cancel")} onPress={() => setClear(false)} />
            </>
          ) : null}
        </View>
      ) : null}
      {!error && rows?.length === 0 ? (
        <ThemedText>{t("likenessGrants.noGrants")}</ThemedText>
      ) : null}
      {!error
        ? rows?.map((grant) => (
            <View key={grant.id} style={{ gap: 8, paddingVertical: 8 }}>
              <ThemedText type="smallBold">{grant.projectName}</ThemedText>
              <ThemedText type="small">
                {t(grant.status === "active" ? "likenessGrants.active" : "likenessGrants.revoked")}{" "}
                · {new Date(grant.revokedAt ?? grant.createdAt).toLocaleDateString()}
              </ThemedText>
              {grant.status === "active" ? (
                <Button
                  label={t("likenessGrants.withdraw")}
                  onPress={() => setSelected(grant)}
                  disabled={!!pending || op.busy}
                />
              ) : null}
            </View>
          ))
        : null}
      {selected ? (
        <View style={{ gap: 8 }}>
          <ThemedText>{selected.projectName}</ThemedText>
          <ThemedText>{t("likenessGrants.confirmHint")}</ThemedText>
          <Button
            label={t("likenessGrants.confirm")}
            onPress={withdraw}
            disabled={op.busy || !!pending}
          />
          <Button
            label={t("report.cancel")}
            onPress={() => setSelected(undefined)}
            disabled={op.busy}
          />
        </View>
      ) : null}
    </View>
  );
}
