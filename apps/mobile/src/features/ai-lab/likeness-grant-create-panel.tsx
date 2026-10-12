import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ProjectLikenessConsent } from "./project-likeness-consent";
import {
  listLikenessGrantProjects,
  reviewLikenessGrant,
  likenessGrantCreateBox,
  prepareLikenessGrant,
  createLikenessGrant,
  type GrantProject,
  type GrantReview,
} from "./likeness-grant-create-api";
type Props = { characterId: string; userId: string; generation: number; onHistory: () => void };
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
export function LikenessGrantCreatePanel(props: Props) {
  const t = useTranslations();
  const [open, setOpen] = useState(false),
    [epoch, setEpoch] = useState(0);
  return (
    <View style={{ gap: 8 }}>
      <Button
        label={t(open ? "grantCreate.close" : "grantCreate.title")}
        onPress={() => setOpen((v) => !v)}
      />
      {open ? <Form key={epoch} {...props} refresh={() => setEpoch((v) => v + 1)} /> : null}
    </View>
  );
}
function Form({
  characterId,
  userId,
  generation,
  onHistory,
  refresh,
}: Props & { refresh: () => void }) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`grant:${characterId}`, true);
  const [box] = useState(() => likenessGrantCreateBox(userId, generation, characterId));
  const [initial] = useState(() => {
    try {
      return { pending: box.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [error, setError] = useState(initial.error),
    [projects, setProjects] = useState<GrantProject[]>(),
    [review, setReview] = useState<GrantReview>(),
    [search, setSearch] = useState(""),
    [clear, setClear] = useState(false),
    [done, setDone] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void listLikenessGrantProjects(characterId, generation, c.signal).then(
      (p) => {
        if (!c.signal.aborted) setProjects(p);
      },
      (e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => c.abort();
  }, [characterId, generation]);
  const fail = (e: unknown) => {
    if (controller.current?.signal.aborted || generation !== getAuthGeneration()) return;
    setError(e instanceof Error ? e.message : String(e));
    setReview(undefined);
    setProjects(undefined);
    try {
      setPending(box.read());
    } catch {
      /* Preserve invalid record. */
    }
  };
  const confirm = (read: boolean, adult: boolean) => {
    if (!review || pending || op.busy) return;
    let command;
    try {
      command = prepareLikenessGrant(review, uuid.v4(), read, adult);
    } catch (e) {
      fail(e);
      return;
    }
    void op.run(
      () => createLikenessGrant(command, userId, generation, controller.current!.signal),
      () => {
        setDone(true);
        setReview(undefined);
        setError("");
      },
      fail
    );
  };
  if (done)
    return (
      <View style={{ gap: 8 }}>
        <ThemedText>{t("grantCreate.done")}</ThemedText>
        <Button label={t("grantCreate.history")} onPress={onHistory} />
      </View>
    );
  const filtered = projects?.filter((p) =>
    `${p.name} ${p.workspaceName}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  );
  return (
    <View style={{ gap: 10 }}>
      <ThemedText type="small">{t("grantCreate.hint")}</ThemedText>
      <Button label={t("likenessGrants.refresh")} onPress={refresh} disabled={op.busy} />
      <Button label={t("grantCreate.history")} onPress={onHistory} disabled={op.busy} />
      {error ? (
        <ThemedText accessibilityRole="alert">{error}</ThemedText>
      ) : !projects ? (
        <ActivityIndicator />
      ) : null}
      {pending ? (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("grantCreate.pending")}</ThemedText>
          <ThemedText>
            {pending.project.name} · {pending.character.name}
          </ThemedText>
          <Button label={t("casting.clear")} disabled={op.busy} onPress={() => setClear(true)} />
          {clear ? (
            <>
              <ThemedText>{t("grantCreate.clearHint")}</ThemedText>
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
                    fail(e);
                  }
                }}
              />
              <Button label={t("report.cancel")} onPress={() => setClear(false)} />
            </>
          ) : null}
        </View>
      ) : null}
      {!error && !pending && !review ? (
        <>
          <TextInput
            accessibilityLabel={t("grantCreate.search")}
            placeholder={t("grantCreate.search")}
            placeholderTextColor={theme.textSecondary}
            value={search}
            onChangeText={setSearch}
            maxLength={120}
            style={{
              padding: 12,
              color: theme.text,
              backgroundColor: theme.backgroundElement,
              borderRadius: 8,
            }}
          />
          {filtered?.length === 0 ? <ThemedText>{t("grantCreate.empty")}</ThemedText> : null}
          {filtered?.map((p) => (
            <Button
              key={p.id}
              label={`${p.name} · ${p.workspaceName}`}
              disabled={op.busy}
              onPress={() =>
                void op.run(
                  () => reviewLikenessGrant(characterId, p, generation, controller.current!.signal),
                  setReview,
                  fail
                )
              }
            />
          ))}
        </>
      ) : null}
      {review && !pending ? (
        <ProjectLikenessConsent
          key={`${review.character.id}:${review.character.updatedAt}:${review.project.id}:${review.project.name}`}
          projectName={review.project.name}
          confirmLabel={t("grantCreate.confirm")}
          busy={op.busy}
          onConfirm={confirm}
          onBack={() => setReview(undefined)}
        />
      ) : null}
    </View>
  );
}
