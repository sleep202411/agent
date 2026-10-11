import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { uuid } from "expo-modules-core";
import { REGIONS, regionLabel } from "@repo/shared";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useLocale, useTranslations } from "@/i18n";
import { invalidateBrowse } from "@/data/browse-refresh";
import { ApiRequestError } from "@/lib/api-client";
import { fetchProfileGenres } from "./profile-api";
import { createCommand, createIp, createOutbox, type CreateCommand } from "./create-api";
import { analyzeIpDocument } from "./spark-api";
type Props = { userId: string; generation: number; onCreated: (id: string) => void };
export function IpCreateForm(props: Props) {
  const focused = useIsFocused();
  return focused && getAuthGeneration() === props.generation ? (
    <Session key={`${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session({ userId, generation, onCreated }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const op = useAuthFormOperation("ip-create", true),
    analysis = useAuthFormOperation("ip-analyze", true);
  const [outbox] = useState(() => createOutbox(userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState<CreateCommand | null>(initial.pending ?? null);
  const [draft, setDraft] = useState<
    CreateCommand & { suggested?: Partial<Record<"title" | "summary", boolean>> }
  >(
    () =>
      initial.pending ?? {
        clientKey: uuid.v4(),
        title: "",
        summary: "",
        genreCodes: [],
        sourceLocale: locale,
        region: "",
        channelType: "ip",
      }
  );
  const [error, setError] = useState(initial.error);
  const [genreResult, setGenreResult] = useState<{
    key: string;
    items: { code: string; label: string }[];
    error: string;
  }>();
  const [reload, setReload] = useState(0),
    [regionsOpen, setRegionsOpen] = useState(false),
    [analyzed, setAnalyzed] = useState("");
  const requestKey = `${locale}:${reload}`;
  const loading = genreResult?.key !== requestKey;
  const genres = loading ? [] : genreResult.items;
  const genreError = loading ? "" : genreResult.error;
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    return () => c.abort();
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void fetchProfileGenres(c.signal)
      .then((items) => {
        if (!c.signal.aborted) setGenreResult({ key: requestKey, items, error: "" });
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setGenreResult({ key: requestKey, items: [], error: String(e.message ?? e) });
      });
    return () => c.abort();
  }, [requestKey]);
  const frozen = op.busy || !!pending || !!initial.error;
  const analyze = () => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    setError("");
    void analysis.run(
      () => analyzeIpDocument(generation, signal),
      (result) => {
        if (!result) return;
        setAnalyzed(result.fileName);
        setDraft((current) => ({
          ...current,
          suggested: {
            title: (!current.title.trim() && !!result.name) || current.suggested?.title,
            summary:
              (!current.summary.trim() && !!result.description) || current.suggested?.summary,
          },
          title: current.title.trim() ? current.title : (result.name ?? "").slice(0, 80),
          summary: current.summary.trim()
            ? current.summary
            : (result.description ?? "").slice(0, 280),
        }));
      },
      (e) => setError(String(e instanceof Error ? e.message : e))
    );
  };
  const submit = () => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    void op.run(
      async () => {
        const command = createCommand.parse(pending ?? draft);
        outbox.save(command);
        setPending(command);
        setError("");
        try {
          const id = await createIp(userId, generation, command, signal);
          outbox.clear(command.clientKey);
          return id;
        } catch (e) {
          if (e instanceof ApiRequestError && [400, 401, 403, 404, 409, 422].includes(e.status)) {
            outbox.clear(command.clientKey);
            setPending(null);
            setDraft((value) => ({ ...value, clientKey: uuid.v4() }));
          }
          throw e;
        }
      },
      (id) => {
        invalidateBrowse();
        onCreated(id);
      },
      (e) => setError(String(e instanceof Error ? e.message : e))
    );
  };
  if (!active) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Button label={t("ipCreate.analyze")} onPress={analyze} disabled={frozen || analysis.busy} />
      <ThemedText type="small" themeColor="textSecondary">
        {t("ipCreate.documentHint")}
      </ThemedText>
      {analysis.busy && <ActivityIndicator />}
      {!!analyzed && (
        <View>
          <ThemedText>{analyzed}</ThemedText>
          <Button
            label={t("ipCreate.clearAnalysis")}
            disabled={frozen || analysis.busy}
            onPress={() => {
              setAnalyzed("");
              setDraft((current) => ({
                ...current,
                title: current.suggested?.title ? "" : current.title,
                summary: current.suggested?.summary ? "" : current.summary,
                suggested: {},
              }));
            }}
          />
        </View>
      )}
      <ThemedText>{t("ipCreate.channel")}</ThemedText>
      {(["ip", "community"] as const).map((value) => (
        <Pressable
          key={value}
          accessibilityRole="radio"
          accessibilityState={{ checked: draft.channelType === value, disabled: frozen }}
          disabled={frozen}
          onPress={() => setDraft({ ...draft, channelType: value })}
          style={{ padding: 12 }}
        >
          <ThemedText>
            {draft.channelType === value ? "● " : "○ "}
            {t(`ipCreate.${value}`)}
          </ThemedText>
        </Pressable>
      ))}
      {(["title", "summary"] as const).map((field) => (
        <View key={field} style={{ gap: 6 }}>
          <ThemedText>{t(`ipAuthor.${field}`)}</ThemedText>
          <TextInput
            accessibilityLabel={t(`ipAuthor.${field}`)}
            value={draft[field]}
            editable={!frozen}
            maxLength={field === "title" ? 80 : 280}
            multiline={field === "summary"}
            onChangeText={(value) =>
              setDraft((current) => ({
                ...current,
                [field]: value,
                suggested: { ...current.suggested, [field]: false },
              }))
            }
            style={{
              padding: 12,
              borderRadius: 8,
              color: theme.text,
              backgroundColor: theme.backgroundElement,
            }}
          />
        </View>
      ))}
      <ThemedText>
        {t("ipAuthor.source")}: {draft.sourceLocale}
      </ThemedText>
      <ThemedText>{t("ipAuthor.genres")}</ThemedText>
      {loading && <ActivityIndicator />}
      {!!genreError && (
        <>
          <ThemedText accessibilityRole="alert">{genreError}</ThemedText>
          <Button
            label={t("common.retry")}
            onPress={() => setReload((v) => v + 1)}
            disabled={loading}
          />
        </>
      )}
      {!loading && !genreError && !genres.length && (
        <View>
          <ThemedText>{t("ipCreate.noGenres")}</ThemedText>
          <Button label={t("thread.refresh")} onPress={() => setReload((v) => v + 1)} />
        </View>
      )}
      {Array.from(
        new Map(
          [...draft.genreCodes.map((code) => ({ code, label: code })), ...genres].map((item) => [
            item.code,
            item,
          ])
        ).values()
      ).map((item) => {
        const selected = draft.genreCodes.includes(item.code),
          disabled = frozen || (!selected && draft.genreCodes.length >= 8);
        return (
          <Pressable
            key={item.code}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() =>
              setDraft({
                ...draft,
                genreCodes: selected
                  ? draft.genreCodes.filter((code) => code !== item.code)
                  : [...draft.genreCodes, item.code],
              })
            }
            style={{ padding: 12 }}
          >
            <ThemedText>
              {selected ? "☑ " : "☐ "}
              {item.label}
            </ThemedText>
          </Pressable>
        );
      })}
      <Button
        label={`${t("ipCreate.region")}: ${draft.region ? regionLabel(draft.region, locale) : t("ipCreate.unspecified")}`}
        onPress={() => setRegionsOpen((v) => !v)}
        disabled={frozen}
      />
      {regionsOpen && (
        <View>
          {[{ code: "" }, ...REGIONS].map((item) => (
            <Pressable
              key={item.code}
              accessibilityRole="radio"
              accessibilityState={{ checked: draft.region === item.code, disabled: frozen }}
              disabled={frozen}
              onPress={() => {
                setDraft({ ...draft, region: item.code });
                setRegionsOpen(false);
              }}
              style={{ padding: 12 }}
            >
              <ThemedText>
                {draft.region === item.code ? "● " : "○ "}
                {item.code ? regionLabel(item.code, locale) : t("ipCreate.unspecified")}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
      {!!pending && <ThemedText>{t("ipCreate.pending")}</ThemedText>}
      <Button
        label={pending ? t("common.retry") : t("ipCreate.submit")}
        onPress={submit}
        disabled={
          op.busy || analysis.busy || !!initial.error || !createCommand.safeParse(draft).success
        }
      />
    </ScrollView>
  );
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
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
