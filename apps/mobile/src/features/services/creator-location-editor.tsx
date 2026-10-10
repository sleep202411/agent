import { CreatorDeviceCity } from "./creator-device-city";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import {
  CreatorLocationProfileSchema,
  type CreatorLocationProfile,
} from "@repo/shared/creator-location";
import { REGIONS, regionLabel } from "@repo/shared/regions";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { ApiRequestError } from "@/lib/api-client";
import {
  checkLocationGeocode,
  emptyLocation,
  locationPending,
  recoverLocation,
  resolveLocationGeocode,
  saveLocation,
  type LocationCommand,
  type LocationGeocode,
  type LocationRevision,
  type LocationScope,
} from "./creator-location-api";

function LocationButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={{ paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}

function CityField({
  value,
  label,
  disabled,
  onChange,
}: {
  value: { countryCode: string; city: string };
  label: string;
  disabled: boolean;
  onChange: (value: { countryCode: string; city: string }) => void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [choosing, setChoosing] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${t("creatorLocation.country")}`}
        accessibilityState={{ expanded: choosing, disabled }}
        disabled={disabled}
        onPress={() => setChoosing(!choosing)}
        style={{ padding: 10, backgroundColor: theme.backgroundElement }}
      >
        <ThemedText>
          {regionLabel(value.countryCode, locale) || t("creatorLocation.chooseCountry")}
        </ThemedText>
      </Pressable>
      {choosing && !disabled && (
        <ScrollView
          style={{ maxHeight: 180 }}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {(value.countryCode && !REGIONS.some((r) => r.code === value.countryCode)
            ? [{ code: value.countryCode }, ...REGIONS]
            : REGIONS
          )
            .filter((r) => r.code !== "GLOBAL")
            .map((r) => (
              <Pressable
                key={r.code}
                accessibilityRole="radio"
                accessibilityState={{ selected: r.code === value.countryCode }}
                onPress={() => {
                  onChange({ ...value, countryCode: r.code });
                  setChoosing(false);
                }}
                style={{ padding: 10 }}
              >
                <ThemedText>{regionLabel(r.code, locale)}</ThemedText>
              </Pressable>
            ))}
        </ScrollView>
      )}
      <TextInput
        accessibilityLabel={`${label}: ${t("creatorLocation.city")}`}
        value={value.city}
        maxLength={150}
        editable={!disabled}
        onChangeText={(city) => onChange({ ...value, city })}
        placeholder={t("creatorLocation.city")}
        placeholderTextColor={theme.textSecondary}
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

/** Owner-only, keyed by account generation by My services. No navigation changes. */
export function CreatorLocationEditor({ scope }: { scope: LocationScope }) {
  const [open, setOpen] = useState(false);
  const t = useTranslations();
  return (
    <View style={{ marginVertical: 12 }}>
      {!open ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setOpen(true)}
          style={{ paddingVertical: 12 }}
        >
          <ThemedText type="smallBold">{t("creatorLocation.title")}</ThemedText>
        </Pressable>
      ) : (
        <LocationForm scope={scope} onClose={() => setOpen(false)} />
      )}
    </View>
  );
}

function LocationForm({ scope, onClose }: { scope: LocationScope; onClose: () => void }) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme(),
    active = useScreenActive();
  const [revision, setRevision] = useState<LocationRevision | null>(null);
  const [profile, setProfile] = useState<CreatorLocationProfile>(emptyLocation);
  const [pending, setPending] = useState<LocationCommand | null>(null);
  const [geocode, setGeocode] = useState<LocationGeocode | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false),
    [saved, setSaved] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const owner = useRef<AbortController | null>(null),
    locked = useRef(false);
  const current = (c: AbortController) =>
    owner.current === c && !c.signal.aborted && scope.generation === getAuthGeneration();
  const run = async (action: "load" | "save" | "discard" | "check" | "resolve") => {
    const c = owner.current;
    if (!active || !c || !current(c) || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    setConfirmDiscard(false);
    try {
      if (action === "check" || action === "resolve") {
        setGeocode(null);
        const next =
          action === "check"
            ? await checkLocationGeocode(scope, c.signal)
            : await resolveLocationGeocode(scope, revision!.version, locale, c.signal);
        if (current(c)) {
          setGeocode(next);
          if (next.version !== revision?.version) {
            setBlocked(true);
            setError(t("creatorGeocoding.changed"));
          }
        }
      } else if (action === "save") {
        const requestId = pending?.clientKey ?? uuid.v4();
        const command = pending ?? {
          clientKey: requestId,
          request: {
            requestId,
            expectedVersion: revision!.version,
            profile: CreatorLocationProfileSchema.parse(profile),
          },
        };
        setPending(command);
        setGeocode(null);
        setBlocked(true);
        const next = await saveLocation(scope, command, c.signal);
        if (current(c)) {
          setRevision(next);
          setProfile(next.profile ?? emptyLocation);
          setPending(null);
          setBlocked(false);
          setSaved(true);
        }
      } else {
        if (action === "discard") {
          // Local abandonment is explicit; it never reverts an accepted server write.
          const store = locationPending(scope),
            old = store.read();
          if (old) store.clear(old.clientKey);
        }
        const next = await recoverLocation(scope, c.signal);
        if (current(c)) {
          setRevision(next.revision);
          setPending(next.pending ?? null);
          setProfile(next.pending?.request.profile ?? next.revision.profile ?? emptyLocation);
          setBlocked(false);
          setGeocode(null);
        }
      }
    } catch (e) {
      if (current(c)) {
        setError(e instanceof Error ? e.message : String(e));
        if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status ?? 0)) {
          setRevision(null);
          setProfile(emptyLocation);
          setGeocode(null);
          setPending(null);
          setBlocked(true);
        } else if (action === "save" || action === "discard") {
          // A successful receipt followed by a failed refresh must not be resent.
          try {
            setPending(locationPending(scope).read() ?? null);
          } catch {
            /* Storage error remains visible. */
          }
          setBlocked(true);
        }
      }
    } finally {
      if (current(c)) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  const initialLoad = useEffectEvent(() => {
    void run("load");
  });
  useEffect(() => {
    const c = new AbortController();
    owner.current = c;
    const timer = setTimeout(initialLoad, 0);
    return () => {
      clearTimeout(timer);
      c.abort();
      if (owner.current === c) owner.current = null;
    };
  }, []);
  const dirty = JSON.stringify(profile) !== JSON.stringify(revision?.profile ?? emptyLocation);
  const disabled = busy || !active || !!pending || blocked || !revision;
  const parsed = CreatorLocationProfileSchema.safeParse(profile);
  const change = (next: CreatorLocationProfile) => {
    setProfile(next);
    setSaved(false);
    setGeocode(null);
  };
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("creatorLocation.title")}</ThemedText>
      <ThemedText>{t("creatorLocation.description")}</ThemedText>
      {busy && <ActivityIndicator accessibilityLabel={t("creatorLocation.loading")} />}
      {revision && (
        <>
          <ThemedText>{t("creatorLocation.basedInHint")}</ThemedText>
          <CreatorDeviceCity
            key={`${scope.userId}:${scope.generation}:${locale}:${revision.version}`}
            scope={scope}
            disabled={disabled}
            confirm={(basedIn) => change({ ...profile, basedIn })}
            onDenied={(cause) => {
              setError(cause instanceof Error ? cause.message : String(cause));
              setRevision(null);
              setProfile(emptyLocation);
              setBlocked(true);
            }}
          />
          {profile.basedIn ? (
            <>
              <CityField
                value={profile.basedIn}
                label={t("creatorLocation.basedIn")}
                disabled={disabled}
                onChange={(basedIn) => change({ ...profile, basedIn })}
              />
              <LocationButton
                label={t("creatorLocation.removeBase")}
                onPress={() => change({ ...profile, basedIn: null, showOnMap: false })}
                disabled={disabled}
              />
            </>
          ) : (
            <LocationButton
              label={t("creatorLocation.addBase")}
              onPress={() => change({ ...profile, basedIn: { countryCode: "", city: "" } })}
              disabled={disabled}
            />
          )}
          <ThemedText>{t("creatorLocation.showOnMap")}</ThemedText>
          <Switch
            trackColor={{ false: theme.border, true: theme.brand }}
            thumbColor={theme.text}
            accessibilityLabel={t("creatorLocation.showOnMap")}
            disabled={disabled || !profile.basedIn}
            value={profile.showOnMap}
            onValueChange={(showOnMap) => change({ ...profile, showOnMap })}
          />
          <ThemedText type="smallBold">{t("creatorLocation.serves")}</ThemedText>
          <ThemedText>{t("creatorLocation.servesHint")}</ThemedText>
          {profile.serves.map((city, i) => (
            <View key={i} style={{ gap: 8 }}>
              <CityField
                value={city}
                label={t("creatorLocation.serviceCity").replace("{number}", String(i + 1))}
                disabled={disabled}
                onChange={(value) =>
                  change({
                    ...profile,
                    serves: profile.serves.map((old, index) => (index === i ? value : old)),
                  })
                }
              />
              <LocationButton
                label={t("creatorLocation.removeServiceCity").replace("{number}", String(i + 1))}
                onPress={() =>
                  change({ ...profile, serves: profile.serves.filter((_, index) => index !== i) })
                }
                disabled={disabled}
              />
            </View>
          ))}
          <LocationButton
            label={t("creatorLocation.addServiceCity")}
            onPress={() =>
              change({ ...profile, serves: [...profile.serves, { countryCode: "", city: "" }] })
            }
            disabled={disabled || profile.serves.length >= 30}
          />
          <ThemedText>{t("creatorLocation.remote")}</ThemedText>
          <Switch
            trackColor={{ false: theme.border, true: theme.brand }}
            thumbColor={theme.text}
            accessibilityLabel={t("creatorLocation.remote")}
            disabled={disabled}
            value={profile.remote}
            onValueChange={(remote) => change({ ...profile, remote })}
          />
          {!parsed.success && (
            <ThemedText accessibilityRole="alert">{t("creatorLocation.invalid")}</ThemedText>
          )}
          {pending && <ThemedText>{t("creatorLocation.pending")}</ThemedText>}
          <LocationButton
            label={t(pending ? "creatorLocation.retrySave" : "creatorLocation.save")}
            onPress={() => void run("save")}
            disabled={busy || !active || !parsed.success || (!pending && (blocked || !dirty))}
          />
          {!dirty && !pending && !blocked && (
            <View style={{ gap: 8 }}>
              <ThemedText type="smallBold">{t("creatorGeocoding.title")}</ThemedText>
              <ThemedText>{t("creatorGeocoding.description")}</ThemedText>
              {geocode && <ThemedText>{t(`creatorGeocoding.${geocode.state}`)}</ThemedText>}
              {geocode?.attemptId && (
                <ThemedText>
                  {t("creatorGeocoding.attempt").replace("{id}", geocode.attemptId)}
                </ThemedText>
              )}
              <LocationButton
                label={t("creatorGeocoding.check")}
                onPress={() => void run("check")}
                disabled={busy || !active}
              />
              {geocode?.version === revision.version &&
                ["missing", "expired"].includes(geocode.state) && (
                  <LocationButton
                    label={t("creatorGeocoding.resolve")}
                    onPress={() => void run("resolve")}
                    disabled={busy || !active}
                  />
                )}
            </View>
          )}
        </>
      )}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText accessibilityRole="alert">{t("creatorLocation.saved")}</ThemedText>}
      <LocationButton
        label={t(dirty || pending ? "creatorLocation.discard" : "creatorLocation.reload")}
        onPress={() => (dirty || pending ? setConfirmDiscard(true) : void run("load"))}
        disabled={busy || !active}
      />
      {confirmDiscard && (
        <>
          <ThemedText>{t("creatorLocation.confirmDiscard")}</ThemedText>
          <LocationButton
            label={t("creatorLocation.discard")}
            onPress={() => void run("discard")}
            disabled={busy || !active}
          />
          <LocationButton
            label={t("myServices.cancel")}
            onPress={() => setConfirmDiscard(false)}
            disabled={busy || !active}
          />
        </>
      )}
      <LocationButton
        label={t("creatorLocation.close")}
        onPress={onClose}
        disabled={busy || (!pending && dirty)}
      />
    </View>
  );
}
