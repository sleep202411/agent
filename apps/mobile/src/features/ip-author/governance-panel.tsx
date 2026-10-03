import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ApiRequestError } from "@/lib/api-client";
import { invalidateBrowse } from "@/data/browse-refresh";
import {
  fetchGovernance,
  governanceCommand,
  governanceKinds,
  governanceMatches,
  governanceOutbox,
  releaseLink,
  saveGovernance,
  type GovernanceCommand,
  type GovernanceKind,
  type GovernanceSnapshot,
} from "./governance-api";
import { IpProductionPanel } from "./production-panel";
import type { ProductionKind } from "./production-api";
type Props = {
  ipId: string;
  userId: string;
  generation: number;
  initialKind?: GovernanceKind;
  suggestedCrewId?: string;
};
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
function draftFrom(value: GovernanceSnapshot): GovernanceCommand {
  return {
    kind: value.kind,
    data: value.data,
    expectedVersion: value.version,
    clientKey: uuid.v4(),
  } as GovernanceCommand;
}
export function IpGovernancePanel(props: Props) {
  return useIsFocused() && getAuthGeneration() === props.generation ? (
    <Session key={`${props.ipId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme();
  const [kind, setKind] = useState<GovernanceKind | ProductionKind>(
    props.initialKind ?? "disclosures"
  );
  return (
    <View style={{ flex: 1, display: active ? "flex" : "none" }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8 }}>
        {([...governanceKinds, "games", "stages"] as const).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: kind === item }}
            onPress={() => setKind(item)}
            style={{
              padding: 12,
              borderRadius: 8,
              backgroundColor: item === kind ? theme.backgroundElement : undefined,
            }}
          >
            <ThemedText type="small">{t(`ipGovernance.${item}`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      {kind === "games" || kind === "stages" ? (
        <IpProductionPanel key={kind} {...props} kind={kind} />
      ) : (
        <Editor key={kind} {...props} kind={kind} />
      )}
    </View>
  );
}
function Editor({
  ipId,
  userId,
  generation,
  kind,
  suggestedCrewId,
}: Props & { kind: GovernanceKind }) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(`${ipId}:${kind}`, true);
  const [outbox] = useState(() => governanceOutbox(ipId, userId, generation, kind));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [snapshot, setSnapshot] = useState<GovernanceSnapshot>();
  const [draft, setDraft] = useState<GovernanceCommand>(),
    [error, setError] = useState(initial.error);
  const [loading, setLoading] = useState(true),
    [saved, setSaved] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [confirm, setConfirm] = useState<"apply" | "discard" | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchGovernance(ipId, generation, kind, c.signal)
      .then((value) => {
        if (c.signal.aborted) return;
        setSnapshot(value);
        const next = draftFrom(value);
        if (
          next.kind === "crew" &&
          value.kind === "crew" &&
          value.choices.some((item) => item.id === suggestedCrewId)
        )
          next.data = { crewId: suggestedCrewId! };
        setDraft(initial.pending ?? next);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message ?? e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [ipId, generation, kind, initial, suggestedCrewId]);
  const failure = (e: unknown) => {
    setError(String(e instanceof Error ? e.message : e));
    if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
      setSnapshot(undefined);
      setDraft(undefined);
      setReviewed(false);
      setConfirm(null);
    }
  };
  const refresh = () => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setReviewed(false);
    setConfirm(null);
    void op.run(
      () => fetchGovernance(ipId, generation, kind, signal),
      (value) => {
        setSnapshot(value);
        setDraft(pending ?? draftFrom(value));
        setReviewed(true);
        setError(initial.error);
        setSaved(false);
      },
      failure
    );
  };
  const submit = (input: GovernanceCommand, rebase = false) => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setSaved(false);
    setError("");
    setReviewed(false);
    setConfirm(null);
    void op.run(
      async () => {
        const command = governanceCommand.parse(input);
        if (rebase) {
          if (!pending) throw new Error("No pending IP change to review.");
          outbox.rebase(command, pending.clientKey);
        } else outbox.save(command);
        setPending(command);
        setDraft(command);
        const result = await saveGovernance(ipId, generation, command, signal);
        outbox.clear(command.clientKey);
        return result;
      },
      (value) => {
        setSnapshot(value);
        setDraft(draftFrom(value));
        setPending(null);
        setSaved(true);
        invalidateBrowse();
      },
      failure
    );
  };
  const frozen = loading || op.busy || !!pending || !!initial.error;
  const parsed = draft ? governanceCommand.safeParse(draft) : null;
  const conflict =
    pending &&
    snapshot &&
    snapshot.version > pending.expectedVersion &&
    !governanceMatches(snapshot, pending);
  const inputStyle = {
    color: theme.text,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.backgroundElement,
  };
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
    >
      {(loading || op.busy) && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipGovernance.saved")}</ThemedText>}
      <Button label={t("ipGovernance.refresh")} disabled={loading || op.busy} onPress={refresh} />
      {snapshot && draft && (
        <>
          {draft.kind === "disclosures" && (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {t("ipGovernance.disclosureHint")}
              </ThemedText>
              <ThemedText>{t("ipGovernance.copyrightOwner")}</ThemedText>
              <TextInput
                accessibilityLabel={t("ipGovernance.copyrightOwner")}
                editable={!frozen}
                maxLength={160}
                style={inputStyle}
                value={draft.data.copyrightOwner ?? ""}
                onChangeText={(value) =>
                  setDraft({ ...draft, data: { ...draft.data, copyrightOwner: value || null } })
                }
              />
              <ThemedText>{t("ipGovernance.rightsStatement")}</ThemedText>
              <TextInput
                accessibilityLabel={t("ipGovernance.rightsStatement")}
                editable={!frozen}
                multiline
                maxLength={1000}
                style={inputStyle}
                value={draft.data.rightsSummary.statement}
                onChangeText={(statement) =>
                  setDraft({ ...draft, data: { ...draft.data, rightsSummary: { statement } } })
                }
              />
              {(["generatedVisuals", "generatedCopy"] as const).map((field) => (
                <Pressable
                  key={field}
                  accessibilityRole="checkbox"
                  disabled={frozen}
                  accessibilityState={{ checked: draft.data.aiDisclosure[field], disabled: frozen }}
                  style={{ padding: 12 }}
                  onPress={() =>
                    setDraft({
                      ...draft,
                      data: {
                        ...draft.data,
                        aiDisclosure: {
                          ...draft.data.aiDisclosure,
                          [field]: !draft.data.aiDisclosure[field],
                        },
                      },
                    })
                  }
                >
                  <ThemedText type="small">
                    {draft.data.aiDisclosure[field] ? "☑ " : "☐ "}
                    {t(`ipGovernance.${field}`)}
                  </ThemedText>
                </Pressable>
              ))}
              <ThemedText>{t("ipGovernance.aiStatement")}</ThemedText>
              <TextInput
                accessibilityLabel={t("ipGovernance.aiStatement")}
                editable={!frozen}
                multiline
                maxLength={1000}
                style={inputStyle}
                value={draft.data.aiDisclosure.statement}
                onChangeText={(statement) =>
                  setDraft({
                    ...draft,
                    data: {
                      ...draft.data,
                      aiDisclosure: { ...draft.data.aiDisclosure, statement },
                    },
                  })
                }
              />
            </>
          )}
          {draft.kind === "links" && (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {t("ipGovernance.linksHint")}
              </ThemedText>
              {!draft.data.links.length && <ThemedText>{t("ipGovernance.noLinks")}</ThemedText>}
              {draft.data.links.map((link, index) => (
                <View key={index} style={{ gap: 8, paddingVertical: 8 }}>
                  {(["label", "url"] as const).map((field) => (
                    <View key={field}>
                      <ThemedText>
                        {t(`ipGovernance.${field}`)} {index + 1}
                      </ThemedText>
                      <TextInput
                        accessibilityLabel={`${t(`ipGovernance.${field}`)} ${index + 1}`}
                        value={link[field]}
                        editable={!frozen}
                        maxLength={field === "label" ? 80 : 2000}
                        autoCapitalize={field === "url" ? "none" : "sentences"}
                        autoCorrect={field !== "url"}
                        keyboardType={field === "url" ? "url" : "default"}
                        style={inputStyle}
                        onChangeText={(value) =>
                          setDraft({
                            ...draft,
                            data: {
                              links: draft.data.links.map((item, i) =>
                                i === index ? { ...item, [field]: value } : item
                              ),
                            },
                          })
                        }
                      />
                    </View>
                  ))}
                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    <Button
                      label={t("ipGovernance.removeLink")}
                      disabled={frozen}
                      onPress={() =>
                        setDraft({
                          ...draft,
                          data: { links: draft.data.links.filter((_, i) => i !== index) },
                        })
                      }
                    />
                    <Button
                      label={t("ipGovernance.openLink")}
                      disabled={frozen || !releaseLink.safeParse(link).success}
                      onPress={() => {
                        const value = releaseLink.safeParse(link);
                        if (!value.success) return;
                        void Linking.openURL(value.data.url).catch((e) => {
                          if (
                            !controller.current?.signal.aborted &&
                            getAuthGeneration() === generation
                          )
                            failure(e);
                        });
                      }}
                    />
                  </View>
                </View>
              ))}
              <Button
                label={t("ipGovernance.addLink")}
                disabled={frozen || draft.data.links.length >= 20}
                onPress={() =>
                  setDraft({
                    ...draft,
                    data: { links: [...draft.data.links, { label: "", url: "" }] },
                  })
                }
              />
              {parsed && !parsed.success && (
                <ThemedText accessibilityRole="alert">{t("ipGovernance.invalidLinks")}</ThemedText>
              )}
            </>
          )}
          {draft.kind === "crew" && snapshot.kind === "crew" && (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {t("ipGovernance.crewHint")}
              </ThemedText>
              {suggestedCrewId && !snapshot.choices.some((item) => item.id === suggestedCrewId) && (
                <ThemedText accessibilityRole="alert" type="small">
                  {t("crewLinks.targetUnavailable")}
                </ThemedText>
              )}
              {snapshot.data.crewId &&
                draft.data.crewId &&
                snapshot.data.crewId !== draft.data.crewId && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t("crewLinks.linkedElsewhere")}
                  </ThemedText>
                )}
              {[
                { id: null, name: t("ipGovernance.noCrew") },
                ...(draft.data.crewId &&
                !snapshot.choices.some((item) => item.id === draft.data.crewId)
                  ? [{ id: draft.data.crewId, name: t("ipGovernance.existingCrew") }]
                  : []),
                ...snapshot.choices,
              ].map((item) => (
                <Pressable
                  key={item.id ?? "none"}
                  accessibilityRole="radio"
                  disabled={frozen}
                  accessibilityState={{ checked: draft.data.crewId === item.id, disabled: frozen }}
                  style={{
                    padding: 12,
                    backgroundColor:
                      draft.data.crewId === item.id ? theme.backgroundElement : undefined,
                    borderRadius: 8,
                  }}
                  onPress={() => setDraft({ ...draft, data: { crewId: item.id } })}
                >
                  <ThemedText>
                    {draft.data.crewId === item.id ? "● " : "○ "}
                    {item.name}
                  </ThemedText>
                </Pressable>
              ))}
            </>
          )}
          {!pending && (
            <Button
              label={t("ipGovernance.save")}
              disabled={frozen || !parsed?.success || governanceMatches(snapshot, draft)}
              onPress={() => {
                if (parsed?.success) submit(parsed.data);
              }}
            />
          )}
        </>
      )}
      {pending && (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("ipGovernance.pending")}</ThemedText>
          <Button
            label={t("common.retry")}
            disabled={loading || op.busy || !!initial.error}
            onPress={() => submit(pending)}
          />
          {conflict && reviewed && (
            <>
              <ThemedText>{t("ipGovernance.conflict")}</ThemedText>
              <View
                style={{
                  gap: 8,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: theme.backgroundElement,
                }}
              >
                <ThemedText type="smallBold">{t("ipGovernance.latestSaved")}</ThemedText>
                {snapshot.kind === "disclosures" && (
                  <>
                    <ThemedText type="small">
                      {t("ipGovernance.copyrightOwner")}: {snapshot.data.copyrightOwner || "—"}
                    </ThemedText>
                    <ThemedText type="small">
                      {t("ipGovernance.rightsStatement")}:{" "}
                      {snapshot.data.rightsSummary.statement || "—"}
                    </ThemedText>
                    <ThemedText type="small">
                      {snapshot.data.aiDisclosure.generatedVisuals ? "☑ " : "☐ "}
                      {t("ipGovernance.generatedVisuals")}
                    </ThemedText>
                    <ThemedText type="small">
                      {snapshot.data.aiDisclosure.generatedCopy ? "☑ " : "☐ "}
                      {t("ipGovernance.generatedCopy")}
                    </ThemedText>
                    <ThemedText type="small">
                      {t("ipGovernance.aiStatement")}: {snapshot.data.aiDisclosure.statement || "—"}
                    </ThemedText>
                  </>
                )}
                {snapshot.kind === "links" &&
                  (snapshot.data.links.length ? (
                    snapshot.data.links.map((item) => (
                      <View key={item.url}>
                        <ThemedText type="small">{item.label}</ThemedText>
                        <ThemedText type="small">{item.url}</ThemedText>
                      </View>
                    ))
                  ) : (
                    <ThemedText type="small">{t("ipGovernance.noLinks")}</ThemedText>
                  ))}
                {snapshot.kind === "crew" && (
                  <ThemedText type="small">
                    {snapshot.data.crewId === null
                      ? t("ipGovernance.noCrew")
                      : (snapshot.choices.find((item) => item.id === snapshot.data.crewId)?.name ??
                        t("ipGovernance.existingCrew"))}
                  </ThemedText>
                )}
              </View>
              <Button
                label={t("ipGovernance.reviewApply")}
                disabled={op.busy}
                onPress={() => setConfirm("apply")}
              />
            </>
          )}
          {snapshot && reviewed && (
            <Button
              label={t("ipGovernance.useSaved")}
              disabled={op.busy}
              onPress={() => setConfirm("discard")}
            />
          )}
          {confirm && snapshot && (
            <>
              <ThemedText>
                {t(confirm === "apply" ? "ipGovernance.applyHint" : "ipGovernance.discardHint")}
              </ThemedText>
              <Button
                label={t(
                  confirm === "apply" ? "ipGovernance.confirmApply" : "ipGovernance.confirmDiscard"
                )}
                disabled={op.busy}
                onPress={() => {
                  if (confirm === "apply")
                    submit(
                      { ...pending, expectedVersion: snapshot.version, clientKey: uuid.v4() },
                      true
                    );
                  else {
                    try {
                      outbox.clear(pending.clientKey);
                      setPending(null);
                      setDraft(draftFrom(snapshot));
                      setConfirm(null);
                      setError("");
                    } catch (e) {
                      failure(e);
                    }
                  }
                }}
              />
              <Button
                label={t("common.cancel")}
                disabled={op.busy}
                onPress={() => setConfirm(null)}
              />
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}
