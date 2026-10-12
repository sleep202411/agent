import { CrewOwnershipTransfer } from "./crew-ownership-transfer";
import { CrewMemberAccess } from "./crew-member-access";
import { CrewMemberPositions } from "./crew-member-positions";
import { CrewMemberRemoval } from "./crew-member-removal";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { crewPositionLabel } from "@/lib/crew-position-label";
import { useUserDisplays } from "./user-displays";
import { fetchCrewMemberPage, type CrewMember } from "./crew-members-api";
type Props = {
  crewId: string;
  userId: string;
  generation: number;
  onClose: () => void;
  onTransferComplete: () => void;
};
export function CrewMembers(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  return (
    <Directory
      key={revision}
      {...props}
      refresh={() => setRevision((v) => v + 1)}
      title={t("crewMembers.title")}
    />
  );
}
function Directory(props: Props & { refresh: () => void; title: string }) {
  const t = useTranslations(),
    theme = useTheme();
  const [transferring, setTransferring] = useState<CrewMember>();
  const [canTransfer, setCanTransfer] = useState(false);
  const [editingAccess, setEditingAccess] = useState<CrewMember>();
  const [canManagePermissions, setCanManagePermissions] = useState(false);
  const [editingPositions, setEditingPositions] = useState<CrewMember>();
  const [removing, setRemoving] = useState<CrewMember>();
  const [canManage, setCanManage] = useState(false);
  const [items, setItems] = useState<CrewMember[]>([]),
    [total, setTotal] = useState<number>(),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string>();
  const session = useRef<
    | {
        controller: AbortController;
        items: CrewMember[];
        cursor: string | null;
        seen: Set<string>;
        busy: boolean;
        more: boolean;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    const state = {
      controller: new AbortController(),
      items: [] as CrewMember[],
      cursor: null as string | null,
      seen: new Set<string>(),
      busy: false,
      more: true,
    };
    session.current = state;
    void load(state);
    return () => {
      state.controller.abort();
      if (session.current === state) session.current = undefined;
    };
    async function load(state: NonNullable<typeof session.current>) {
      state.busy = true;
      try {
        const page = await fetchCrewMemberPage(
          props.crewId,
          props.userId,
          props.generation,
          null,
          state.controller.signal
        );
        if (state.controller.signal.aborted || props.generation !== getAuthGeneration()) return;
        state.items = page.items;
        state.cursor = page.nextCursor;
        state.more = !!page.nextCursor;
        if (page.nextCursor) state.seen.add(page.nextCursor);
        setItems(page.items);
        setTotal(page.total);
        setCanManage(page.canManageMembers);
        setCanManagePermissions(page.canManagePermissions);
        setCanTransfer(page.canTransferOwnership);
        setMore(state.more);
      } catch (e) {
        if (!state.controller.signal.aborted && props.generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      } finally {
        state.busy = false;
        if (!state.controller.signal.aborted && props.generation === getAuthGeneration())
          setBusy(false);
      }
    }
  }, [props.crewId, props.userId, props.generation]);
  const loadMore = async () => {
    const state = session.current;
    if (!state || state.busy || !state.more || props.generation !== getAuthGeneration()) return;
    state.busy = true;
    setBusy(true);
    setError(undefined);
    try {
      const page = await fetchCrewMemberPage(
        props.crewId,
        props.userId,
        props.generation,
        state.cursor,
        state.controller.signal
      );
      if (state.controller.signal.aborted || props.generation !== getAuthGeneration()) return;
      if (
        (page.nextCursor && state.seen.has(page.nextCursor)) ||
        page.items.some((m) =>
          state.items.some((old) => old.id === m.id || old.userId === m.userId)
        )
      )
        throw new Error("Crew membership changed. Refresh the directory.");
      if (page.nextCursor) state.seen.add(page.nextCursor);
      state.cursor = page.nextCursor;
      state.more = !!page.nextCursor;
      state.items = [...state.items, ...page.items];
      setItems(state.items);
      setTotal(page.total);
      setCanManage(page.canManageMembers);
      setCanManagePermissions(page.canManagePermissions);
      setCanTransfer(page.canTransferOwnership);
      setMore(state.more);
    } catch (e) {
      if (!state.controller.signal.aborted && props.generation === getAuthGeneration()) {
        setItems([]);
        state.items = [];
        state.cursor = null;
        state.seen.clear();
        state.more = false;
        setMore(false);
        setTotal(undefined);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      state.busy = false;
      if (!state.controller.signal.aborted && props.generation === getAuthGeneration())
        setBusy(false);
    }
  };
  const displays = useUserDisplays(
    String(props.generation),
    items.map((m) => m.userId)
  );
  if (transferring)
    return (
      <CrewOwnershipTransfer
        {...props}
        member={transferring}
        name={displays?.get(transferring.userId)?.nickname || transferring.userId}
        onClose={props.refresh}
        onSuccess={props.onTransferComplete}
      />
    );
  if (editingAccess)
    return (
      <CrewMemberAccess
        {...props}
        member={editingAccess}
        name={displays?.get(editingAccess.userId)?.nickname || editingAccess.userId}
        onClose={props.refresh}
      />
    );
  if (editingPositions)
    return (
      <CrewMemberPositions
        {...props}
        member={editingPositions}
        name={displays?.get(editingPositions.userId)?.nickname || editingPositions.userId}
        onClose={props.refresh}
      />
    );
  if (removing)
    return (
      <CrewMemberRemoval
        {...props}
        member={removing}
        name={displays?.get(removing.userId)?.nickname || removing.userId}
        onClose={props.refresh}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{props.title}</ThemedText>
      {total !== undefined && (
        <ThemedText>
          {t("crewMembers.loaded")
            .replace("{count}", String(items.length))
            .replace("{total}", String(total))}
        </ThemedText>
      )}
      {items.map((member) => (
        <View
          key={member.id}
          style={{ padding: 12, gap: 6, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          <ThemedText type="smallBold">
            {displays?.get(member.userId)?.nickname || member.userId}
          </ThemedText>
          <ThemedText>
            {t("crewMembers.userId")}: {member.userId}
          </ThemedText>
          {member.isOwner && <ThemedText>{t("crewMembers.owner")}</ThemedText>}
          {member.policyKeys.map((policy) => (
            <ThemedText key={policy}>{t(`crewMembers.${policy}`)}</ThemedText>
          ))}
          <ThemedText>
            {t("crewMembers.joined")}: {new Date(member.joinedAt).toLocaleDateString()}
          </ThemedText>
          {canManage && (
            <Button
              label={t("memberPositions.title")}
              disabled={busy}
              onPress={() => {
                if (props.generation === getAuthGeneration()) setEditingPositions(member);
              }}
            />
          )}
          {canTransfer && !member.isOwner && member.userId !== props.userId && (
            <Button
              label={t("crewTransfer.title")}
              disabled={busy}
              onPress={() => {
                if (props.generation === getAuthGeneration()) setTransferring(member);
              }}
            />
          )}
          {canManagePermissions && !member.isOwner && (
            <Button
              label={t("memberAccess.title")}
              disabled={busy}
              onPress={() => {
                if (props.generation === getAuthGeneration()) setEditingAccess(member);
              }}
            />
          )}
          {canManage && !member.isOwner && (
            <Button
              label={t("crewMembers.remove")}
              disabled={busy}
              onPress={() => {
                if (props.generation === getAuthGeneration()) setRemoving(member);
              }}
            />
          )}
          {member.positions.length === 0 && <ThemedText>{t("crewMembers.noPosition")}</ThemedText>}
          {member.positions.map((position) => (
            <ThemedText key={position.id}>
              {position.title ||
                crewPositionLabel(position.categoryKey || "", t) ||
                t("crewMembers.noPosition")}
              {position.isPrimary ? ` · ${t("crewMembers.primary")}` : ""}
            </ThemedText>
          ))}
        </View>
      ))}
      {!busy && !error && !more && items.length === 0 && (
        <ThemedText>{t("crewMembers.empty")}</ThemedText>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy && <ActivityIndicator />}
      {more && !error && (
        <Button label={t("crewAssets.more")} disabled={busy} onPress={() => void loadMore()} />
      )}
      <Button label={t("thread.refresh")} disabled={busy} onPress={props.refresh} />
      <Button label={t("crewTasks.back")} onPress={props.onClose} />
    </ScrollView>
  );
}
function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
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
        backgroundColor: theme.backgroundElement,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
