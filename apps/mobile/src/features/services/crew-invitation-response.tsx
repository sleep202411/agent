import { crewPositionLabel } from "@/lib/crew-position-label";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import {
  fetchCrewInvitationResponse,
  respondToCrewInvitation,
  type CrewInvitationResponse as Invitation,
} from "./crew-invitation-response-api";
type Props = {
  invitationId: string;
  userId: string;
  generation: number;
  onOpenCrew: (crewId: string) => void;
};
export function CrewInvitationResponse(props: Props) {
  return <Session key={`${props.invitationId}:${props.userId}:${props.generation}`} {...props} />;
}
function Session(props: Props) {
  const t = useTranslations(),
    locale = useLocale();
  const [row, setRow] = useState<Invitation>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [now, setNow] = useState(Date.now);
  const pending = useRef(false),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchCrewInvitationResponse(
      props.invitationId,
      props.userId,
      props.generation,
      c.signal
    ).then(
      (value) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setRow(value);
      },
      (cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      c.abort();
      clearInterval(timer);
    };
  }, [props.invitationId, props.userId, props.generation, revision]);
  const decide = async (action: "accept" | "decline") => {
    const c = controller.current;
    if (
      !row ||
      !c ||
      c.signal.aborted ||
      pending.current ||
      props.generation !== getAuthGeneration()
    )
      return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await respondToCrewInvitation(row, props.userId, props.generation, action, c.signal);
      if (!c.signal.aborted && props.generation === getAuthGeneration()) {
        if (action === "accept") props.onOpenCrew(row.crewId);
        else {
          setRow(undefined);
          setRevision((n) => n + 1);
        }
      }
    } catch (cause) {
      if (!c.signal.aborted && props.generation === getAuthGeneration()) {
        // A lost response may have committed. Require a fresh GET before another decision.
        setRow(undefined);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      pending.current = false;
      if (!c.signal.aborted && props.generation === getAuthGeneration()) setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("crewInvitations.eyebrow")}</ThemedText>
      {!row && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {row && (
        <>
          {row.crew.logo && /^https:\/\//i.test(row.crew.logo) && (
            <Image
              source={{ uri: row.crew.logo }}
              accessibilityLabel={row.crew.name}
              style={{ width: 64, height: 64, borderRadius: 8 }}
            />
          )}
          <ThemedText>{row.crew.name}</ThemedText>
          {row.positionCategory && (
            <ThemedText>
              {t("teamInvites.assignedPosition")} · {crewPositionLabel(row.positionCategory, t)}
            </ThemedText>
          )}
          {row.policyKeys?.map((p) => (
            <ThemedText key={p}>{t(`crewMembers.${p}`)}</ThemedText>
          ))}
          <ThemedText>{row.crew.tagline || t("crewInvitations.body")}</ThemedText>
          <ThemedText>
            {t("crewInvitations.expires")} · {new Date(row.expiresAt).toLocaleString(locale)}
          </ThemedText>
          <ThemedText>
            {t(
              `crewInvitations.status.${row.status === "pending" && Date.parse(row.expiresAt) <= now ? "expired" : row.status}`
            )}
          </ThemedText>
          {row.agreementRequest && (
            <>
              <ThemedText>
                {t("crewInvitations.agreementOptional")} · {row.agreementRequest.title}
              </ThemedText>
              <ThemedText>
                {row.agreementRequest.signerName} · {row.agreementRequest.signerEmail}
              </ThemedText>
              <ThemedText>
                {t(
                  row.agreementRequest.agreementId
                    ? "crewInvitations.agreementQueued"
                    : "crewInvitations.agreementAfterAccept"
                )}
              </ThemedText>
            </>
          )}
          {row.status === "pending" && Date.parse(row.expiresAt) > now && (
            <>
              <Action
                busy={busy}
                label={t("crewInvitations.accept")}
                onPress={() => void decide("accept")}
              />
              <Action
                busy={busy}
                label={t("crewInvitations.decline")}
                onPress={() => void decide("decline")}
              />
            </>
          )}
          {row.status === "accepted" && (
            <Action
              busy={busy}
              label={t("crewTasks.title")}
              onPress={() => {
                if (props.generation === getAuthGeneration()) props.onOpenCrew(row.crewId);
              }}
            />
          )}
        </>
      )}
      {busy && <ActivityIndicator />}
      <Action
        busy={busy}
        label={t("thread.refresh")}
        onPress={() => {
          if (!pending.current) {
            setRow(undefined);
            setError(undefined);
            setRevision((n) => n + 1);
          }
        }}
      />
    </ScrollView>
  );
}

function Action({ label, onPress, busy }: { label: string; onPress: () => void; busy: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      accessibilityState={{ disabled: busy }}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.border,
        opacity: busy ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
