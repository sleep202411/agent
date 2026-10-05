import { useEffect, useRef, useState } from "react";
import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import {
  CREW_GENRES,
  EMPLOYMENT_TYPES,
  WORK_MODES,
  SALARY_PERIODS,
  PRESET_POSITIONS,
  ZERO_DECIMAL_CURRENCIES,
} from "@repo/shared/crew";
import { useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
import { isChinaRegion } from "@/config/app-env";
import { toHref } from "@/lib/navigation";
import { crewPositionLabel } from "@/lib/crew-position-label";
import { fetchCertificationLevels } from "@/features/certificates/level-application-api";
import {
  fetchOpenings,
  openingFilters,
  salaryMinor,
  type OpeningFilters,
} from "@/features/browse/openings-api";
export default function OpeningsScreen() {
  const router = useRouter();
  const auth = useAuth(),
    active = useScreenActive(),
    locale = useLocale(),
    theme = useTheme(),
    t = useTranslations();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ headerShown: true, title: t("openings.title") }} />
      <Pressable
        accessibilityRole="button"
        style={{ padding: 16 }}
        onPress={() => router.push(toHref("/crew-work-entry?mode=position"))}
      >
        <ThemedText>{t("taskEntry.positionTitle")}</ThemedText>
      </Pressable>
      {active && auth.status !== "hydrating" ? (
        <Openings key={`${auth.generation}:${locale}`} generation={auth.generation} />
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}
function Openings({ generation }: { generation: number }) {
  const t = useTranslations(),
    theme = useTheme();
  const [draft, setDraft] = useState<OpeningFilters>(() => openingFilters.parse({}));
  const [applied, setApplied] = useState(draft),
    [revision, setRevision] = useState(0),
    [expanded, setExpanded] = useState(false);
  const [min, setMin] = useState(""),
    [max, setMax] = useState(""),
    [period, setPeriod] = useState<(typeof SALARY_PERIODS)[number]>("project"),
    [error, setError] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>();
  const [capabilityError, setCapabilityError] = useState("");
  const [capabilityRevision, setCapabilityRevision] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    void fetchCertificationLevels(generation, controller.signal).then(
      (rows) => {
        if (!controller.signal.aborted) setCapabilities([...new Set(rows.map((row) => row.name))]);
      },
      (cause) => {
        if (!controller.signal.aborted)
          setCapabilityError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => controller.abort();
  }, [expanded, generation, capabilityRevision]);
  const button = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" style={{ padding: 12, minHeight: 44 }} onPress={onPress}>
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  const input = (
    label: string,
    value: string,
    onChangeText: (value: string) => void,
    decimal = false
  ) => (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={theme.textSecondary}
      value={value}
      onChangeText={onChangeText}
      keyboardType={decimal ? "decimal-pad" : "default"}
      style={{
        color: theme.text,
        borderColor: theme.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        minHeight: 44,
      }}
    />
  );
  const choices = (
    label: string,
    values: readonly string[],
    selected: readonly string[],
    change: (value: string) => void,
    labelOf: (v: string) => string,
    maxSelected?: number
  ) => (
    <View style={{ gap: 4 }}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <ScrollView horizontal>
        {values.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: selected.includes(value) }}
            disabled={
              !selected.includes(value) &&
              maxSelected !== undefined &&
              selected.length >= maxSelected
            }
            onPress={() => change(value)}
            style={{
              padding: 12,
              minHeight: 44,
              backgroundColor: selected.includes(value)
                ? theme.backgroundSelected
                : theme.backgroundElement,
            }}
          >
            <ThemedText>{labelOf(value)}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
  const toggle = (key: "employment" | "skills" | "workMode", value: string) =>
    setDraft((f) => ({
      ...f,
      [key]: f[key].includes(value as never)
        ? f[key].filter((v) => v !== value)
        : key === "skills" && f.skills.length >= 20
          ? f.skills
          : [...f[key], value],
    }));
  const apply = () => {
    try {
      setApplied(
        openingFilters.parse({
          ...draft,
          salaryMinMinor: salaryMinor(min),
          salaryMaxMinor: salaryMinor(max),
          salaryCurrency: min.trim() || max.trim() ? (isChinaRegion ? "CNY" : "USD") : undefined,
          salaryPeriod: min.trim() || max.trim() ? period : undefined,
        })
      );
      setRevision((v) => v + 1);
      setExpanded(false);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {input(t("openings.search"), draft.q, (q) => setDraft((f) => ({ ...f, q })))}
      <View style={{ flexDirection: "row" }}>
        {button(t("openings.filters"), () => {
          setCapabilities(undefined);
          setCapabilityError("");
          setExpanded((v) => !v);
        })}
        {button(t("openings.apply"), apply)}
      </View>
      {expanded ? (
        <View style={{ gap: 12 }}>
          {choices(
            t("openings.role"),
            ["", ...PRESET_POSITIONS.map((x) => x.value)],
            [draft.positionType],
            (positionType) => setDraft((f) => ({ ...f, positionType })),
            (v) => (v ? crewPositionLabel(v, t) : t("openings.all"))
          )}
          {choices(
            t("openings.genre"),
            ["", ...CREW_GENRES],
            [draft.genre],
            (genre) => setDraft((f) => ({ ...f, genre: genre as OpeningFilters["genre"] })),
            (v) => (v ? t(`openings.genre.${v}` as MessageKey) : t("openings.all"))
          )}
          {choices(
            t("openings.employment"),
            EMPLOYMENT_TYPES,
            draft.employment,
            (v) => toggle("employment", v),
            (v) => t(`positionCreate.${v}` as MessageKey)
          )}
          {capabilityError ? (
            <View>
              <ThemedText accessibilityRole="alert">{capabilityError}</ThemedText>
              {button(t("common.retry"), () => {
                setCapabilities(undefined);
                setCapabilityError("");
                setCapabilityRevision((v) => v + 1);
              })}
            </View>
          ) : capabilities === undefined ? (
            <ActivityIndicator />
          ) : null}
          {choices(
            t("openings.capabilities"),
            capabilities ?? [],
            draft.skills,
            (v) => toggle("skills", v),
            (v) => v,
            20
          )}
          {choices(
            t("openings.workMode"),
            WORK_MODES,
            draft.workMode,
            (v) => toggle("workMode", v),
            (v) => t(`positionCreate.${v}` as MessageKey)
          )}
          <ThemedText>
            {t("openings.salary")} · {isChinaRegion ? "CNY" : "USD"}
          </ThemedText>
          {input(t("openings.minimum"), min, setMin, true)}
          {input(t("openings.maximum"), max, setMax, true)}
          {choices(
            t("openings.period"),
            SALARY_PERIODS,
            [period],
            (v) => setPeriod(v as typeof period),
            (v) => t(`crewTerms.${v}` as MessageKey)
          )}
          {choices(
            t("openings.sort"),
            ["newest", "oldest"],
            [draft.sort],
            (sort) => setDraft((f) => ({ ...f, sort: sort as OpeningFilters["sort"] })),
            (v) => t(`openings.${v}` as MessageKey)
          )}
          {button(t("openings.reset"), () => {
            const empty = openingFilters.parse({});
            setDraft(empty);
            setApplied(empty);
            setMin("");
            setMax("");
            setPeriod("project");
            setError("");
            setRevision((v) => v + 1);
          })}
        </View>
      ) : null}
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      <Results
        key={JSON.stringify([applied, revision])}
        filters={applied}
        generation={generation}
      />
    </ScrollView>
  );
}
function Results({ filters, generation }: { filters: OpeningFilters; generation: number }) {
  const t = useTranslations(),
    theme = useTheme(),
    router = useRouter();
  const [cursor, setCursor] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Awaited<ReturnType<typeof fetchOpenings>>>(),
    [error, setError] = useState("");
  const records = useRef<NonNullable<typeof page>["items"]>([]),
    seen = useRef(new Set<string>());
  useEffect(() => {
    const c = new AbortController();
    void fetchOpenings(filters, cursor, generation, c.signal)
      .then((value) => {
        if (c.signal.aborted) return;
        if (
          value.items.some((row) =>
            records.current.some((old) => old.position.id === row.position.id)
          ) ||
          (value.nextCursor && seen.current.has(value.nextCursor))
        )
          throw Error("Openings changed. Apply filters again to refresh.");
        if (cursor) seen.current.add(cursor);
        records.current = [...records.current, ...value.items];
        setPage({ ...value, items: records.current });
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => c.abort();
  }, [filters, cursor, generation, revision]);
  return (
    <View style={{ gap: 12 }}>
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            style={{ padding: 12, minHeight: 44 }}
            onPress={() => {
              setError("");
              setRevision((v) => v + 1);
            }}
          >
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </>
      ) : !page ? (
        <ActivityIndicator />
      ) : (
        <>
          <ThemedText>{t("openings.count").replace("{count}", String(page.total))}</ThemedText>
          {page.items.map(({ position, crew }) => (
            <Pressable
              key={position.id}
              accessibilityRole="button"
              style={{
                padding: 12,
                gap: 6,
                borderRadius: 8,
                backgroundColor: theme.backgroundElement,
              }}
              onPress={() =>
                router.push(
                  toHref(
                    `/crew-opening?crewId=${encodeURIComponent(crew.id)}&positionId=${encodeURIComponent(position.id)}`
                  )
                )
              }
            >
              <ThemedText type="smallBold">
                {crewPositionLabel(position.positionType, t)}
              </ThemedText>
              <ThemedText>{crew.name}</ThemedText>
              {position.salary.currency &&
              (position.salary.minAmount !== null || position.salary.maxAmount !== null) ? (
                <ThemedText type="small">
                  {position.salary.currency}{" "}
                  {[position.salary.minAmount, position.salary.maxAmount]
                    .filter((v): v is number => v !== null)
                    .map((v) =>
                      String(v / (ZERO_DECIMAL_CURRENCIES.has(position.salary.currency!) ? 1 : 100))
                    )
                    .join(" – ")}
                  {position.salary.period ? ` / ${t(`crewTerms.${position.salary.period}`)}` : ""}
                </ThemedText>
              ) : null}
              {position.paymentTerms && (
                <ThemedText>
                  {t("taskPaymentTerms.label")}: {t(`taskPaymentTerms.${position.paymentTerms}`)}
                </ThemedText>
              )}
              {position.salary.negotiable ? (
                <ThemedText type="small">{t("positionCreate.negotiable")}</ThemedText>
              ) : null}
              <ThemedText type="small">
                {[
                  position.location,
                  t(`positionCreate.${position.workMode}`),
                  t(`positionCreate.${position.employmentType}`),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </ThemedText>
            </Pressable>
          ))}
          {page.nextCursor ? (
            <Pressable
              accessibilityRole="button"
              style={{ padding: 12, minHeight: 44 }}
              onPress={() => {
                setCursor(page.nextCursor);
                setPage(undefined);
              }}
            >
              <ThemedText>{t("crewTerms.more")}</ThemedText>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}
