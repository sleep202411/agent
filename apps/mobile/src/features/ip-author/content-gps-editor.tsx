import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";
import {
  analyzeGps,
  checkGpsAnalysis,
  discardGpsLocations,
  gpsAnalysisPending,
  gpsPending,
  readGpsSuggestions,
  recoverGpsLocations,
  reviewGpsSuggestion,
  saveGpsLocations,
  GpsAnalysisMissing,
  type GpsScope,
  type GpsCommand,
  type GpsRevision,
  type GpsAnalysisRequest,
  type GpsAnalysisReceipt,
  type GpsSuggestions,
} from "./content-gps-api";
import {
  alreadySuggested,
  gpsDrafts,
  parseGpsDrafts,
  suggestionDraft,
  type GpsDraft,
} from "./content-gps-draft";
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
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
function Choice<T extends string>({
  label,
  value,
  values,
  labelFor,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  values: readonly T[];
  labelFor: (v: T) => string;
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen(!open)}
        style={{ padding: 10, backgroundColor: theme.backgroundElement, borderRadius: 8 }}
      >
        <ThemedText>
          {label}: {labelFor(value)}
        </ThemedText>
      </Pressable>
      {open &&
        !disabled &&
        values.map((v) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${labelFor(v)}`}
            accessibilityState={{ selected: v === value }}
            onPress={() => {
              onChange(v);
              setOpen(false);
            }}
            style={{ padding: 12 }}
          >
            <ThemedText>{labelFor(v)}</ThemedText>
          </Pressable>
        ))}
    </View>
  );
}
function Field({
  label,
  value,
  onChange,
  disabled,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  numeric?: boolean;
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
        maxLength={numeric ? 40 : 300}
        keyboardType={numeric ? "numbers-and-punctuation" : "default"}
        style={{
          padding: 10,
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          borderRadius: 8,
        }}
      />
    </View>
  );
}
export function ContentGpsEditor({ scope }: { scope: GpsScope }) {
  const t = useTranslations(),
    theme = useTheme(),
    active = useScreenActive();
  const [revision, setRevision] = useState<GpsRevision | null>(null),
    [rows, setRows] = useState<GpsDraft[]>([]),
    [pending, setPending] = useState<GpsCommand | null>(null);
  const [analysis, setAnalysis] = useState<GpsAnalysisRequest | null>(null),
    [receipt, setReceipt] = useState<GpsAnalysisReceipt | null>(null),
    [missing, setMissing] = useState(false);
  const [suggestions, setSuggestions] = useState<GpsSuggestions | null>(null),
    [showSuggestions, setShowSuggestions] = useState(false);
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [dirty, setDirty] = useState(false),
    [confirmDiscard, setConfirmDiscard] = useState(false);
  const owner = useRef<AbortController | null>(null),
    mounted = useRef(false);
  const current = (c: AbortController) =>
    mounted.current &&
    owner.current === c &&
    !c.signal.aborted &&
    scope.generation === getAuthGeneration();
  const install = (next: GpsRevision, waiting: GpsCommand | null) => {
    setRevision(next);
    setPending(waiting);
    setRows(gpsDrafts(waiting?.request.locations ?? next.locations ?? []));
    setDirty(false);
    setSuggestions(null);
    setConfirmDiscard(false);
  };
  const run = async (
    action: "load" | "save" | "discard" | "suggestions" | "analyze" | "check" | "add",
    selected?: GpsSuggestions["locations"][number]
  ) => {
    if (!active || !mounted.current || owner.current || scope.generation !== getAuthGeneration())
      return;
    const c = new AbortController();
    owner.current = c;
    setBusy(action);
    setError("");
    setSaved(false);
    try {
      if (action === "load" || action === "discard") {
        const result =
          action === "load"
            ? await recoverGpsLocations(scope, c.signal)
            : { revision: await discardGpsLocations(scope, pending, c.signal), pending: null };
        if (!current(c)) return;
        install(result.revision, result.pending);
        setAnalysis(gpsAnalysisPending(scope).read());
        setReceipt(null);
        setMissing(false);
      } else if (action === "save") {
        if (!revision) return;
        const parsed = parseGpsDrafts(rows);
        if (!pending && !parsed.success) throw Error(t("contentGpsOwner.invalid"));
        const requestId = uuid.v4(),
          command = pending ?? {
            clientKey: requestId,
            request: {
              requestId,
              expectedVersion: revision.version,
              locations: parsed.success ? parsed.data : [],
            },
          };
        setPending(command);
        const next = await saveGpsLocations(scope, command, c.signal);
        if (current(c)) {
          install(next, null);
          setSaved(true);
        }
      } else if (action === "suggestions") {
        setSuggestions(null);
        const next = await readGpsSuggestions(scope, c.signal);
        if (current(c)) setSuggestions(next);
      } else if (action === "add" && selected && revision) {
        if (pending || rows.length >= 100 || alreadySuggested(rows, selected)) return;
        const next = await reviewGpsSuggestion(scope, revision.version, selected, c.signal);
        if (current(c)) {
          setRows([...rows, suggestionDraft(next, uuid.v4())]);
          setDirty(true);
        }
      } else if (action === "analyze" || action === "check") {
        setReceipt(null);
        setSuggestions(null);
        setMissing(false);
        const complete = receipt?.status === "cached" || receipt?.status === "succeeded";
        const input =
          action === "check"
            ? analysis
            : analysis && !complete
              ? analysis
              : { requestId: uuid.v4(), locale: scope.locale };
        if (!input) return;
        setAnalysis(input);
        const next =
          action === "check"
            ? await checkGpsAnalysis(scope, input, c.signal)
            : await analyzeGps(scope, input, c.signal);
        if (!current(c)) return;
        setAnalysis(input);
        setReceipt(next);
        if (next.status === "cached" || next.status === "succeeded") {
          const value = await readGpsSuggestions(scope, c.signal);
          if (current(c)) setSuggestions(value);
        }
      }
    } catch (e) {
      if (!current(c)) return;
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof GpsAnalysisMissing) setMissing(true);
      try {
        const waiting = gpsPending(scope).read();
        setPending(waiting);
        setAnalysis(gpsAnalysisPending(scope).read());
        if (action === "save" && !waiting) setRevision(null); // Acknowledged write + failed refresh must not permit replay or stale editing.
      } catch {
        /* Keep the original failure visible. */
      }
      if (action === "add") setSuggestions(null);
      if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
        setRevision(null);
        setRows([]);
        setSuggestions(null);
        setReceipt(null);
        setDirty(false);
      }
    } finally {
      if (current(c)) {
        owner.current = null;
        setBusy(null);
      }
    }
  };
  const activate = useEffectEvent(() => {
    if (!revision) void run("load");
  });
  useEffect(() => {
    mounted.current = true;
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      setBusy(null);
      if (active) activate();
    });
    return () => {
      live = false;
      mounted.current = false;
      owner.current?.abort();
      owner.current = null;
    };
  }, [active]);
  const locked = !active || !!busy || !!pending || !revision,
    parsed = parseGpsDrafts(rows);
  const change = (id: string, patch: Partial<GpsDraft>) => {
    if (locked) return;
    setRows((v) => v.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setDirty(true);
    setSaved(false);
  };
  const complete = receipt?.status === "cached" || receipt?.status === "succeeded";
  const canAnalyze = !locked && (!analysis || complete || missing);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t("contentGpsOwner.description")}</ThemedText>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {busy && <ActivityIndicator accessibilityLabel={t("contentGpsOwner.loading")} />}
      {saved && <ThemedText>{t("contentGpsOwner.saved")}</ThemedText>}
      {pending && revision && <ThemedText>{t("contentGpsOwner.pending")}</ThemedText>}
      {revision && (
        <>
          <Button
            label={t("contentGpsSuggestions.title")}
            onPress={() => setShowSuggestions(!showSuggestions)}
            disabled={!active}
          />
          {showSuggestions && (
            <View
              style={{
                gap: 10,
                padding: 12,
                backgroundColor: theme.backgroundElement,
                borderRadius: 8,
              }}
            >
              <ThemedText>{t("contentGpsSuggestions.description")}</ThemedText>
              <ThemedText>{t("contentGpsSuggestions.analysisDescription")}</ThemedText>
              <Button
                label={t(
                  missing ? "contentGpsSuggestions.retryAnalysis" : "contentGpsSuggestions.analyze"
                )}
                onPress={() => void run("analyze")}
                disabled={!canAnalyze}
              />
              {analysis && (
                <>
                  <ThemedText>
                    {t("contentGpsSuggestions.request").replace("{id}", analysis.requestId)}
                  </ThemedText>
                  <Button
                    label={t("contentGpsSuggestions.checkAnalysis")}
                    onPress={() => void run("check")}
                    disabled={!active || !!busy || !!pending}
                  />
                </>
              )}
              {receipt && (
                <ThemedText>{t(`contentGpsSuggestions.analysis_${receipt.status}`)}</ThemedText>
              )}
              {analysis && !receipt && !busy && (
                <ThemedText>{t("contentGpsSuggestions.analysisUnknown")}</ThemedText>
              )}
              <Button
                label={t("contentGpsSuggestions.load")}
                onPress={() => void run("suggestions")}
                disabled={locked}
              />
              {suggestions && suggestions.state !== "ready" && (
                <ThemedText>{t(`contentGpsSuggestions.${suggestions.state}`)}</ThemedText>
              )}
              {suggestions?.state === "ready" && (
                <>
                  <ThemedText>
                    {t("contentGpsSuggestions.analyzed")
                      .replace("{at}", suggestions.analyzedAt ?? "")
                      .replace("{version}", suggestions.analysisVersion ?? "")}
                  </ThemedText>
                  {suggestions.ownerVersion !== revision.version && (
                    <ThemedText accessibilityRole="alert">
                      {t("contentGpsSuggestions.ownerChanged")}
                    </ThemedText>
                  )}
                  {!suggestions.locations.length && (
                    <ThemedText>{t("contentGpsSuggestions.empty")}</ThemedText>
                  )}
                  {suggestions.locations.map((location) => (
                    <View key={location.id} style={{ gap: 8, paddingVertical: 8 }}>
                      <ThemedText type="smallBold">{location.label}</ThemedText>
                      <ThemedText>
                        {t(`contentGpsSuggestions.${location.kind}`)} ·{" "}
                        {t(`contentGpsSuggestions.${location.status}`)}
                      </ThemedText>
                      {location.point && (
                        <ThemedText>
                          {location.point.latitude}, {location.point.longitude} ·{" "}
                          {location.point.coordinateSystem}
                        </ThemedText>
                      )}
                      {location.evidence.map((e, index) => (
                        <View
                          key={index}
                          style={{
                            gap: 4,
                            paddingLeft: 10,
                            borderLeftWidth: 1,
                            borderLeftColor: theme.border,
                          }}
                        >
                          <ThemedText>{e.quote}</ThemedText>
                          <ThemedText>
                            {t(`contentGpsSuggestions.${e.sourceType}`)} ·{" "}
                            {t(
                              e.field === "description"
                                ? "contentGpsSuggestions.descriptionField"
                                : "contentGpsSuggestions.summary"
                            )}
                          </ThemedText>
                        </View>
                      ))}
                      <Button
                        label={t(
                          alreadySuggested(rows, location)
                            ? "contentGpsSuggestions.already"
                            : "contentGpsSuggestions.add"
                        )}
                        disabled={
                          locked ||
                          rows.length >= 100 ||
                          alreadySuggested(rows, location) ||
                          suggestions.ownerVersion !== revision.version
                        }
                        onPress={() => void run("add", location)}
                      />
                    </View>
                  ))}
                </>
              )}
            </View>
          )}
          {rows.map((row, index) => {
            const heading = t("contentGpsOwner.location").replace("{number}", String(index + 1));
            const label = (
              key:
                | "label"
                | "kind"
                | "status"
                | "latitude"
                | "longitude"
                | "coordinates"
                | "precision"
            ) => `${heading}: ${t(`contentGpsOwner.${key}`)}`;
            return (
              <View
                key={row.id}
                style={{
                  gap: 10,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  borderRadius: 8,
                }}
              >
                <ThemedText type="smallBold">{heading}</ThemedText>
                <Field
                  label={label("label")}
                  value={row.label}
                  onChange={(value) => change(row.id, { label: value })}
                  disabled={locked}
                />
                <Choice
                  label={label("kind")}
                  value={row.kind}
                  values={["story_setting", "production_origin"] as const}
                  labelFor={(v) => t(`contentGpsOwner.${v}`)}
                  onChange={(kind) => change(row.id, { kind })}
                  disabled={locked}
                />
                <Choice
                  label={label("status")}
                  value={row.status}
                  values={["unresolved", "resolved", "ambiguous", "fictional"] as const}
                  labelFor={(v) => t(`contentGpsOwner.${v}`)}
                  onChange={(status) => change(row.id, { status })}
                  disabled={locked}
                />
                {row.status === "resolved" && (
                  <>
                    <Field
                      label={label("latitude")}
                      value={row.latitude}
                      onChange={(latitude) => change(row.id, { latitude })}
                      disabled={locked}
                      numeric
                    />
                    <Field
                      label={label("longitude")}
                      value={row.longitude}
                      onChange={(longitude) => change(row.id, { longitude })}
                      disabled={locked}
                      numeric
                    />
                    <Choice
                      label={label("coordinates")}
                      value={row.coordinateSystem}
                      values={["WGS84", "GCJ02"] as const}
                      labelFor={(v) => v}
                      onChange={(coordinateSystem) => change(row.id, { coordinateSystem })}
                      disabled={locked}
                    />
                    <Choice
                      label={label("precision")}
                      value={row.precision}
                      values={["country", "region", "city", "place"] as const}
                      labelFor={(v) => t(`contentGpsOwner.${v}`)}
                      onChange={(precision) => change(row.id, { precision })}
                      disabled={locked}
                    />
                  </>
                )}
                <Button
                  label={t("contentGpsOwner.remove")}
                  disabled={locked}
                  onPress={() => {
                    setRows((v) => v.filter((r) => r.id !== row.id));
                    setDirty(true);
                    setSaved(false);
                  }}
                />
              </View>
            );
          })}
          {!rows.length && (
            <ThemedText>
              {t(revision.version ? "contentGpsOwner.empty" : "contentGpsOwner.unset")}
            </ThemedText>
          )}
          <Button
            label={t("contentGpsOwner.add")}
            disabled={locked || rows.length >= 100}
            onPress={() => {
              setRows((v) => [
                ...v,
                {
                  id: uuid.v4(),
                  label: "",
                  kind: "story_setting",
                  status: "unresolved",
                  latitude: "",
                  longitude: "",
                  coordinateSystem: "WGS84",
                  precision: "city",
                },
              ]);
              setDirty(true);
              setSaved(false);
            }}
          />
          {!parsed.success && (
            <ThemedText accessibilityRole="alert">{t("contentGpsOwner.invalid")}</ThemedText>
          )}
          <Button
            label={t(pending ? "contentGpsOwner.retrySave" : "contentGpsOwner.save")}
            disabled={!active || !!busy || (!pending && !parsed.success)}
            onPress={() => void run("save")}
          />
        </>
      )}
      <Button
        label={t(revision ? "contentGpsOwner.discard" : "contentGpsOwner.reload")}
        disabled={!active || !!busy}
        onPress={() => {
          if (revision && (dirty || pending)) setConfirmDiscard(true);
          else void run("load");
        }}
      />
      {confirmDiscard && (
        <>
          <ThemedText>{t("contentGpsOwner.confirmDiscard")}</ThemedText>
          <Button
            label={t("contentGpsOwner.confirmDiscardAction")}
            onPress={() => void run("discard")}
            disabled={!active || !!busy}
          />
          <Button label={t("common.cancel")} onPress={() => setConfirmDiscard(false)} />
        </>
      )}
    </ScrollView>
  );
}
