import { useScreenActive } from "@/hooks/use-app-active";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { appEnv } from "@/config/app-env";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  createCrewLink,
  crewLinkInput,
  crewLinkPending,
  crewLinkUrl,
  fetchCrewLinks,
  revokeCrewLink,
  type CrewLink,
  type CrewLinkAttempt,
  type CrewLinkInput,
} from "./crew-invite-links-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  task?: { id: string; version: number; title: string };
  onClose: () => void;
};
export function CrewInviteLinks(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session
      key={`${props.crewId}:${props.userId}:${props.generation}:${props.task?.id ?? ""}:${props.task?.version ?? ""}`}
      {...props}
    />
  ) : null;
}
function Session(props: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme();
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchCrewLinks>>>();
  const [busy, setBusy] = useState(true),
    [error, setError] = useState<string>(),
    [storageError, setStorageError] = useState(false);
  const [pending, setPending] = useState<CrewLinkAttempt | null>(null),
    [clearArmed, setClearArmed] = useState(false);
  const [kind, setKind] = useState<"member" | "community">("member"),
    [policy, setPolicy] = useState<"standard" | "admin" | "finance">("standard"),
    [days, setDays] = useState(""),
    [uses, setUses] = useState("");
  const [review, setReview] = useState<CrewLinkInput>(),
    [revoking, setRevoking] = useState<CrewLink>();
  const [fresh, setFresh] = useState<{ id: string; url: string }>(),
    [notice, setNotice] = useState(false);
  const controller = useRef<AbortController | null>(null),
    lock = useRef(false);
  const valid = () =>
    !!controller.current &&
    !controller.current.signal.aborted &&
    props.generation === getAuthGeneration();
  const sync = () => {
    try {
      setPending(
        crewLinkPending(props.crewId, props.userId, props.generation, props.task?.id).read()
      );
      setStorageError(false);
    } catch (e) {
      setStorageError(true);
      throw e;
    }
  };
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (!valid() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    const owner = controller.current!;
    try {
      await fn(owner.signal);
    } catch (e) {
      if (valid() && owner === controller.current && !owner.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (valid() && owner === controller.current) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const load = async (signal: AbortSignal) => {
    setPage(undefined);
    setReview(undefined);
    setRevoking(undefined);
    try {
      const data = await fetchCrewLinks(
        props.crewId,
        props.userId,
        props.generation,
        signal,
        props.task?.id
      );
      if (!valid() || signal.aborted) return;
      setPage(data);
      if (!data.access.policies) setPolicy("standard");
    } catch (e) {
      if (valid() && !signal.aborted) setFresh(undefined);
      throw e;
    }
  };
  const initialise = useEffectEvent(() => {
    void run(async (signal) => {
      sync();
      await load(signal);
    });
  });
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    controller.current = c;
    lock.current = false;
    initialise();
    return () => c.abort();
  }, [active, props.crewId, props.userId, props.generation]);
  const mutate = async (fn: (signal: AbortSignal) => Promise<void>) =>
    run(async (signal) => {
      try {
        await fn(signal);
      } finally {
        if (valid() && !signal.aborted) sync();
      }
    });
  const change = () => {
    setReview(undefined);
    setNotice(false);
  };
  const number = (value: string) => {
    if (!value.trim()) return undefined;
    if (!/^\d+$/.test(value.trim())) throw new Error(t("crewLinks.invalidNumber"));
    return Number(value.trim());
  };
  const details = (value: {
    kind: "member" | "community";
    policyKeys: ("admin" | "finance")[];
    maxUses?: number | null;
    expiresInDays?: number;
  }) => (
    <>
      <ThemedText type="small">
        {t(value.kind === "member" ? "crewJoin.crew" : "crewJoin.crew_community")}
      </ThemedText>
      {value.kind === "member" && (
        <ThemedText type="small">
          {value.policyKeys.length
            ? value.policyKeys.map((p) => t(`crewMembers.${p}`)).join(" · ")
            : t("crewLinks.standard")}
        </ThemedText>
      )}
      <ThemedText type="small">
        {t("crewLinks.useLimit")} · {value.maxUses ?? t("crewLinks.unlimited")}
      </ThemedText>
      {"expiresInDays" in value && (
        <ThemedText type="small">
          {t("crewLinks.days")} · {value.expiresInDays ?? t("crewJoin.never")}
        </ThemedText>
      )}
    </>
  );
  if (!active) return null;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t("crewLinks.title")}</ThemedText>
      <ThemedText type="small">
        {props.task
          ? t("workspace.taskInviteIntro").replace("{task}", props.task.title)
          : t("crewLinks.help")}
      </ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {(pending || storageError) && (
        <View style={{ gap: 8 }}>
          <ThemedText type="small">{t("crewLinks.pending")}</ThemedText>
          {pending && (
            <>
              <ThemedText type="small">
                {t(pending.kind === "create" ? "crewLinks.create" : "crewLinks.revoke")} ·{" "}
                {new Date(pending.startedAt).toLocaleString()}
              </ThemedText>
              {pending.kind === "create" ? (
                details(pending.input)
              ) : (
                <ThemedText type="small">{pending.link.id}</ThemedText>
              )}
            </>
          )}
          <Action
            label={t(clearArmed ? "crewLinks.confirmClear" : "crewLinks.clear")}
            disabled={busy}
            onPress={() => {
              if (!clearArmed) {
                setClearArmed(true);
                return;
              }
              void run(async () => {
                crewLinkPending(
                  props.crewId,
                  props.userId,
                  props.generation,
                  props.task?.id
                ).clear();
                sync();
                setClearArmed(false);
                setReview(undefined);
              });
            }}
          />
        </View>
      )}
      {fresh && (
        <View
          style={{ padding: 12, gap: 8, backgroundColor: theme.backgroundElement, borderRadius: 8 }}
        >
          <ThemedText type="small">{t("crewLinks.once")}</ThemedText>
          <ThemedText selectable type="small">
            {fresh.url}
          </ThemedText>
          <Action
            label={t("crewLinks.share")}
            disabled={busy}
            onPress={() =>
              void run(async (signal) => {
                const data = await fetchCrewLinks(
                  props.crewId,
                  props.userId,
                  props.generation,
                  signal,
                  props.task?.id
                );
                if (!valid() || signal.aborted) return;
                setPage(data);
                const row = data.links.find((v) => v.id === fresh.id);
                if (
                  !row ||
                  row.state !== "active" ||
                  (row.expiresAt && Date.parse(row.expiresAt) <= Date.now())
                ) {
                  setFresh(undefined);
                  throw new Error(t("crewLinks.unavailable"));
                }
                await Share.share({ message: fresh.url });
              })
            }
          />
          <Action
            label={t("crewLinks.dismiss")}
            disabled={busy}
            onPress={() => setFresh(undefined)}
          />
        </View>
      )}
      {page && !pending && !storageError && !fresh && (
        <>
          {!props.task && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(["member", "community"] as const).map((v) => (
                <Action
                  key={v}
                  label={`${kind === v ? "✓ " : ""}${t(v === "member" ? "crewJoin.crew" : "crewJoin.crew_community")}`}
                  disabled={busy}
                  onPress={() => {
                    setKind(v);
                    setPolicy("standard");
                    change();
                  }}
                />
              ))}
            </View>
          )}
          {!props.task && kind === "member" && page.access.policies && (
            <View style={{ gap: 8 }}>
              {(["standard", "finance", "admin"] as const).map((v) => (
                <Action
                  key={v}
                  label={`${policy === v ? "✓ " : ""}${t(v === "standard" ? "crewLinks.standard" : `crewMembers.${v}`)}`}
                  disabled={busy}
                  onPress={() => {
                    setPolicy(v);
                    change();
                  }}
                />
              ))}
            </View>
          )}
          <Field
            label={t("crewLinks.days")}
            value={days}
            disabled={busy}
            onChange={(v) => {
              setDays(v);
              change();
            }}
          />
          {!props.task && (
            <Field
              label={t("crewLinks.maxUses")}
              value={uses}
              disabled={busy}
              onChange={(v) => {
                setUses(v);
                change();
              }}
            />
          )}
          {!props.task && <ThemedText type="small">{t("crewLinks.bounds")}</ThemedText>}
          <Action
            label={t("crewLinks.review")}
            disabled={busy}
            onPress={() => {
              try {
                setReview(
                  crewLinkInput.parse({
                    kind: props.task ? "member" : kind,
                    policyKeys:
                      !props.task && kind === "member" && policy !== "standard" ? [policy] : [],
                    ...(props.task
                      ? { taskId: props.task.id, taskVersion: props.task.version }
                      : {}),
                    expiresInDays: number(days),
                    maxUses: props.task ? 1 : number(uses),
                  })
                );
                setError(undefined);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
          {review && (
            <View style={{ gap: 8 }}>
              {details(review)}
              <Action
                label={t("crewLinks.create")}
                disabled={busy}
                onPress={() =>
                  void mutate(async (signal) => {
                    const result = await createCrewLink(
                      props.crewId,
                      props.userId,
                      props.generation,
                      review,
                      signal
                    );
                    if (!valid() || signal.aborted) return;
                    setFresh({ id: result.id, url: crewLinkUrl(result.token, appEnv.appRegion) });
                    setReview(undefined);
                    setPage((old) =>
                      old ? { ...old, links: [result, ...old.links].slice(0, 50) } : old
                    );
                  })
                }
              />
            </View>
          )}
        </>
      )}
      <Action
        label={t("crewLinks.refresh")}
        disabled={busy}
        onPress={() =>
          void run(async (signal) => {
            await load(signal);
            sync();
          })
        }
      />
      <ThemedText type="small">{t("crewLinks.limit")}</ThemedText>
      {notice && <ThemedText type="small">{t("crewLinks.revoked")}</ThemedText>}
      {page?.links.length === 0 && <ThemedText type="small">{t("crewLinks.empty")}</ThemedText>}
      {page?.links.map((row) => (
        <View
          key={row.id}
          style={{ padding: 12, gap: 8, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          {details(row)}
          <ThemedText type="small">
            {t(`crewJoin.${row.state}`)} · {row.useCount} /{" "}
            {row.maxUses ?? t("crewLinks.unlimited")}
          </ThemedText>
          <ThemedText type="small">
            {t("crewLinks.expires")} ·{" "}
            {row.expiresAt ? new Date(row.expiresAt).toLocaleString() : t("crewJoin.never")}
          </ThemedText>
          <ThemedText type="small">
            {t("crewLinks.created")} · {new Date(row.createdAt).toLocaleString()} · {row.id}
          </ThemedText>
          <Action
            label={t(revoking?.id === row.id ? "crewLinks.confirmRevoke" : "crewLinks.revoke")}
            disabled={busy || !!pending || storageError}
            onPress={() => {
              if (revoking?.id !== row.id) {
                setRevoking(row);
                return;
              }
              void mutate(async (signal) => {
                await revokeCrewLink(props.crewId, props.userId, props.generation, row, signal);
                if (!valid() || signal.aborted) return;
                setFresh((old) => (old?.id === row.id ? undefined : old));
                setPage((old) =>
                  old ? { ...old, links: old.links.filter((v) => v.id !== row.id) } : old
                );
                setRevoking(undefined);
                setNotice(true);
              });
            }}
          />
          {revoking?.id === row.id && (
            <ThemedText type="small">{t("crewLinks.revokeHelp")}</ThemedText>
          )}
        </View>
      ))}
      {busy && <ActivityIndicator />}
      <Action label={t("common.back")} disabled={busy} onPress={props.onClose} />
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
function Field({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        keyboardType="number-pad"
        editable={!disabled}
        onChangeText={onChange}
        style={{
          color: theme.text,
          padding: 12,
          borderWidth: 1,
          borderColor: theme.textSecondary,
          borderRadius: 8,
        }}
      />
    </View>
  );
}
