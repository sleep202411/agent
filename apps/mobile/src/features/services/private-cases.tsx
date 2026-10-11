import { TaskCaseEntry } from "./task-case-entry";
import { useEffect, useRef, useState } from "react";
import { useIsFocused } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { CaseEvidence } from "./case-evidence";
import { ApiRequestError } from "@/lib/api-client";
import {
  fetchPrivateCases,
  fetchPrivateCase,
  caseOutbox,
  writePrivateCase,
  type PrivateCase,
  type PrivateCaseView,
  type CaseHistory,
  type CaseCommand,
} from "./private-cases-api";
type Props = { userId: string; generation: number; initialCaseId?: string };
function Action({
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
export function PrivateCases(props: Props) {
  const focused = useIsFocused();
  return focused && props.generation === getAuthGeneration() ? (
    <Session
      key={JSON.stringify([props.userId, props.generation, props.initialCaseId])}
      {...props}
    />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const theme = useTheme();
  const active = useScreenActive();
  const [lastActive, setLastActive] = useState(active);
  const [revision, setRevision] = useState(0);
  if (lastActive !== active) {
    setLastActive(active);
    if (active) setRevision((v) => v + 1);
  }
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(props.initialCaseId);
  const [view, setView] = useState<PrivateCaseView>("all");
  return (
    <View style={{ flex: 1, display: active ? "flex" : "none" }}>
      {creating ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <Action label={t("privateCases.back")} onPress={() => setCreating(false)} />
          <TaskCaseEntry userId={props.userId} generation={props.generation} />
        </ScrollView>
      ) : selected ? (
        <View style={{ flex: 1 }}>
          <Action label={t("privateCases.back")} onPress={() => setSelected(undefined)} />
          <Detail key={selected} {...props} caseId={selected} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <Action label={t("crewCases.newCase")} onPress={() => setCreating(true)} />
          <View
            accessibilityRole="tablist"
            style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16 }}
          >
            {(["all", "initiated", "responses"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                aria-selected={view === value}
                onPress={() => setView(value)}
                style={{
                  padding: 12,
                  borderBottomWidth: 2,
                  borderBottomColor: view === value ? theme.brand : "transparent",
                }}
              >
                <ThemedText>{t(`privateCases.view.${value}`)}</ThemedText>
              </Pressable>
            ))}
          </View>
          <Listing key={`${revision}:${view}`} {...props} view={view} onOpen={setSelected} />
        </View>
      )}
    </View>
  );
}
function Listing({
  userId,
  generation,
  onOpen,
  view,
}: Props & { onOpen: (id: string) => void; view: PrivateCaseView }) {
  const t = useTranslations();
  const [rows, setRows] = useState<PrivateCase[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void fetchPrivateCases(userId, generation, cursor, c.signal, view)
      .then((page) => {
        if (c.signal.aborted) return;
        setRows((old) =>
          cursor
            ? [...new Map([...old, ...page.items].map((row) => [row.id, row])).values()]
            : page.items
        );
        setNext(page.nextBeforeId);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setRows([]);
          setNext(null);
          setError(String(e.message ?? e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [userId, generation, cursor, revision, view]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
      <ThemedText>{t("privateCases.privacy")}</ThemedText>
      <Action
        label={t("thread.refresh")}
        disabled={loading}
        onPress={() => {
          setRows([]);
          setError("");
          setLoading(true);
          setCursor(null);
          setRevision((v) => v + 1);
        }}
      />
      {loading && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!loading && !error && !rows.length && <ThemedText>{t("privateCases.empty")}</ThemedText>}
      {rows.map((row) => (
        <View key={row.id}>
          <Action label={row.title} onPress={() => onOpen(row.id)} />
          <ThemedText>{t(`privateCases.${row.status}`)}</ThemedText>
        </View>
      ))}
      {next && (
        <Action
          label={t("crewTaskCenter.loadMore")}
          disabled={loading}
          onPress={() => {
            setLoading(true);
            setError("");
            setCursor(next);
          }}
        />
      )}
    </ScrollView>
  );
}
function Detail({ caseId, userId, generation }: Props & { caseId: string }) {
  const t = useTranslations(),
    locale = useLocale();
  const active = useScreenActive();
  const [lastActive, setLastActive] = useState(active);
  const [row, setRow] = useState<CaseHistory>(),
    [cursor, setCursor] = useState<number | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  if (lastActive !== active) {
    setLastActive(active);
    setLoading(true);
    setError("");
    setCursor(null);
  }
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    void fetchPrivateCase(caseId, userId, generation, cursor, c.signal)
      .then((page) => {
        if (c.signal.aborted) return;
        setRow((old) =>
          cursor && old
            ? {
                ...page,
                events: [
                  ...new Map([...old.events, ...page.events].map((e) => [e.id, e])).values(),
                ],
              }
            : page
        );
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(String(e.message ?? e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [caseId, userId, generation, cursor, revision, active]);
  const refresh = () => {
    setRow(undefined);
    setError("");
    setLoading(true);
    setCursor(null);
    setRevision((v) => v + 1);
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Action label={t("thread.refresh")} onPress={refresh} disabled={loading} />
      {loading && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {row && (
        <View style={{ display: active && !loading && !error ? "flex" : "none" }}>
          <ThemedText type="smallBold">{row.title}</ThemedText>
          {row.category && (
            <ThemedText>
              {t("crewTaskDispute.category")}: {t(`crewTaskDispute.categories.${row.category}`)}
            </ThemedText>
          )}
          {row.desiredResolution && (
            <ThemedText>
              {t("crewTaskDispute.desiredResolution")}:{" "}
              {t(`crewTaskDispute.resolutions.${row.desiredResolution}`)}
            </ThemedText>
          )}
          <ThemedText>
            {t(`privateCases.${row.status}`)} · {row.version}
          </ThemedText>
          <ThemedText>
            {row.openedByUserId} → {row.respondentUserId}
          </ThemedText>
          {row.events.map((e) => (
            <View key={e.id} style={{ gap: 4 }}>
              <ThemedText>
                {e.actorId} · {e.action} · {new Date(e.createdAt).toLocaleString(locale)}
              </ThemedText>
              <ThemedText selectable>{e.message}</ThemedText>
              {(e.submissionIds.length > 0 || e.attachmentIds.length > 0) && (
                <ThemedText>
                  {t("privateCases.evidenceRefs")} {e.submissionIds.length + e.attachmentIds.length}
                </ThemedText>
              )}
            </View>
          ))}
          {row.nextBeforeVersion && (
            <Action
              label={t("crewTaskCenter.loadMore")}
              disabled={loading}
              onPress={() => {
                setLoading(true);
                setError("");
                setCursor(row.nextBeforeVersion);
              }}
            />
          )}
          <Discussion
            key={`${row.id}:${revision}`}
            row={row}
            disabled={!active || loading || !!error}
            userId={userId}
            generation={generation}
            onRefresh={refresh}
          />
        </View>
      )}
    </ScrollView>
  );
}
function Discussion({
  row,
  disabled,
  userId,
  generation,
  onRefresh,
}: {
  row: PrivateCase;
  disabled: boolean;
  userId: string;
  generation: number;
  onRefresh: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(row.id, true);
  const [outbox] = useState(() => caseOutbox(row.id, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState<CaseCommand | null>(initial.pending ?? null),
    [message, setMessage] = useState(initial.pending?.message ?? ""),
    [error, setError] = useState(initial.error),
    [saved, setSaved] = useState(false),
    [definitive, setDefinitive] = useState(false);
  const [selected, setSelected] = useState(initial.pending?.attachmentIds ?? []);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [version] = useState(row.version);
  const [action] = useState<CaseCommand["action"]>(
    initial.pending?.action ?? (row.status === "resolved" ? "appeal" : "message")
  );
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    return () => c.abort();
  }, []);
  const send = () => {
    const c = controller.current;
    if (!c || c.signal.aborted || disabled) return;
    void op.run(
      async () => {
        const request = pending ?? {
          clientKey: uuid.v4(),
          expectedVersion: version,
          action,
          message,
          attachmentIds: selected,
        };
        outbox.save(request);
        setPending(request);
        setError("");
        try {
          await writePrivateCase(row.id, userId, generation, request, c.signal);
        } catch (e) {
          if (e instanceof ApiRequestError && [400, 401, 403, 404, 409, 422].includes(e.status)) {
            outbox.clear(request.clientKey);
            setDefinitive(true);
          }
          throw e;
        }
        outbox.clear(request.clientKey);
      },
      () => setSaved(true),
      (e) => {
        if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) onRefresh();
        else setError(String(e instanceof Error ? e.message : e));
      }
    );
  };
  const locked = disabled || op.busy || !!pending || saved || !!initial.error;
  return (
    <View style={{ gap: 8 }}>
      <CaseEvidence
        caseId={row.id}
        generation={generation}
        disabled={locked}
        selected={selected}
        onSelect={setSelected}
        onBusy={setUploadBusy}
      />
      <ThemedText>
        {t(action === "appeal" ? "privateCases.appeal" : "privateCases.message")}
      </ThemedText>
      <TextInput
        accessibilityLabel={t("privateCases.message")}
        value={message}
        onChangeText={setMessage}
        editable={!locked}
        multiline
        maxLength={4000}
        style={{ color: theme.text, minHeight: 72, padding: 12 }}
      />
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved ? (
        <>
          <ThemedText>{t("feedbackHistory.saved")}</ThemedText>
          <Action label={t("thread.refresh")} onPress={onRefresh} />
        </>
      ) : definitive ? (
        <Action label={t("thread.refresh")} onPress={onRefresh} />
      ) : (
        <>
          {pending && <ThemedText>{t("feedbackHistory.retryHelp")}</ThemedText>}
          <Action
            label={t(pending ? "feedbackHistory.retry" : "feedbackHistory.submit")}
            disabled={
              disabled ||
              op.busy ||
              uploadBusy ||
              !!initial.error ||
              !message.trim() ||
              (!pending && version !== row.version)
            }
            onPress={send}
          />
        </>
      )}
    </View>
  );
}
