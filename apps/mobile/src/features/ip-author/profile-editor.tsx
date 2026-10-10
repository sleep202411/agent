import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTranslations } from "@/i18n";
import { invalidateBrowse } from "@/data/browse-refresh";
import { ApiRequestError } from "@/lib/api-client";
import {
  fetchIpProfile,
  fetchProfileGenres,
  profileMatches,
  profileCommand,
  profileOutbox,
  profileRecovery,
  saveIpProfile,
  type IpProfile,
  type ProfileCommand,
} from "./profile-api";
type Props = { ipId: string; userId: string; generation: number };
export function IpProfileEditor(props: Props) {
  const focused = useIsFocused();
  return focused && getAuthGeneration() === props.generation ? (
    <Session key={JSON.stringify(props)} {...props} />
  ) : null;
}
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
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
function Session(props: Props) {
  const [revision, setRevision] = useState(0);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Editor key={revision} {...props} refresh={() => setRevision((v) => v + 1)} />
    </ScrollView>
  );
}
function Editor({ ipId, userId, generation, refresh }: Props & { refresh: () => void }) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(ipId, true);
  const [outbox] = useState(() => profileOutbox(ipId, userId, generation));
  const [recovery] = useState(() => profileRecovery(ipId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), recovered: recovery.read(), error: "" };
    } catch (e) {
      return { pending: null, recovered: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState<ProfileCommand | null>(initial.pending ?? null);
  const [profile, setProfile] = useState<IpProfile>();
  const [draft, setDraft] = useState<ProfileCommand>();
  const [genres, setGenres] = useState<{ code: string; label: string }[]>([]);
  const [error, setError] = useState(initial.error),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void Promise.all([fetchIpProfile(ipId, generation, c.signal), fetchProfileGenres(c.signal)])
      .then(([ip, options]) => {
        if (c.signal.aborted) return;
        setProfile(ip);
        setGenres(options);
        setDraft(
          initial.pending ??
            initial.recovered ?? { ...ip, clientKey: uuid.v4(), expectedVersion: ip.version }
        );
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message ?? e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [ipId, generation, initial]);
  const needsReview =
    !!profile &&
    !!draft &&
    !pending &&
    (draft.expectedVersion !== profile.version || draft.sourceLocale !== profile.sourceLocale);
  const frozen = op.busy || !!pending || !!initial.error || needsReview;
  const submit = () => {
    const c = controller.current;
    if (!active || !draft || !c || c.signal.aborted || needsReview) return;
    void op.run(
      async () => {
        const command = profileCommand.parse(pending ?? draft);
        outbox.save(command);
        setPending(command);
        setError("");
        setSaved(false);
        try {
          const result = await saveIpProfile(ipId, generation, command, c.signal);
          outbox.clear(command.clientKey);
          recovery.clear(command.clientKey);
          return result;
        } catch (e) {
          if (e instanceof ApiRequestError && [400, 401, 403, 404, 409, 422].includes(e.status)) {
            if ([401, 403, 404, 409].includes(e.status)) {
              setProfile(undefined);
              setDraft(undefined);
            }
            // Persist before clearing the request: a rejected write still contains useful edits.
            recovery.save(command);
            outbox.clear(command.clientKey);
            setPending(null);
          }
          throw e;
        }
      },
      (result) => {
        setProfile(result);
        setDraft({ ...result, clientKey: uuid.v4(), expectedVersion: result.version });
        setPending(null);
        setSaved(true);
        invalidateBrowse();
      },
      (e) => setError(String(e instanceof Error ? e.message : e))
    );
  };
  const inputStyle = {
    color: theme.text,
    backgroundColor: theme.backgroundElement,
    padding: 12,
    borderRadius: 8,
  };
  if (!active) return null;
  return (
    <View style={{ gap: 12 }}>
      {loading ? <ActivityIndicator /> : null}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipAuthor.saved")}</ThemedText>}
      <Button label={t("thread.refresh")} disabled={op.busy || loading} onPress={refresh} />
      {profile && draft ? (
        <>
          {needsReview && (
            <View
              style={{
                gap: 8,
                padding: 12,
                backgroundColor: theme.backgroundElement,
                borderRadius: 8,
              }}
            >
              <ThemedText type="smallBold">{t("ipAuthor.conflictReview")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t("ipAuthor.conflictHelp")}
              </ThemedText>
              <ThemedText selectable>{profile.title}</ThemedText>
              <ThemedText selectable>{profile.summary}</ThemedText>
              {!!profile.description && <ThemedText selectable>{profile.description}</ThemedText>}
              <ThemedText>
                {profile.sourceLocale} · {t(`ipAuthor.${profile.listingVisibility}`)} ·{" "}
                {t(`ipAuthor.${profile.ageRating}`)} · {profile.genreCodes.join(", ")}
              </ThemedText>
              <Button
                label={t("ipAuthor.keepDraft")}
                disabled={op.busy || !!initial.error}
                onPress={() => {
                  try {
                    const next = {
                      ...draft,
                      expectedVersion: profile.version,
                      sourceLocale: profile.sourceLocale,
                    };
                    recovery.save(next);
                    setDraft(next);
                    setError("");
                  } catch (e) {
                    setError(String(e instanceof Error ? e.message : e));
                  }
                }}
              />
            </View>
          )}
          <ThemedText>
            {t("ipAuthor.source")}: {profile.sourceLocale}
          </ThemedText>
          <ThemedText>
            {t("ipAuthor.status")}: {profile.status}
          </ThemedText>
          {(["title", "summary", "description"] as const).map((field) => (
            <View key={field} style={{ gap: 6 }}>
              <ThemedText>{t(`ipAuthor.${field}`)}</ThemedText>
              <TextInput
                accessibilityLabel={t(`ipAuthor.${field}`)}
                value={draft[field] ?? ""}
                editable={!frozen}
                multiline={field !== "title"}
                maxLength={field === "title" ? 80 : field === "summary" ? 280 : 3000}
                style={inputStyle}
                onChangeText={(value) =>
                  setDraft({ ...draft, [field]: field === "description" ? value || null : value })
                }
              />
            </View>
          ))}
          <ThemedText>{t("ipAuthor.visibility")}</ThemedText>
          {(["private", "unlisted", "public"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: draft.listingVisibility === value, disabled: frozen }}
              disabled={frozen}
              onPress={() => setDraft({ ...draft, listingVisibility: value })}
              style={{
                padding: 12,
                borderRadius: 8,
                backgroundColor:
                  draft.listingVisibility === value ? theme.backgroundElement : undefined,
              }}
            >
              <ThemedText>
                {draft.listingVisibility === value ? "● " : "○ "}
                {t(`ipAuthor.${value}`)}
              </ThemedText>
            </Pressable>
          ))}
          <ThemedText>{t("ipAuthor.age")}</ThemedText>
          {(["general", "teen", "mature", "restricted"] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: draft.ageRating === value, disabled: frozen }}
              disabled={frozen}
              onPress={() => setDraft({ ...draft, ageRating: value })}
              style={{
                padding: 12,
                borderRadius: 8,
                backgroundColor: draft.ageRating === value ? theme.backgroundElement : undefined,
              }}
            >
              <ThemedText>
                {draft.ageRating === value ? "● " : "○ "}
                {t(`ipAuthor.${value}`)}
              </ThemedText>
            </Pressable>
          ))}
          <ThemedText>{t("ipAuthor.genres")}</ThemedText>
          {Array.from(
            new Map(
              [...draft.genreCodes.map((code) => ({ code, label: code })), ...genres].map(
                (item) => [item.code, item]
              )
            ).values()
          ).map((item) => (
            <Pressable
              key={item.code}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: draft.genreCodes.includes(item.code),
                disabled: frozen,
              }}
              disabled={frozen}
              onPress={() =>
                setDraft({
                  ...draft,
                  genreCodes: draft.genreCodes.includes(item.code)
                    ? draft.genreCodes.filter((code) => code !== item.code)
                    : [...draft.genreCodes, item.code],
                })
              }
              style={{ padding: 8 }}
            >
              <ThemedText>
                {draft.genreCodes.includes(item.code) ? "☑ " : "☐ "}
                {item.label}
              </ThemedText>
            </Pressable>
          ))}
          {pending && <ThemedText>{t("ipAuthor.pending")}</ThemedText>}
          <Button
            label={pending ? t("common.retry") : t("ipAuthor.save")}
            disabled={
              op.busy ||
              !!initial.error ||
              needsReview ||
              !profileCommand.safeParse(draft).success ||
              (!pending && profileMatches(profile, draft))
            }
            onPress={submit}
          />
        </>
      ) : null}
    </View>
  );
}
