import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { uuid } from "expo-modules-core";
import { regionLabel } from "@repo/shared/regions";
import { ThemedText } from "@/components/themed-text";
import { useLocale, useTranslations } from "@/i18n";
import { getAuthGeneration } from "@/auth/auth-store";
import { ApiRequestError } from "@/lib/api-client";
import { useScreenActive } from "@/hooks/use-app-active";
import type { LocationScope } from "./creator-location-api";
import { locateDeviceCity } from "./device-city-location";
import {
  checkDeviceCity,
  deviceCityAttempt,
  suggestDeviceCity,
  type DeviceCity,
  type DeviceCityResult,
} from "./device-city-api";
type Props = {
  scope: LocationScope;
  disabled: boolean;
  confirm: (city: DeviceCity) => void;
  onDenied: (error: unknown) => void;
};
export function CreatorDeviceCity(props: Props) {
  const active = useScreenActive(),
    locale = useLocale();
  return active ? (
    <DeviceCitySession
      key={`${props.scope.userId}:${props.scope.generation}:${locale}`}
      {...props}
    />
  ) : null;
}
function DeviceCitySession(props: Props) {
  const t = useTranslations(),
    locale = useLocale(),
    active = useScreenActive();
  const [initial] = useState(() => {
    try {
      return { attempt: deviceCityAttempt(props.scope).read(), error: undefined };
    } catch (cause) {
      return { attempt: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [attempt, setAttempt] = useState(initial.attempt),
    [error, setError] = useState(initial.error);
  const [result, setResult] = useState<DeviceCityResult>(),
    [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = null;
    },
    [active, props.scope.generation, locale]
  );
  const current = (controller?: AbortController) =>
    active &&
    props.scope.generation === getAuthGeneration() &&
    (!controller || (!controller.signal.aborted && operation.current === controller));
  const run = async (check: boolean) => {
    if (props.disabled || !current() || operation.current || initial.error) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      let response: DeviceCityResult;
      if (check && attempt)
        response = await checkDeviceCity(props.scope, attempt, controller.signal);
      else {
        const coords = await locateDeviceCity(controller.signal, (key) => t(key));
        if (!current(controller)) return;
        const requestId = uuid.v4();
        deviceCityAttempt(props.scope).write(requestId);
        setAttempt(requestId);
        response = await suggestDeviceCity(
          props.scope,
          { requestId, consent: true, ...coords, locale },
          controller.signal
        );
      }
      if (current(controller)) setResult(response);
    } catch (cause) {
      if (current(controller)) {
        setError(cause instanceof Error ? cause.message : String(cause));
        if (cause instanceof ApiRequestError && [401, 403].includes(cause.status ?? 0))
          props.onDenied(cause);
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  };
  const clear = (confirm: boolean) => {
    if (props.disabled || !current() || operation.current) return;
    try {
      deviceCityAttempt(props.scope).write(null);
      if (confirm && result?.city) props.confirm(result.city);
      setAttempt(null);
      setResult(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  if (!active) return null;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("creatorDeviceCity.consent")}</ThemedText>
      {
        <DeviceCityButton
          label={t("creatorDeviceCity.locate")}
          disabled={props.disabled || busy || !!initial.error}
          onPress={() => void run(false)}
        />
      }
      {attempt && (
        <DeviceCityButton
          label={t("creatorDeviceCity.check")}
          disabled={props.disabled || busy || !!initial.error}
          onPress={() => void run(true)}
        />
      )}
      {busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {result?.state === "completed" && result.city ? (
        <>
          <ThemedText>
            {t("creatorDeviceCity.suggestion")
              .replace("{city}", result.city.city)
              .replace("{country}", regionLabel(result.city.countryCode, locale))}
          </ThemedText>
          <ThemedText>{t("creatorDeviceCity.confirmHint")}</ThemedText>
          {
            <DeviceCityButton
              label={t("creatorDeviceCity.confirm")}
              disabled={props.disabled || busy || !!initial.error}
              onPress={() => clear(true)}
            />
          }
          {
            <DeviceCityButton
              label={t("creatorDeviceCity.dismiss")}
              disabled={props.disabled || busy || !!initial.error}
              onPress={() => clear(false)}
            />
          }
        </>
      ) : (
        result && <ThemedText>{t(`creatorDeviceCity.${result.state}`)}</ThemedText>
      )}
    </View>
  );
}

function DeviceCityButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 12 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
