import { PositionEdit } from "./position-edit";
import { PositionLifecycle } from "./position-lifecycle";
import { PositionCreate } from "./position-create";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { crewPositionLabel } from "@/lib/crew-position-label";
import {
  fetchManagedPositions,
  fetchManagedInvitations,
  lookupInvitee,
  createManagedInvitation,
  revokeManagedInvitation,
  type ManagedPosition,
  type ManagedInvitation,
} from "./invitation-management-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function InvitationManagement(props: Props) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ManagedPosition>();
  const [managing, setManaging] = useState<ManagedPosition>();
  const [position, setPosition] = useState<ManagedPosition>(),
    [cursor, setCursor] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  if (editing)
    return (
      <PositionEdit
        {...props}
        positionId={editing.id}
        onClose={() => {
          setEditing(undefined);
          setCursor(null);
          setRevision((n) => n + 1);
        }}
      />
    );
  if (managing)
    return (
      <PositionLifecycle
        position={managing}
        userId={props.userId}
        generation={props.generation}
        onClose={() => {
          setManaging(undefined);
          setCursor(null);
          setRevision((n) => n + 1);
        }}
      />
    );
  if (creating)
    return (
      <PositionCreate
        {...props}
        onClose={() => {
          setCreating(false);
          setCursor(null);
          setRevision((n) => n + 1);
        }}
      />
    );
  if (position)
    return (
      <PositionInvites
        {...props}
        position={position}
        onClose={() => {
          setPosition(undefined);
          setCursor(null);
          setRevision((n) => n + 1);
        }}
      />
    );
  return (
    <Positions
      key={`${revision}:${cursor}`}
      {...props}
      cursor={cursor}
      onEdit={setEditing}
      onManage={setManaging}
      onCreate={() => setCreating(true)}
      onSelect={setPosition}
      onMore={setCursor}
      onRefresh={() => {
        setCursor(null);
        setRevision((n) => n + 1);
      }}
    />
  );
}
function Positions(
  props: Props & {
    cursor: string | null;
    onEdit: (position: ManagedPosition) => void;
    onManage: (position: ManagedPosition) => void;
    onCreate: () => void;
    onSelect: (position: ManagedPosition) => void;
    onMore: (cursor: string) => void;
    onRefresh: () => void;
  }
) {
  const t = useTranslations();
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchManagedPositions>>>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void fetchManagedPositions(
      props.crewId,
      props.userId,
      props.generation,
      props.cursor,
      c.signal
    ).then(
      (value) => {
        if (!c.signal.aborted) setPage(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, props.cursor]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("inviteManagement.title")}</ThemedText>
      {!page && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {page && <Action label={t("positionCreate.title")} onPress={props.onCreate} />}
      {page?.items.map((row) => (
        <View key={row.id} style={{ gap: 8 }}>
          <Action
            label={`${crewPositionLabel(row.positionType, t)} · ${row.recruitedCount}/${row.targetCount}`}
            onPress={() => props.onSelect(row)}
          />
          <Action
            label={t("positionEdit.action").replace(
              "{role}",
              crewPositionLabel(row.positionType, t)
            )}
            onPress={() => props.onEdit(row)}
          />
          <Action
            label={t("positionLifecycle.manage").replace(
              "{role}",
              crewPositionLabel(row.positionType, t)
            )}
            onPress={() => props.onManage(row)}
          />
        </View>
      ))}
      {page?.items.length === 0 && <ThemedText>{t("crewPositionInvites.empty")}</ThemedText>}
      {page?.nextCursor && (
        <Action
          label={t("crewPositionInvites.more")}
          onPress={() => props.onMore(page.nextCursor!)}
        />
      )}
      <Action label={t("crewPositionInvites.refresh")} onPress={props.onRefresh} />
      <Action label={t("nativeApplications.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function PositionInvites(props: Props & { position: ManagedPosition }) {
  const [revision, setRevision] = useState(0),
    [cursor, setCursor] = useState<string | null>(null);
  return (
    <InvitePage
      key={`${revision}:${cursor}`}
      {...props}
      cursor={cursor}
      onMore={setCursor}
      onRefresh={() => {
        setCursor(null);
        setRevision((n) => n + 1);
      }}
    />
  );
}
function InvitePage(
  props: Props & {
    position: ManagedPosition;
    cursor: string | null;
    onMore: (cursor: string) => void;
    onRefresh: () => void;
  }
) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    op = useAuthFormOperation(props.position.id, true);
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchManagedInvitations>>>(),
    [error, setError] = useState<string>();
  const [contact, setContact] = useState(""),
    [days, setDays] = useState("7"),
    [recipient, setRecipient] = useState<Awaited<ReturnType<typeof lookupInvitee>>>();
  const [uncertain, setUncertain] = useState(false),
    [retry, setRetry] = useState<ManagedInvitation>(),
    [done, setDone] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void fetchManagedInvitations(
      props.position,
      props.userId,
      props.generation,
      props.cursor,
      c.signal
    ).then(
      (value) => {
        if (!c.signal.aborted) setPage(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [props.position, props.userId, props.generation, props.cursor]);
  const blocked = op.busy || uncertain || !!retry || done;
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));
  const revoke = (row: ManagedInvitation) =>
    void op.run(
      () => {
        setError(undefined);
        return revokeManagedInvitation(props.position, row, props.generation);
      },
      () => {
        setRetry(undefined);
        setDone(true);
      },
      (cause) => {
        fail(cause);
        const status =
          cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
        if ([400, 401, 403, 404, 409, 422].includes(status)) setDone(true);
        else setRetry(row);
      }
    );
  const field = (label: string, value: string, set: (value: string) => void, maxLength: number) => (
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={set}
      editable={!blocked}
      maxLength={maxLength}
      autoCapitalize="none"
      style={{
        color: theme.text,
        borderColor: theme.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
      }}
    />
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{crewPositionLabel(props.position.positionType, t)}</ThemedText>
      <ThemedText>{t("crewPositionInvites.help")}</ThemedText>
      {!page && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {uncertain && <ThemedText>{t("inviteManagement.uncertain")}</ThemedText>}
      {done && !error && <ThemedText>{t("inviteManagement.saved")}</ThemedText>}
      {retry && (
        <>
          <ThemedText>{t("crewPositionInvites.retryHelp")}</ThemedText>
          <Action
            disabled={op.busy}
            label={t("crewPositionInvites.retry")}
            onPress={() => revoke(retry)}
          />
        </>
      )}
      {page && (
        <>
          {!!props.position.taskId &&
            props.position.status === "open" &&
            props.position.recruitedCount < props.position.targetCount && (
              <>
                <ThemedText>{t("crewPositionInvites.recipient")}</ThemedText>
                {field(
                  t("crewPositionInvites.recipient"),
                  contact,
                  (value) => {
                    setContact(value);
                    setRecipient(undefined);
                  },
                  254
                )}
                <Action
                  disabled={blocked || !contact.trim()}
                  label={t("inviteManagement.lookup")}
                  onPress={() =>
                    void op.run(
                      () => {
                        setError(undefined);
                        setRecipient(undefined);
                        return lookupInvitee(contact, props.generation);
                      },
                      setRecipient,
                      fail
                    )
                  }
                />
                {recipient && (
                  <>
                    <ThemedText>{recipient.nickname || recipient.userId}</ThemedText>
                    <ThemedText>{t("crewPositionInvites.days")}</ThemedText>
                    {field(t("crewPositionInvites.days"), days, setDays, 2)}
                    <Action
                      disabled={
                        blocked ||
                        recipient.userId === props.userId ||
                        !/^\d+$/.test(days) ||
                        Number(days) < 1 ||
                        Number(days) > 30
                      }
                      label={t("crewPositionInvites.invite")}
                      onPress={() =>
                        void op.run(
                          () => {
                            setError(undefined);
                            return createManagedInvitation(
                              props.position,
                              props.userId,
                              props.generation,
                              recipient.userId,
                              Number(days)
                            );
                          },
                          () => setDone(true),
                          (cause) => {
                            fail(cause);
                            const status =
                              cause && typeof cause === "object" && "status" in cause
                                ? Number(cause.status)
                                : 0;
                            if ([400, 401, 403, 404, 409, 422].includes(status)) setDone(true);
                            else setUncertain(true);
                          }
                        )
                      }
                    />
                  </>
                )}
              </>
            )}
          {page.items.length === 0 && <ThemedText>{t("crewPositionInvites.empty")}</ThemedText>}
          {page.items.map((row) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityState={{ disabled: blocked || row.status !== "pending" }}
              disabled={blocked || row.status !== "pending"}
              onPress={() => revoke(row)}
              style={{ padding: 12, borderColor: theme.border, borderWidth: 1, borderRadius: 8 }}
            >
              <ThemedText>
                {row.inviteeUserId} · {t(`crewPositionInvites.${row.status}`)} ·{" "}
                {new Date(row.expiresAt).toLocaleString(locale)}
                {row.status === "pending" ? ` · ${t("crewPositionInvites.revoke")}` : ""}
              </ThemedText>
            </Pressable>
          ))}
          {page.nextCursor && (
            <Action
              disabled={blocked}
              label={t("crewPositionInvites.more")}
              onPress={() => props.onMore(page.nextCursor!)}
            />
          )}
        </>
      )}
      {op.busy && <ActivityIndicator />}
      <Action
        disabled={op.busy || !!retry}
        label={t("crewPositionInvites.refresh")}
        onPress={props.onRefresh}
      />
      <Action disabled={op.busy} label={t("nativeApplications.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Action({
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
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
