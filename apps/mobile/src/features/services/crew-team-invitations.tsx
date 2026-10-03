import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { PRESET_POSITIONS } from "@repo/shared/crew";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { crewPositionLabel } from "@/lib/crew-position-label";
import { useUserDisplays } from "./user-displays";
import {
  createTeamInvitation,
  fetchTeamInvitations,
  lookupTeamInvitee,
  revokeTeamInvitation,
  teamInvitationInput,
  teamInvitationPending,
  type TeamInvitation,
  type TeamInvitationAttempt,
  type TeamInvitationInput,
} from "./crew-team-invitations-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  initialPosition?: (typeof PRESET_POSITIONS)[number]["value"];
};
export function CrewTeamInvitations(props: Props) {
  return props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const [items, setItems] = useState<TeamInvitation[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [total, setTotal] = useState(0);
  const [access, setAccess] = useState<{ positions: boolean; policies: boolean }>();
  const [busy, setBusy] = useState(true),
    [error, setError] = useState<string>(),
    [storageError, setStorageError] = useState(false);
  const [pending, setPending] = useState<TeamInvitationAttempt | null>(null),
    [clearArmed, setClearArmed] = useState(false),
    [revokeArmed, setRevokeArmed] = useState<string>();
  const [lookupBy, setLookupBy] = useState<"contact" | "userId">("contact");
  const [account, setAccount] = useState(""),
    [position, setPosition] = useState<string | undefined>(props.initialPosition),
    [choosing, setChoosing] = useState(false),
    [policies, setPolicies] = useState<("admin" | "finance")[]>([]),
    [days, setDays] = useState("7");
  const [agreement, setAgreement] = useState(false),
    [title, setTitle] = useState(""),
    [signerName, setSignerName] = useState(""),
    [signerEmail, setSignerEmail] = useState("");
  const [review, setReview] = useState<{
    input: TeamInvitationInput;
    userId: string;
    nickname: string;
  }>();
  const control = useRef<AbortController | null>(null),
    lock = useRef(false),
    seen = useRef(new Set<string>());
  const valid = () =>
    !!control.current &&
    !control.current.signal.aborted &&
    props.generation === getAuthGeneration();
  const syncPending = () => {
    try {
      setPending(teamInvitationPending(props.crewId, props.userId, props.generation).read());
      setStorageError(false);
    } catch (e) {
      setStorageError(true);
      throw e;
    }
  };
  const run = async (fn: (signal: AbortSignal) => Promise<void>) => {
    if (!valid() || lock.current) return;
    const owner = control.current!;
    const owns = () =>
      control.current === owner &&
      !owner.signal.aborted &&
      props.generation === getAuthGeneration();
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await fn(owner.signal);
    } catch (e) {
      if (owns()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (owns()) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const load = async (signal: AbortSignal, next: string | null = null) => {
    setAccess(undefined);
    let page;
    try {
      page = await fetchTeamInvitations(props.crewId, props.userId, props.generation, next, signal);
    } catch (e) {
      if (valid() && !signal.aborted) {
        setItems([]);
        setCursor(null);
        setTotal(0);
      }
      throw e;
    }
    if (!valid() || signal.aborted) return;
    if (
      next &&
      (page.items.some((row) => items.some((old) => old.id === row.id)) ||
        (page.nextCursor && seen.current.has(page.nextCursor)))
    ) {
      setItems([]);
      setCursor(null);
      setTotal(0);
      throw new Error("Invitations changed. Refresh the list.");
    }
    if (!next) seen.current.clear();
    if (page.nextCursor) seen.current.add(page.nextCursor);
    setItems((old) => (next ? [...old, ...page.items] : page.items));
    setCursor(page.nextCursor);
    setTotal(page.total);
    setAccess(page.access);
    if (!page.access.positions) setPosition(undefined);
    if (!page.access.policies) setPolicies([]);
    setReview(undefined);
    syncPending();
  };
  useEffect(() => {
    const c = new AbortController();
    control.current = c;
    void run(async (signal) => {
      syncPending();
      await load(signal);
    });
    return () => {
      c.abort();
      control.current = null;
      lock.current = false;
    };
    // Session identity is keyed by the parent; each mount owns one controller and first-page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const displays = useUserDisplays(
    String(props.generation),
    items.map((row) => row.inviteeUserId)
  );
  const locked = busy || !!pending || storageError || !access;
  const input = teamInvitationInput.safeParse({
    account,
    ...(lookupBy === "userId" ? { lookupBy } : {}),
    positionCategory: position,
    policyKeys: policies,
    expiresInDays: /^\d+$/.test(days) ? Number(days) : NaN,
    ...(agreement ? { agreement: { title, signerName, signerEmail } } : {}),
  });
  const resetReview = () => setReview(undefined);
  const change = (setter: (value: string) => void) => (value: string) => {
    resetReview();
    setter(value);
  };
  const submit = () =>
    void run(async (signal) => {
      if (!input.success || locked) return;
      if (!review) {
        const target = await lookupTeamInvitee(
          props.crewId,
          props.userId,
          props.generation,
          input.data.account,
          signal,
          input.data.lookupBy
        );
        if (valid())
          setReview({ input: input.data, userId: target.userId, nickname: target.nickname });
        return;
      }
      try {
        await createTeamInvitation(
          props.crewId,
          props.userId,
          props.generation,
          review.input,
          review.userId,
          signal
        );
        if (!valid()) return;
        setAccount("");
        setReview(undefined);
        setPending(null);
        setPolicies([]);
        setPosition(undefined);
        setAgreement(false);
        setTitle("");
        setSignerName("");
        setSignerEmail("");
        await load(signal);
      } finally {
        if (valid()) {
          syncPending();
          setReview(undefined);
        }
      }
    });
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      <ThemedText type="smallBold">{t("teamInvites.title")}</ThemedText>
      <ThemedText>{t("teamInvites.help")}</ThemedText>
      {pending && (
        <View
          style={{ padding: 12, gap: 8, backgroundColor: theme.backgroundElement, borderRadius: 8 }}
        >
          <ThemedText>{t("teamInvites.unknown")}</ThemedText>
          <ThemedText>
            {pending.nickname} · {pending.input.account}
          </ThemedText>
          <ThemedText>
            {pending.input.positionCategory
              ? crewPositionLabel(pending.input.positionCategory, t)
              : t("crewMembers.noPosition")}
          </ThemedText>
          {pending.input.policyKeys.map((p) => (
            <ThemedText key={p}>{t(`crewMembers.${p}`)}</ThemedText>
          ))}
          {pending.input.agreement && (
            <ThemedText>
              {pending.input.agreement.title} · {pending.input.agreement.signerName} ·{" "}
              {pending.input.agreement.signerEmail}
            </ThemedText>
          )}
          <Action
            disabled={busy}
            label={t(clearArmed ? "teamInvites.confirmClear" : "teamInvites.reviewed")}
            onPress={() => {
              if (!clearArmed) {
                setClearArmed(true);
                return;
              }
              void run(async () => {
                teamInvitationPending(props.crewId, props.userId, props.generation).clear();
                syncPending();
                setClearArmed(false);
                setReview(undefined);
              });
            }}
          />
        </View>
      )}
      <Action
        label={t(lookupBy === "contact" ? "teamInvites.useUserId" : "teamInvites.useContact")}
        disabled={locked}
        onPress={() => {
          setLookupBy(lookupBy === "contact" ? "userId" : "contact");
          setAccount("");
          resetReview();
        }}
      />
      <Field
        label={t(lookupBy === "userId" ? "teamInvites.userId" : "teamInvites.account")}
        value={account}
        onChange={change(setAccount)}
        disabled={locked}
      />
      <Action
        disabled={locked || !access?.positions}
        label={position ? crewPositionLabel(position, t) : t("teamInvites.position")}
        onPress={() => setChoosing(!choosing)}
      />
      {choosing && !locked && access?.positions && (
        <View style={{ gap: 6 }}>
          <Action
            label={t("crewMembers.noPosition")}
            onPress={() => {
              setPosition(undefined);
              setChoosing(false);
              resetReview();
            }}
          />
          {PRESET_POSITIONS.map((p) => (
            <Action
              key={p.value}
              label={crewPositionLabel(p.value, t)}
              onPress={() => {
                setPosition(p.value);
                setChoosing(false);
                resetReview();
              }}
            />
          ))}
        </View>
      )}
      {access?.policies &&
        (["admin", "finance"] as const).map((p) => (
          <Action
            key={p}
            selected={policies.includes(p)}
            disabled={locked}
            label={t(`crewMembers.${p}`)}
            onPress={() => {
              setPolicies((old) => (old.includes(p) ? old.filter((v) => v !== p) : [...old, p]));
              resetReview();
            }}
          />
        ))}
      <Field
        label={t("teamInvites.days")}
        value={days}
        onChange={change(setDays)}
        disabled={locked}
      />
      <Action
        disabled={locked}
        selected={agreement}
        label={t("crewInvitations.agreementOptional")}
        onPress={() => {
          setAgreement(!agreement);
          resetReview();
        }}
      />
      {agreement && (
        <>
          <ThemedText>{t("crewInvitations.agreementAfterAccept")}</ThemedText>
          <Field
            label={t("teamInvites.agreementTitle")}
            value={title}
            onChange={change(setTitle)}
            disabled={locked}
          />
          <Field
            label={t("teamInvites.signerName")}
            value={signerName}
            onChange={change(setSignerName)}
            disabled={locked}
          />
          <Field
            label={t("teamInvites.signerEmail")}
            value={signerEmail}
            onChange={change(setSignerEmail)}
            disabled={locked}
          />
        </>
      )}
      {review && (
        <ThemedText>
          {t("teamInvites.confirmHelp")} {review.nickname} · {review.userId}
        </ThemedText>
      )}
      {!input.success && account.length > 0 && <ThemedText>{t("teamInvites.invalid")}</ThemedText>}
      <Action
        disabled={locked || !input.success}
        label={t(review ? "teamInvites.send" : "teamInvites.lookup")}
        onPress={submit}
      />
      <ThemedText type="smallBold">
        {t("teamInvites.pending")} · {items.length}/{total}
      </ThemedText>
      {items.map((row) => (
        <View
          key={row.id}
          style={{ padding: 12, gap: 8, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          <ThemedText>{displays?.get(row.inviteeUserId)?.nickname || row.inviteeUserId}</ThemedText>
          {row.positionCategory && (
            <ThemedText>{crewPositionLabel(row.positionCategory, t)}</ThemedText>
          )}
          {row.policyKeys.map((p) => (
            <ThemedText key={p}>{t(`crewMembers.${p}`)}</ThemedText>
          ))}
          <ThemedText>
            {t("crewInvitations.expires")} · {new Date(row.expiresAt).toLocaleString()}
          </ThemedText>
          {row.agreementRequest && (
            <ThemedText>
              {row.agreementRequest.title} · {row.agreementRequest.signerName} ·{" "}
              {row.agreementRequest.signerEmail}
            </ThemedText>
          )}
          <Action
            disabled={busy || !access}
            label={t(revokeArmed === row.id ? "teamInvites.confirmRevoke" : "teamInvites.revoke")}
            onPress={() => {
              if (revokeArmed !== row.id) {
                setRevokeArmed(row.id);
                return;
              }
              void run(async (signal) => {
                setRevokeArmed(undefined);
                try {
                  await revokeTeamInvitation(
                    props.crewId,
                    props.userId,
                    props.generation,
                    row,
                    signal
                  );
                  await load(signal);
                } catch (e) {
                  if (valid()) setAccess(undefined);
                  throw e;
                }
              });
            }}
          />
        </View>
      ))}
      {cursor && (
        <Action
          disabled={busy || !access}
          label={t("crewAssets.more")}
          onPress={() => void run((signal) => load(signal, cursor))}
        />
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy && <ActivityIndicator />}
      <Action
        disabled={busy}
        label={t("thread.refresh")}
        onPress={() =>
          void run(async (signal) => {
            setItems([]);
            setCursor(null);
            setTotal(0);
            setReview(undefined);
            setRevokeArmed(undefined);
            await load(signal);
          })
        }
      />
      <Action disabled={busy} label={t("common.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Action({
  label,
  onPress,
  disabled = false,
  selected,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: selected ? theme.text : theme.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <ThemedText>{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        autoCapitalize="none"
        style={{
          padding: 12,
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          borderRadius: 8,
        }}
      />
    </View>
  );
}
