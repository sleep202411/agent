import { CertificationGuide } from "./certification-guide";
import { certificationEntry, certificationGroup } from "./certification-guide-data";
import type { MessageKey } from "@/i18n";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { getAuthGeneration, getAuthSnapshot } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { appEnv } from "@/config";
import { useAppActiveChange, useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import {
  fetchCertificationLevels,
  fetchLevelApplications,
  levelApplicationInput,
  levelApplicationPending,
  submitLevelApplication,
  type CertificationLevel,
  type LevelApplication,
  type LevelApplicationAttempt,
  type LevelApplicationInput,
} from "./level-application-api";
import {
  applicationAssociationLink,
  fetchApplicationCrews,
  fetchApplicationIps,
  type ApplicationCrewChoice,
  type ApplicationIpChoice,
} from "./level-application-choices";
import { pickLevelApplicationAttachment } from "./level-application-upload";
import { AcademyCoursesForCertificate } from "./academy-courses";

type Props = { userId: string; generation: number; onClose: () => void; lockedLevelId?: number };
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function LevelApplicationForm(props: Props) {
  const focused = useIsFocused(),
    locale = useLocale();
  return focused && props.generation === getAuthGeneration() ? (
    <Session
      key={`${props.userId}:${props.generation}:${locale}:${props.lockedLevelId}`}
      {...props}
    />
  ) : null;
}
function Session({ userId, generation, onClose, lockedLevelId }: Props) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    active = useScreenActive();
  const heldLevelIds = new Set(
    (getAuthSnapshot().user?.levels ?? []).map((level) => Number(level.id))
  );
  const controller = useRef<AbortController | null>(null),
    picking = useRef(false),
    locked = useRef(false);
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>(),
    [storageBroken, setStorageBroken] = useState(false);
  const [levels, setLevels] = useState<CertificationLevel[]>([]),
    [applications, setApplications] = useState<LevelApplication[]>([]);
  const [crews, setCrews] = useState<ApplicationCrewChoice[]>([]),
    [ips, setIps] = useState<ApplicationIpChoice[]>([]);
  const [levelId, setLevelId] = useState<number | undefined>(lockedLevelId);
  const [crewId, setCrewId] = useState(""),
    [ipId, setIpId] = useState(""),
    [note, setNote] = useState("");
  const [attachment, setAttachment] = useState<{ name: string; path: string } | null>(null);
  const [review, setReview] = useState<LevelApplicationInput>(),
    [pending, setPending] = useState<LevelApplicationAttempt | null>(null);
  const [clearing, setClearing] = useState(false);
  const valid = (c: AbortController) =>
    !c.signal.aborted && controller.current === c && generation === getAuthGeneration();
  const initialise = useEffectEvent(async (c: AbortController) => {
    if (!valid(c)) return;
    setLoaded(false);
    setError(undefined);
    setReview(undefined);
    setBusy(false);
    try {
      let recovering = false;
      try {
        const saved = levelApplicationPending(userId, generation).read();
        setPending(saved);
        recovering = Boolean(saved);
        setStorageBroken(false);
      } catch (e) {
        setStorageBroken(true);
        setError(message(e));
        recovering = true;
      }
      if (recovering) {
        const rows = await fetchLevelApplications(generation, c.signal);
        if (valid(c)) {
          setApplications(rows);
          setLoaded(true);
        }
        return;
      }
      const [nextLevels, nextApplications, nextCrews, nextIps] = await Promise.all([
        fetchCertificationLevels(generation, c.signal),
        fetchLevelApplications(generation, c.signal),
        fetchApplicationCrews(generation, c.signal),
        fetchApplicationIps(locale, generation, c.signal),
      ]);
      if (!valid(c)) return;
      setLevels(nextLevels);
      setApplications(nextApplications);
      setCrews(nextCrews);
      setIps(nextIps);
      setLoaded(true);
    } catch (e) {
      if (valid(c)) setError(message(e));
    }
  });
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    locked.current = false;
    void Promise.resolve().then(() => initialise(c));
    return () => c.abort();
  }, [revision]);
  useAppActiveChange((foreground) => {
    // Native document selection may background the app; preserve the form and its selected file.
    if (picking.current) return;
    if (!foreground) controller.current?.abort();
    else setRevision((v) => v + 1);
  });
  async function run(work: (c: AbortController) => Promise<void>) {
    const c = controller.current;
    if (!c || !valid(c) || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await work(c);
    } catch (e) {
      if (valid(c)) {
        setError(message(e));
        try {
          setPending(levelApplicationPending(userId, generation).read());
        } catch {
          setStorageBroken(true);
        }
      }
    } finally {
      if (controller.current === c) {
        locked.current = false;
        if (valid(c)) setBusy(false);
      }
    }
  }
  if (!active) return null;
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || disabled }}
      disabled={busy || disabled}
      onPress={action}
      style={{
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.border,
        opacity: busy || disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
  function clear() {
    try {
      levelApplicationPending(userId, generation).clear();
      setPending(null);
      setStorageBroken(false);
      setClearing(false);
      setNote("");
      setAttachment(null);
      setCrewId("");
      setIpId("");
      setRevision((v) => v + 1);
    } catch (e) {
      setError(message(e));
    }
  }
  const selectedHeld = heldLevelIds.has(levelId ?? -1);
  const selectedPending = applications.some((v) => v.levelId === levelId && v.status === 0);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText>{t("levelApplication.description")}</ThemedText>
      {error ? <ThemedText accessibilityRole="alert">{error}</ThemedText> : null}
      {busy ? <ActivityIndicator /> : null}
      {pending || storageBroken ? (
        <>
          <ThemedText>
            {t(pending?.acknowledged ? "levelApplication.success" : "levelApplication.recovery")}
          </ThemedText>
          {pending ? (
            <View style={{ gap: 8 }}>
              <ThemedText>{`${pending.input.levelId} · ${pending.startedAt}`}</ThemedText>
              {pending.input.crewName ? <ThemedText>{pending.input.crewName}</ThemedText> : null}
              {pending.input.ipName ? <ThemedText>{pending.input.ipName}</ThemedText> : null}
              {pending.input.extraInfo ? <ThemedText>{pending.input.extraInfo}</ThemedText> : null}
            </View>
          ) : null}
          {button(t("levelApplication.refresh"), () => setRevision((v) => v + 1))}
          {button(
            t(
              pending?.acknowledged
                ? "levelApplication.done"
                : clearing
                  ? "levelApplication.confirmClear"
                  : "levelApplication.clear"
            ),
            () => {
              if (pending?.acknowledged) {
                clear();
                return;
              }
              if (!clearing) setClearing(true);
              else clear();
            }
          )}
          {clearing ? <ThemedText>{t("levelApplication.clearHint")}</ThemedText> : null}
        </>
      ) : !loaded ? (
        <>
          {!error ? <ActivityIndicator /> : null}
          {button(t("common.retry"), () => setRevision((v) => v + 1))}
        </>
      ) : review ? (
        <>
          <ThemedText>{t("levelApplication.review")}</ThemedText>
          <ThemedText>{levels.find((v) => v.id === review.levelId)?.name}</ThemedText>
          <ThemedText>{review.crewName || t("levelApplication.none")}</ThemedText>
          <ThemedText>{review.ipName || t("levelApplication.none")}</ThemedText>
          {review.extraInfo ? <ThemedText>{review.extraInfo}</ThemedText> : null}
          {attachment ? <ThemedText>{attachment.name}</ThemedText> : null}
          <ActionButton
            label={t("levelApplication.confirm")}
            disabled={busy}
            onPress={() => {
              void run(async (c) => {
                await submitLevelApplication(
                  review,
                  userId,
                  generation,
                  appEnv.appRegion,
                  c.signal
                );
                if (valid(c)) {
                  setPending(levelApplicationPending(userId, generation).read());
                  setReview(undefined);
                  setLoaded(false);
                  setRevision((v) => v + 1);
                }
              });
            }}
          />
          {button(t("levelApplication.edit"), () => setReview(undefined))}
        </>
      ) : (
        <>
          <ThemedText>{t("levelApplication.level")}</ThemedText>
          <CertificationGuide />
          {["partner", "director", "skill", "other"].map((group) => {
            const options = levels.filter(
              (v) =>
                (lockedLevelId === undefined || v.id === lockedLevelId) &&
                certificationGroup(v.name) === group
            );
            if (!options.length) return null;
            return (
              <View key={group} style={{ gap: 8 }}>
                <ThemedText>{t(`certificationGuide.${group}` as MessageKey)}</ThemedText>
                {options.map((v) => {
                  const entry = certificationEntry(v.name);
                  const name = entry ? t(`certificationGuide.${entry}Name` as MessageKey) : v.name;
                  return (
                    <View key={v.id}>
                      {button(
                        `${levelId === v.id ? "✓ " : ""}${name}`,
                        () => setLevelId(v.id),
                        heldLevelIds.has(v.id)
                      )}
                      {heldLevelIds.has(v.id) && (
                        <ThemedText>{t("levelApplication.alreadyHeld")}</ThemedText>
                      )}
                      {levelId === v.id && v.description ? (
                        <ThemedText>{v.description}</ThemedText>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            );
          })}
          {!levels.some((v) => lockedLevelId === undefined || v.id === lockedLevelId) ? (
            <ThemedText>{t("levelApplication.unavailable")}</ThemedText>
          ) : null}
          {levelId !== undefined &&
          levels.some((level) => level.id === levelId && level.type === 4) ? (
            <AcademyCoursesForCertificate certificateId={levelId} />
          ) : null}
          {selectedHeld ? <ThemedText>{t("levelApplication.alreadyHeld")}</ThemedText> : null}
          {!selectedHeld && selectedPending ? (
            <ThemedText>{t("levelApplication.alreadyPending")}</ThemedText>
          ) : null}
          <AssociationChoice
            label={t("levelApplication.crew")}
            items={crews}
            value={crewId}
            onChange={setCrewId}
            disabled={busy}
          />
          <AssociationChoice
            label={t("levelApplication.ip")}
            items={ips.map((v) => ({ id: v.id, name: v.title }))}
            value={ipId}
            onChange={setIpId}
            disabled={busy}
          />
          <ThemedText>{t("levelApplication.note")}</ThemedText>
          <TextInput
            accessibilityLabel={t("levelApplication.note")}
            value={note}
            onChangeText={setNote}
            editable={!busy}
            multiline
            maxLength={300}
            style={{
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
              padding: 12,
              minHeight: 88,
            }}
          />
          <ThemedText>{`${note.length}/300`}</ThemedText>
          <ThemedText>{t("levelApplication.formats")}</ThemedText>
          {attachment ? <ThemedText>{attachment.name}</ThemedText> : null}
          <ActionButton
            label={t("levelApplication.attachment")}
            disabled={busy}
            onPress={() => {
              void run(async (c) => {
                picking.current = true;
                try {
                  const next = await pickLevelApplicationAttachment(generation, c.signal);
                  if (next && valid(c)) setAttachment(next);
                } finally {
                  picking.current = false;
                }
              });
            }}
          />
          {attachment
            ? button(t("levelApplication.removeAttachment"), () => setAttachment(null))
            : null}
          {button(
            t("levelApplication.review"),
            () => {
              try {
                const selectedCrew = crews.find((v) => v.id === crewId),
                  selectedIp = ips.find((v) => v.id === ipId);
                if ((crewId && !selectedCrew) || (ipId && !selectedIp))
                  throw new Error(t("levelApplication.refresh"));
                setReview(
                  levelApplicationInput.parse({
                    levelId,
                    crewName: selectedCrew?.name ?? "",
                    crewLink: selectedCrew
                      ? applicationAssociationLink(
                          "crews",
                          selectedCrew.id,
                          appEnv.appRegion,
                          locale
                        )
                      : "",
                    ipName: selectedIp?.title ?? "",
                    ipLink: selectedIp
                      ? applicationAssociationLink(
                          "ip",
                          selectedIp.roomNumber,
                          appEnv.appRegion,
                          locale
                        )
                      : "",
                    ...(note.trim() ? { extraInfo: note.trim() } : {}),
                    ...(attachment ? { attachmentUrl: attachment.path } : {}),
                  })
                );
                setError(undefined);
              } catch (e) {
                setError(message(e));
              }
            },
            !levels.some((v) => v.id === levelId) || selectedPending || selectedHeld
          )}
        </>
      )}
      {loaded ? (
        <View style={{ gap: 8 }}>
          <ThemedText>{t("levelApplication.history")}</ThemedText>
          {!applications.length ? (
            <ThemedText>{t("levelApplication.empty")}</ThemedText>
          ) : (
            applications.map((v) => (
              <View key={v.id} style={{ gap: 4 }}>
                <ThemedText>{`${v.levelName || levels.find((l) => l.id === v.levelId)?.name || v.levelId} · #${v.id}`}</ThemedText>
                <ThemedText>
                  {t(
                    (
                      [
                        "levelApplication.pending",
                        "levelApplication.approved",
                        "levelApplication.rejected",
                        "levelApplication.cancelled",
                      ] as const
                    )[v.status]
                  )}
                </ThemedText>
                {v.createTime ? <ThemedText>{v.createTime}</ThemedText> : null}
                {v.adminRemark ? <ThemedText>{v.adminRemark}</ThemedText> : null}
              </View>
            ))
          )}
        </View>
      ) : null}
      {button(t("levelApplication.close"), onClose)}
    </ScrollView>
  );
}

function ActionButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
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
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 8,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
function AssociationChoice({
  label,
  items,
  value,
  onChange,
  disabled,
}: {
  label: string;
  items: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const t = useTranslations(),
    theme = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{label}</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        style={{ padding: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 8 }}
        onPress={() => setOpen(!open)}
      >
        <ThemedText>
          {items.find((v) => v.id === value)?.name ?? t("levelApplication.none")}
        </ThemedText>
      </Pressable>
      {open ? (
        <>
          <TextInput
            accessibilityLabel={t("levelApplication.search")}
            value={search}
            onChangeText={setSearch}
            editable={!disabled}
            style={{
              padding: 12,
              color: theme.text,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
            }}
          />
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 240 }}
          >
            {[
              { id: "", name: t("levelApplication.none") },
              ...items.filter((v) =>
                v.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
              ),
            ].map((v) => (
              <Pressable
                key={v.id}
                accessibilityRole="button"
                accessibilityState={{ selected: value === v.id, disabled }}
                disabled={disabled}
                style={{ padding: 12 }}
                onPress={() => {
                  onChange(v.id);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <ThemedText>{`${value === v.id ? "✓ " : ""}${v.name}`}</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}
